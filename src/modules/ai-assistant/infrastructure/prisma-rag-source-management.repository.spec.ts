import type { PrismaService } from '../../../shared/persistence/prisma.service.js';
import { PrismaRagSourceManagementRepository } from './prisma-rag-source-management.repository.js';
import { RagSourceConflictError } from '../application/manage-rag-sources.js';
import { readManagementWriteActor } from '../../identity-access/infrastructure/read-management-write-actor.js';
vi.mock(
  '../../identity-access/infrastructure/read-management-write-actor.js',
  () => ({
    readManagementWriteActor: vi.fn(async () => ({ account: 'admin' })),
  }),
);
const date = new Date('2026-11-01T00:00:00Z');
function setup(overrides = {}) {
  const row = {
    RagDocumentId: 8,
    SourceKey: 'resort:8',
    SourceType: 'resort',
    SourceId: 8,
    Title: 'Resort',
    AccessScope: 'public',
    Status: 'indexed',
    ManualDisabled: false,
    ControlVersion: 1,
    SourceUpdatedAt: date,
    IndexedAt: date,
    CreateTime: date,
    ...overrides,
  };
  const tx = {
    $queryRaw: vi.fn().mockImplementation(async (sql: { sql: string }) =>
      sql.sql.includes('FOR UPDATE')
        ? [row]
        : sql.sql.includes('SourceEligible')
          ? [{ RagDocumentId: 8, SourceEligible: true }]
          : [
              {
                RagDocumentId: 8,
                ChunkCount: 2,
                EmbeddingModels: ['bge-m3'],
              },
            ],
    ),
    ragDocument: {
      findFirst: vi.fn().mockResolvedValue(row),
      findMany: vi.fn().mockResolvedValue([row]),
      count: vi.fn().mockResolvedValue(1),
      update: vi.fn().mockResolvedValue({}),
    },
    ragChunk: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
    outboxEvent: { create: vi.fn().mockResolvedValue({}) },
    operationLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const transaction = vi.fn(
    (work: (value: typeof tx) => Promise<unknown>, _options?: unknown) =>
      work(tx),
  );
  return {
    tx,
    transaction,
    repository: new PrismaRagSourceManagementRepository({
      $transaction: transaction,
    } as unknown as PrismaService),
  };
}
beforeEach(() => vi.mocked(readManagementWriteActor).mockClear());
describe('RAG source management commands', () => {
  it.each([
    { code: 'P2034' },
    { code: '40001' },
    { code: '40P01' },
    { code: 'P2010', meta: { code: '40001' } },
    { code: 'P2010', meta: { code: '40P01' } },
  ])(
    'maps serialization/deadlock errors from Prisma and raw SQL to a reload conflict: %j',
    async (error) => {
      const { repository, transaction } = setup();
      transaction.mockRejectedValueOnce(error);
      await expect(
        repository.reindex(1, 8, {
          expectedVersion: 1,
          reason: 'rebuild',
          traceId: 'trace',
        }),
      ).rejects.toBeInstanceOf(RagSourceConflictError);
    },
  );
  it('preserves unrelated raw SQL failures instead of labeling them as concurrency conflicts', async () => {
    const { repository, transaction } = setup();
    const error = { code: 'P2010', meta: { code: '23514' } };
    transaction.mockRejectedValueOnce(error);
    await expect(
      repository.reindex(1, 8, {
        expectedVersion: 1,
        reason: 'rebuild',
        traceId: 'trace',
      }),
    ).rejects.toBe(error);
  });
  it('queues a new command version and generation with Outbox and minimal audit in the same transaction', async () => {
    const { repository, tx, transaction } = setup();
    const result = await repository.reindex(1, 8, {
      expectedVersion: 1,
      reason: 'rebuild',
      traceId: 'trace',
    });
    expect(readManagementWriteActor).toHaveBeenCalledWith(
      tx,
      1,
      'ai:knowledge:reindex',
      true,
    );
    expect(tx.ragDocument.update).toHaveBeenCalledWith({
      where: { RagDocumentId: 8 },
      data: {
        ControlVersion: 2,
        IndexGeneration: { increment: 1n },
        Status: 'pending',
        IndexedAt: null,
      },
    });
    expect(tx.outboxEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        EventId: result.eventId,
        EventType: 'rag.source.reindex-requested.v1',
        Payload: {
          ragDocumentId: 8,
          sourceKey: 'resort:8',
          sourceType: 'resort',
          sourceId: 8,
          controlVersion: 2,
        },
      }),
    });
    expect(tx.operationLog.create.mock.calls[0]![0].data).toMatchObject({
      Reason: 'rebuild',
      TraceId: 'trace',
    });
    expect(transaction.mock.calls[0]![1]).toEqual({
      isolationLevel: 'Serializable',
    });
  });
  it.each([
    { ControlVersion: 2 },
    { ManualDisabled: true },
    { ControlVersion: 2147483647 },
  ])(
    'rejects stale/disabled/exhausted rebuild without mutation',
    async (overrides) => {
      const { repository, tx } = setup(overrides);
      await expect(
        repository.reindex(1, 8, {
          expectedVersion:
            overrides.ControlVersion === 2147483647 ? 2147483647 : 1,
          reason: 'rebuild',
          traceId: 'trace',
        }),
      ).rejects.toThrow();
      expect(tx.ragDocument.update).not.toHaveBeenCalled();
      expect(tx.outboxEvent.create).not.toHaveBeenCalled();
    },
  );
  it('manual disable deletes chunks and never queues embedding', async () => {
    const { repository, tx } = setup();
    const result = await repository.setEnabled(1, 8, {
      enabled: false,
      expectedVersion: 1,
      reason: 'stop',
      traceId: 'trace',
    });
    expect(result.eventId).toBeNull();
    expect(tx.ragChunk.deleteMany).toHaveBeenCalledWith({
      where: { RagDocumentId: 8 },
    });
    expect(tx.ragDocument.update.mock.calls[0]![0].data).toMatchObject({
      ManualDisabled: true,
      Status: 'disabled',
      ControlVersion: 2,
      IndexGeneration: { increment: 1n },
    });
    expect(tx.outboxEvent.create).not.toHaveBeenCalled();
  });
  it('same-version no-op does not consume a version or audit, but stale no-op still conflicts', async () => {
    const { repository, tx } = setup();
    await repository.setEnabled(1, 8, {
      enabled: true,
      expectedVersion: 1,
      reason: 'already enabled',
      traceId: 'trace',
    });
    expect(tx.ragDocument.update).not.toHaveBeenCalled();
    expect(tx.operationLog.create).not.toHaveBeenCalled();
    await expect(
      repository.setEnabled(1, 8, {
        enabled: true,
        expectedVersion: 2,
        reason: 'stale',
        traceId: 'trace',
      }),
    ).rejects.toThrow('stale');
  });
  it('enable queues a rebuild but does not change any business publication', async () => {
    const { repository, tx } = setup({ ManualDisabled: true });
    const result = await repository.setEnabled(1, 8, {
      enabled: true,
      expectedVersion: 1,
      reason: 'resume',
      traceId: 'trace',
    });
    expect(result.eventId).toBeTypeOf('string');
    expect(tx.outboxEvent.create).toHaveBeenCalledOnce();
    expect(tx.ragDocument.update.mock.calls[0]![0].data).toMatchObject({
      ManualDisabled: false,
      Status: 'pending',
    });
  });
  it('rejects success if audit insert fails', async () => {
    const { repository, tx } = setup();
    vi.mocked(tx.operationLog.create).mockRejectedValueOnce(
      new Error('audit unavailable'),
    );
    await expect(
      repository.reindex(1, 8, {
        expectedVersion: 1,
        reason: 'rebuild',
        traceId: 'trace',
      }),
    ).rejects.toThrow('audit unavailable');
  });
  it('lists only metadata and supported source types with matching count filters', async () => {
    const { repository, tx } = setup();
    const result = await repository.list(1, {
      page: 1,
      pageSize: 20,
      manualDisabled: false,
      keyword: 'resort',
    });
    expect(result.items[0]).not.toHaveProperty('content');
    expect(result.items[0]).not.toHaveProperty('metadata');
    const q = tx.ragDocument.findMany.mock.calls[0]![0];
    expect(q.select).not.toHaveProperty('Content');
    expect(q.where).toHaveProperty('ManualDisabled', false);
    expect(tx.ragDocument.count).toHaveBeenCalledWith({ where: q.where });
  });
});
