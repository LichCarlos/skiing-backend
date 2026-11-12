import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../../shared/persistence/prisma.service.js';
import { PrismaRagDocumentWriter } from './prisma-rag-document-writer.js';

const source = {
  sourceKey: 'resort:8',
  sourceType: 'resort' as const,
  sourceId: 8,
  title: 'Resort',
  content: 'A source.',
  accessScope: 'public' as const,
  merchantId: null,
  sourceUpdatedAt: new Date('2026-10-27T00:00:00Z'),
  sourceState: { v: 1, kind: 'resort', Name: 'Resort' },
};
const claim = {
  kind: 'claimed',
  ragDocumentId: 8,
  controlVersion: 3,
  indexGeneration: 5n,
} as const;
const vector = Array.from({ length: 1024 }, (_, index) => index / 1024);
function setup(overrides = {}) {
  const row = {
    RagDocumentId: 8,
    ContentHash: 'hash',
    Status: 'pending',
    ManualDisabled: false,
    ControlVersion: 3,
    IndexGeneration: 4n,
    ...overrides,
  };
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([row]),
    $executeRaw: vi.fn().mockResolvedValue(1),
    ragDocument: {
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUnique: vi.fn().mockResolvedValue(row),
    },
    ragChunk: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
  };
  const runner = vi.fn((work: (value: typeof tx) => Promise<unknown>) =>
    work(tx),
  );
  const prisma = { ...tx, $transaction: runner } as unknown as PrismaService;
  return { writer: new PrismaRagDocumentWriter(prisma), tx, runner };
}
describe('PrismaRagDocumentWriter generation fencing', () => {
  it('locks and atomically claims a new generation with normalized source fields', async () => {
    const { writer, tx } = setup();
    await expect(
      writer.beginIndexing(source, 'hash', 'bge-m3', 1),
    ).resolves.toEqual(claim);
    expect(tx.ragDocument.update).toHaveBeenCalledWith({
      where: { RagDocumentId: 8 },
      data: expect.objectContaining({
        IndexGeneration: 5n,
        Status: 'pending',
        Metadata: { sourceState: source.sourceState },
      }),
    });
    expect((tx.$queryRaw.mock.calls[0]![0] as { sql: string }).sql).toContain(
      'FOR UPDATE',
    );
  });
  it.each(['manual-disabled', 'stale'] as const)(
    'does not overwrite a %s source',
    async (kind) => {
      const { writer, tx } = setup(
        kind === 'manual-disabled' ? { ManualDisabled: true } : {},
      );
      await expect(
        writer.beginIndexing(
          source,
          'hash',
          'bge-m3',
          1,
          kind === 'stale' ? { expectedControlVersion: 2 } : {},
        ),
      ).resolves.toEqual({ kind });
      expect(tx.ragDocument.update).not.toHaveBeenCalled();
    },
  );
  it('skips only matching indexed hash, count and model under the row lock', async () => {
    const { writer, tx } = setup({ Status: 'indexed' });
    tx.$queryRaw
      .mockResolvedValueOnce([
        {
          RagDocumentId: 8,
          ContentHash: 'hash',
          Status: 'indexed',
          ManualDisabled: false,
          ControlVersion: 3,
          IndexGeneration: 4n,
        },
      ])
      .mockResolvedValueOnce([{ total: 1n, matchingModel: 1n }]);
    await expect(
      writer.beginIndexing(source, 'hash', 'bge-m3', 1),
    ).resolves.toEqual({ kind: 'skip' });
    expect(tx.ragDocument.update).not.toHaveBeenCalled();
  });
  it('force rebuild does not skip a matching hash', async () => {
    const { writer } = setup({ Status: 'indexed' });
    await expect(
      writer.beginIndexing(source, 'hash', 'bge-m3', 1, { force: true }),
    ).resolves.toEqual(claim);
  });
  it('replaces vectors with generation, control, hash and manual-switch predicates', async () => {
    const { writer, tx } = setup();
    await expect(
      writer.replaceChunksAndMarkIndexed('resort:8', 'hash', 'bge-m3', claim, [
        { index: 0, content: 'Chunk', embedding: vector },
      ]),
    ).resolves.toBe(true);
    expect(tx.ragDocument.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        RagDocumentId: 8,
        SourceKey: 'resort:8',
        ContentHash: 'hash',
        Status: 'pending',
        ManualDisabled: false,
        ControlVersion: 3,
        IndexGeneration: 5n,
      },
      data: { Status: 'pending' },
    });
    expect(tx.ragChunk.deleteMany).toHaveBeenCalledWith({
      where: { RagDocumentId: 8 },
    });
    const sql = tx.$executeRaw.mock.calls[0]![0] as {
      sql: string;
      values: unknown[];
    };
    expect(sql.sql).toContain('::vector(1024)');
    expect(sql.values).toContain(`[${vector.join(',')}]`);
  });
  it('ignores stale same-hash completion without touching chunks', async () => {
    const { writer, tx } = setup();
    tx.ragDocument.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      writer.replaceChunksAndMarkIndexed('resort:8', 'hash', 'bge-m3', claim, [
        { index: 0, content: 'Chunk', embedding: vector },
      ]),
    ).resolves.toBe(false);
    expect(tx.ragChunk.deleteMany).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });
  it('fences failed completion too', async () => {
    const { writer, tx } = setup();
    tx.ragDocument.updateMany.mockResolvedValue({ count: 0 });
    await expect(writer.markFailed('resort:8', 'hash', claim)).resolves.toBe(
      false,
    );
    expect(tx.ragDocument.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        IndexGeneration: 5n,
        ControlVersion: 3,
        ManualDisabled: false,
      }),
      data: {
        Status: 'failed',
        IndexedAt: null,
        LastFailureReason: 'embedding_failed',
        LastFailureAt: expect.any(Date),
      },
    });
  });
  it('business disable invalidates in-flight generations without clearing the manual switch', async () => {
    const { writer, tx, runner } = setup({ ManualDisabled: true });
    await writer.disable('resort:8');
    expect(runner).toHaveBeenCalledOnce();
    expect(tx.ragDocument.update).toHaveBeenCalledWith({
      where: { RagDocumentId: 8 },
      data: {
        Status: 'disabled',
        IndexedAt: null,
        IndexGeneration: 5n,
        LastFailureReason: 'source_unavailable',
        LastFailureAt: expect.any(Date),
      },
    });
    expect(tx.ragChunk.deleteMany).toHaveBeenCalledOnce();
  });
  it('does not disable a newer administrator command', async () => {
    const { writer, tx } = setup();
    await expect(writer.disable('resort:8', 2)).resolves.toBe(false);
    expect(tx.ragDocument.update).not.toHaveBeenCalled();
  });
});
