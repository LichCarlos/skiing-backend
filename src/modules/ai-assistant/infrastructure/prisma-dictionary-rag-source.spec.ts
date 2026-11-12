import { describe, expect, it, vi } from 'vitest';
import { PrismaRagSourceReader } from './prisma-rag-source.reader.js';
import type { PrismaService } from '../../../shared/persistence/prisma.service.js';
import type { InboxLease } from '../../integration-events/application/ports/inbox-lease.js';
import type { IntegrationEvent } from '../../integration-events/domain/integration-event.js';
import type { RagDocumentIndexingService } from '../application/rag-document-indexing.service.js';
import type { RagDocumentWriter } from '../application/ports/rag-document-writer.js';
import { DictionaryRagEventHandler } from '../application/dictionary-rag-event-handler.js';

const event: IntegrationEvent = {
  eventId: 'c9a5b5d0-6ba3-4fe0-8f4e-7d8478b2bacc',
  eventType: 'dictionary.changed.v1',
  aggregateType: 'DictionaryItem',
  aggregateId: 'skill:2',
  occurredAt: new Date('2026-10-28T00:00:00Z'),
  payload: { dictType: 'skill', itemId: 2 },
};

function setup(
  type: unknown,
  item: unknown,
  ancestors: unknown[] = [],
  processed = false,
) {
  const findUnique = vi.fn().mockResolvedValue(type);
  const findFirst = vi
    .fn()
    .mockResolvedValueOnce(item)
    .mockImplementation(
      async ({ where }: { where: { ItemId: number } }) =>
        ancestors.find(
          (candidate) =>
            (candidate as { ItemId: number }).ItemId === where.ItemId,
        ) ?? null,
    );
  const tx = {
    dictionaryType: { findUnique },
    dictionaryItem: { findFirst },
  };
  const prisma = {
    ...tx,
    $transaction: vi.fn((work: (value: typeof tx) => Promise<unknown>) =>
      work(tx),
    ),
  };
  const claim = vi
    .fn()
    .mockResolvedValue(processed ? null : { lockToken: 'lock-1' });
  const complete = vi.fn().mockResolvedValue(true);
  const release = vi.fn().mockResolvedValue(true);
  const inbox = {
    isProcessed: vi.fn().mockResolvedValue(true),
    claim,
    complete,
    release,
  } as unknown as InboxLease;
  const indexing = { index: vi.fn().mockResolvedValue({ skipped: false }) };
  const writer = { disable: vi.fn().mockResolvedValue(undefined) };
  return {
    prisma,
    handler: new DictionaryRagEventHandler(
      new PrismaRagSourceReader(prisma as unknown as PrismaService),
      inbox,
      indexing as unknown as RagDocumentIndexingService,
      writer as unknown as RagDocumentWriter,
    ),
    claim,
    complete,
    release,
    indexing,
    writer,
  };
}

const type = {
  DictName: '滑雪技能',
  Status: 'active',
  PubliclyReadable: true,
};
const item = {
  ItemId: 2,
  ParentId: 1,
  Label: '犁式转弯',
  Value: 'wedge_turn',
  Status: 'active',
  UpdateTime: new Date('2026-10-28T00:00:00Z'),
};

describe('DictionaryRagEventHandler', () => {
  it('uses a single RepeatableRead snapshot for type, item and the complete ancestor path', async () => {
    const { handler, prisma } = setup(type, item, [
      { ItemId: 1, ParentId: null, Label: 'Parent', Status: 'active' },
    ]);
    await handler.handle(event);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
    expect(prisma.dictionaryItem.findFirst).toHaveBeenCalledWith({
      where: { DictType: 'skill', ItemId: 1, Status: 'active' },
      select: { ItemId: true, ParentId: true, Label: true },
    });
  });

  it('rejects an overlong hierarchy before indexing or completing partial content', async () => {
    const parents = Array.from({ length: 64 }, (_, index) => ({
      ItemId: index + 100,
      ParentId: index === 63 ? null : index + 101,
      Label: 'Parent',
      Status: 'active',
    }));
    const { handler, writer, indexing } = setup(
      type,
      { ...item, ParentId: 100 },
      parents,
    );
    await handler.handle(event);
    expect(indexing.index).not.toHaveBeenCalled();
    expect(writer.disable).toHaveBeenCalledWith('dictionary:skill:wedge_turn');
  });
  it('indexes public items with a complete hierarchy breadcrumb', async () => {
    const parent = {
      ItemId: 1,
      ParentId: null,
      Label: '初级',
      Status: 'active',
    };
    const { handler, indexing, complete } = setup(type, item, [parent]);
    await expect(handler.handle(event)).resolves.toBe(true);
    expect(indexing.index).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceKey: 'dictionary:skill:wedge_turn',
        sourceType: 'dictionary',
        sourceId: 2,
        title: '滑雪技能：犁式转弯',
        accessScope: 'public',
        content: expect.stringContaining('层级路径：初级 / 犁式转弯'),
      }),
    );
    expect(complete).toHaveBeenCalledOnce();
  });

  it.each([
    [{ ...type, Status: 'disabled' }, item, [], 'disabled type'],
    [{ ...type, PubliclyReadable: false }, item, [], 'private type'],
    [type, { ...item, Status: 'disabled' }, [], 'disabled item'],
    [type, item, [], 'missing parent'],
    [
      type,
      item,
      [{ ItemId: 1, ParentId: 2, Label: '循环', Status: 'active' }],
      'cyclic hierarchy',
    ],
  ])(
    'disables ineligible items: %s',
    async (dictType, dictItem, parents, _caseName) => {
      const { handler, writer, indexing } = setup(dictType, dictItem, parents);
      await expect(handler.handle(event)).resolves.toBe(true);
      expect(writer.disable).toHaveBeenCalledWith(
        'dictionary:skill:wedge_turn',
      );
      expect(indexing.index).not.toHaveBeenCalled();
    },
  );

  it('cleans up the previous key when a value changes', async () => {
    const { handler, writer, indexing } = setup(type, {
      ...item,
      ParentId: null,
    });
    await expect(
      handler.handle({
        ...event,
        payload: { ...event.payload, previousValue: 'old_value' },
      }),
    ).resolves.toBe(true);
    expect(writer.disable).toHaveBeenCalledWith('dictionary:skill:old_value');
    expect(indexing.index).toHaveBeenCalledWith(
      expect.objectContaining({ sourceKey: 'dictionary:skill:wedge_turn' }),
    );
  });

  it('skips duplicates and releases the claim after indexing failure', async () => {
    const duplicate = setup(type, item, [], true);
    await expect(duplicate.handler.handle(event)).resolves.toBe(false);

    const failed = setup(type, { ...item, ParentId: null });
    failed.indexing.index.mockRejectedValue(new Error('embedding unavailable'));
    await expect(failed.handler.handle(event)).rejects.toThrow(
      'embedding unavailable',
    );
    expect(failed.release).toHaveBeenCalledOnce();
  });
});
