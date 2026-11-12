import { RagSourceReindexEventHandler } from './rag-source-reindex-event-handler.js';
import { RagInboxBusyError } from './claim-rag-event.js';
import type { IntegrationEvent } from '../../integration-events/domain/integration-event.js';
import type { RagSourceReader } from './ports/rag-source-reader.js';
import type { RagDocumentWriter } from './ports/rag-document-writer.js';
import type { InboxLease } from '../../integration-events/application/ports/inbox-lease.js';
import type { RagDocumentIndexingService } from './rag-document-indexing.service.js';

const event: IntegrationEvent = {
  eventId: 'c9a5b5d0-6ba3-4fe0-8f4e-7d8478b2bacc',
  eventType: 'rag.source.reindex-requested.v1',
  aggregateType: 'RagDocument',
  aggregateId: '7',
  occurredAt: new Date('2026-11-01T00:00:00.000Z'),
  payload: {
    ragDocumentId: 7,
    sourceKey: 'resort:12',
    sourceType: 'resort',
    sourceId: 12,
    controlVersion: 4,
  },
};

function setup() {
  const sources = {
    findDictionaryType: vi.fn<RagSourceReader['findDictionaryType']>(),
    findResort: vi.fn<RagSourceReader['findResort']>().mockResolvedValue({
      id: 12,
      status: 'published',
      deletedAt: null,
      updatedAt: event.occurredAt,
      sourceState: { v: 1, kind: 'resort' },
      name: 'North Ridge',
      province: null,
      city: null,
      district: null,
      address: null,
      price: 120,
      openStatus: 'open',
      snowCondition: 'powder',
      openingHours: null,
      trailSummary: null,
      facilitySummary: null,
      description: 'Open ski area',
      fitTags: [],
    }),
    findArticle: vi.fn<RagSourceReader['findArticle']>(),
    findProjectKnowledge: vi.fn<RagSourceReader['findProjectKnowledge']>(),
    findDynamic: vi.fn<RagSourceReader['findDynamic']>(),
    findDictionary: vi.fn<RagSourceReader['findDictionary']>(),
  };
  const inbox = {
    claim: vi.fn<InboxLease['claim']>().mockResolvedValue({
      lockToken: 'owner-token',
    }),
    isProcessed: vi.fn<InboxLease['isProcessed']>().mockResolvedValue(false),
    complete: vi.fn<InboxLease['complete']>().mockResolvedValue(true),
    release: vi.fn<InboxLease['release']>().mockResolvedValue(true),
  };
  const writer = {
    isCurrentCommand: vi
      .fn<RagDocumentWriter['isCurrentCommand']>()
      .mockResolvedValue(true),
    disable: vi.fn<RagDocumentWriter['disable']>().mockResolvedValue(true),
  };
  const indexing = {
    index: vi.fn<RagDocumentIndexingService['index']>().mockResolvedValue({
      contentHash: 'hash',
      chunkCount: 1,
      skipped: false,
    }),
  };
  const handler = new RagSourceReindexEventHandler(
    sources,
    inbox,
    writer as unknown as RagDocumentWriter,
    indexing as unknown as RagDocumentIndexingService,
  );
  return { handler, sources, inbox, writer, indexing };
}

describe('RAG source reindex events', () => {
  it('rebuilds only the current version from a revalidated public business source', async () => {
    const { handler, sources, inbox, writer, indexing } = setup();

    await expect(handler.handle(event)).resolves.toBe(true);

    expect(writer.isCurrentCommand).toHaveBeenCalledWith('resort:12', 4);
    expect(sources.findResort).toHaveBeenCalledWith(12);
    expect(indexing.index).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceKey: 'resort:12',
        sourceType: 'resort',
        sourceId: 12,
        accessScope: 'public',
        merchantId: null,
      }),
      undefined,
      { force: true, expectedControlVersion: 4 },
    );
    expect(inbox.complete).toHaveBeenCalledOnce();
    expect(inbox.release).not.toHaveBeenCalled();
  });

  it('completes stale commands without reading or mutating the current source', async () => {
    const { handler, sources, inbox, writer, indexing } = setup();
    writer.isCurrentCommand.mockResolvedValue(false);

    await expect(handler.handle(event)).resolves.toBe(true);

    expect(sources.findResort).not.toHaveBeenCalled();
    expect(indexing.index).not.toHaveBeenCalled();
    expect(writer.disable).not.toHaveBeenCalled();
    expect(inbox.complete).toHaveBeenCalledOnce();
  });

  it('removes chunks instead of indexing when the source is no longer public', async () => {
    const { handler, sources, writer, indexing } = setup();
    sources.findResort.mockResolvedValueOnce({
      id: 12,
      status: 'offline',
      deletedAt: null,
      updatedAt: event.occurredAt,
      sourceState: {},
    } as NonNullable<Awaited<ReturnType<RagSourceReader['findResort']>>>);

    await expect(handler.handle(event)).resolves.toBe(true);

    expect(indexing.index).not.toHaveBeenCalled();
    expect(writer.disable).toHaveBeenCalledWith('resort:12', 4);
  });

  it('releases its Inbox lease after a failed rebuild so Kafka can retry', async () => {
    const { handler, inbox, indexing } = setup();
    const failure = new Error('embedding unavailable');
    indexing.index.mockRejectedValueOnce(failure);

    await expect(handler.handle(event)).rejects.toBe(failure);

    expect(inbox.complete).not.toHaveBeenCalled();
    expect(inbox.release).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: event.eventId }),
      { lockToken: 'owner-token' },
    );
  });

  it('does not acknowledge a delivery while another Inbox lease is active', async () => {
    const { handler, inbox, sources, indexing } = setup();
    inbox.claim.mockResolvedValue(null);
    inbox.isProcessed.mockResolvedValue(false);

    await expect(handler.handle(event)).rejects.toBeInstanceOf(
      RagInboxBusyError,
    );

    expect(sources.findResort).not.toHaveBeenCalled();
    expect(indexing.index).not.toHaveBeenCalled();
    expect(inbox.complete).not.toHaveBeenCalled();
  });

  it('ignores unrelated event types without claiming Inbox state', async () => {
    const { handler, inbox } = setup();

    await expect(
      handler.handle({ ...event, eventType: 'resort.changed.v1' }),
    ).resolves.toBe(false);

    expect(inbox.claim).not.toHaveBeenCalled();
  });
});
