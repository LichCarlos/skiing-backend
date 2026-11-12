import { describe, expect, it, vi } from 'vitest';
import { PrismaRagSourceReader } from './prisma-rag-source.reader.js';
import type { PrismaService } from '../../../shared/persistence/prisma.service.js';
import type { InboxLease } from '../../integration-events/application/ports/inbox-lease.js';
import type { IntegrationEvent } from '../../integration-events/domain/integration-event.js';
import type { RagDocumentIndexingService } from '../application/rag-document-indexing.service.js';
import type { RagDocumentWriter } from '../application/ports/rag-document-writer.js';
import { ResortRagEventHandler } from '../application/resort-rag-event-handler.js';

const baseEvent: IntegrationEvent = {
  eventId: 'c9a5b5d0-6ba3-4fe0-8f4e-7d8478b2bacc',
  eventType: 'resort.changed.v1',
  aggregateType: 'ski_resort',
  aggregateId: '42',
  occurredAt: new Date('2026-10-27T00:00:00.000Z'),
  payload: { resortId: 42, merchantId: 7, status: 'published' },
};

function setup(resort: unknown, alreadyProcessed = false) {
  const prismaFindUnique = vi.fn().mockResolvedValue(resort);
  const prisma = {
    customFieldDefinition: { findMany: vi.fn().mockResolvedValue([]) },
    skiResort: { findUnique: prismaFindUnique },
  } as unknown as PrismaService;
  Object.assign(prisma, {
    $transaction: vi.fn((work: (tx: PrismaService) => Promise<unknown>) =>
      work(prisma),
    ),
  });
  const inboxClaim = vi
    .fn()
    .mockResolvedValue(alreadyProcessed ? null : { lockToken: 'lock-1' });
  const inboxComplete = vi.fn().mockResolvedValue(true);
  const inboxRelease = vi.fn().mockResolvedValue(true);
  const inbox = {
    isProcessed: vi.fn().mockResolvedValue(true),
    claim: inboxClaim,
    complete: inboxComplete,
    release: inboxRelease,
  } as unknown as InboxLease;
  const indexing = { index: vi.fn().mockResolvedValue({ skipped: false }) };
  const writer = { disable: vi.fn().mockResolvedValue(undefined) };
  const handler = new ResortRagEventHandler(
    new PrismaRagSourceReader(prisma),
    inbox,
    indexing as unknown as RagDocumentIndexingService,
    writer as unknown as RagDocumentWriter,
  );
  return {
    handler,
    prisma,
    inbox,
    inboxClaim,
    inboxComplete,
    inboxRelease,
    prismaFindUnique,
    indexing,
    writer,
  };
}

const publishedResort = {
  ResortId: 42,
  Name: '雪峰雪场',
  Province: '吉林省',
  City: '吉林市',
  District: null,
  Address: '雪道入口',
  Price: 520,
  OpenStatus: 'open',
  SnowCondition: 'powder',
  OpeningHours: '09:00-16:00',
  TrailSummary: '初级道 3 条',
  FacilitySummary: '雪具租赁',
  Description: '适合初学者',
  Status: 'published',
  UpdateTime: new Date('2026-10-27T00:00:00.000Z'),
  DeletedAt: null,
  FitTags: [{ Item: { Value: 'beginner' } }],
};

describe('ResortRagEventHandler', () => {
  it('indexes only public resort content when the database state is published', async () => {
    const { handler, indexing, inboxComplete } = setup(publishedResort);

    await expect(handler.handle(baseEvent)).resolves.toBe(true);

    expect(indexing.index).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceKey: 'resort:42',
        sourceType: 'resort',
        accessScope: 'public',
        merchantId: null,
        title: '雪峰雪场',
      }),
    );
    const indexed = indexing.index.mock.calls[0]?.[0] as { content: string };
    expect(indexed.content).toContain('位置：吉林省吉林市雪道入口');
    expect(indexed.content).toContain('雪道信息：初级道 3 条');
    expect(indexed.content).not.toMatch(/merchantId|Contact|收益/);
    expect(inboxComplete).toHaveBeenCalledOnce();
  });

  it('disables an existing RAG source when the resort is not public', async () => {
    const { handler, indexing, writer } = setup({
      ...publishedResort,
      Status: 'pending_review',
    });

    await expect(handler.handle(baseEvent)).resolves.toBe(true);

    expect(writer.disable).toHaveBeenCalledWith('resort:42');
    expect(indexing.index).not.toHaveBeenCalled();
  });

  it('disables the RAG source when the source record no longer exists', async () => {
    const { handler, writer } = setup(null);

    await expect(handler.handle(baseEvent)).resolves.toBe(true);

    expect(writer.disable).toHaveBeenCalledWith('resort:42');
  });

  it('skips duplicate inbox events and unrelated integration events', async () => {
    const duplicate = setup(publishedResort, true);
    await expect(duplicate.handler.handle(baseEvent)).resolves.toBe(false);
    expect(duplicate.indexing.index).not.toHaveBeenCalled();
    expect(duplicate.prismaFindUnique).not.toHaveBeenCalled();

    const unrelated = setup(publishedResort);
    await expect(
      unrelated.handler.handle({
        ...baseEvent,
        eventType: 'article.changed.v1',
      }),
    ).resolves.toBe(false);
    expect(unrelated.inboxClaim).not.toHaveBeenCalled();
  });

  it('rejects events without a valid resort identifier', async () => {
    const { handler, prismaFindUnique } = setup(publishedResort);

    await expect(
      handler.handle({ ...baseEvent, payload: { resortId: '42' } }),
    ).rejects.toThrow('positive integer resortId');
    expect(prismaFindUnique).not.toHaveBeenCalled();
  });
});
