import { RagInboxBusyError } from './claim-rag-event.js';
import { ResortRagEventHandler } from './resort-rag-event-handler.js';
import { ArticleRagEventHandler } from './article-rag-event-handler.js';
import { ProjectKnowledgeRagEventHandler } from './project-knowledge-rag-event-handler.js';
import { DynamicRagEventHandler } from './dynamic-rag-event-handler.js';
import { DictionaryRagEventHandler } from './dictionary-rag-event-handler.js';
import type { RagSourceReader } from './ports/rag-source-reader.js';
import type { RagDocumentWriter } from './ports/rag-document-writer.js';
import type { RagDocumentIndexingService } from './rag-document-indexing.service.js';
import type { IntegrationEvent } from '../../integration-events/domain/integration-event.js';

const cases = [
  {
    Handler: ResortRagEventHandler,
    type: 'resort.changed.v1',
    payload: { resortId: 7 },
    read: 'findResort',
  },
  {
    Handler: ArticleRagEventHandler,
    type: 'article.changed.v1',
    payload: { articleId: 7 },
    read: 'findArticle',
  },
  {
    Handler: ProjectKnowledgeRagEventHandler,
    type: 'project_doc.changed.v1',
    payload: { projectKnowledgeId: 7 },
    read: 'findProjectKnowledge',
  },
  {
    Handler: DynamicRagEventHandler,
    type: 'dynamic.changed.v1',
    payload: { dynamicId: 7 },
    read: 'findDynamic',
  },
  {
    Handler: DictionaryRagEventHandler,
    type: 'dictionary.changed.v1',
    payload: { dictType: 'skills', itemId: 7 },
    read: 'findDictionary',
  },
] as const;

function setup(Handler: (typeof cases)[number]['Handler']) {
  const sources = {
    findDictionaryType: vi
      .fn<RagSourceReader['findDictionaryType']>()
      .mockResolvedValue(null),
    findResort: vi.fn<RagSourceReader['findResort']>().mockResolvedValue(null),
    findArticle: vi
      .fn<RagSourceReader['findArticle']>()
      .mockResolvedValue(null),
    findProjectKnowledge: vi
      .fn<RagSourceReader['findProjectKnowledge']>()
      .mockResolvedValue(null),
    findDynamic: vi
      .fn<RagSourceReader['findDynamic']>()
      .mockResolvedValue(null),
    findDictionary: vi
      .fn<RagSourceReader['findDictionary']>()
      .mockResolvedValue({
        type: null,
        item: null,
        breadcrumb: null,
        sourceState: null,
      }),
  };
  const inbox = {
    claim: vi.fn().mockResolvedValue({ lockToken: 'owner-token' }),
    isProcessed: vi.fn().mockResolvedValue(false),
    complete: vi.fn().mockResolvedValue(true),
    release: vi.fn().mockResolvedValue(true),
  };
  const indexing = { index: vi.fn() };
  const writer = { disable: vi.fn().mockResolvedValue(undefined) };
  return {
    sources,
    inbox,
    indexing,
    writer,
    handler: new Handler(
      sources,
      inbox,
      indexing as unknown as RagDocumentIndexingService,
      writer as unknown as RagDocumentWriter,
    ),
  };
}

describe.each(cases)(
  '$type business ports',
  ({ Handler, type, payload, read }) => {
    const event: IntegrationEvent = {
      eventId: 'c9a5b5d0-6ba3-4fe0-8f4e-7d8478b2bacc',
      eventType: type,
      aggregateType: 'source',
      aggregateId: '7',
      occurredAt: new Date(),
      payload,
    };
    it('skips a completed duplicate without reading the source or calling the model', async () => {
      const { handler, inbox, sources, indexing } = setup(Handler);
      inbox.claim.mockResolvedValue(null);
      inbox.isProcessed.mockResolvedValue(true);
      await expect(handler.handle(event)).resolves.toBe(false);
      for (const reader of Object.values(sources))
        expect(reader).not.toHaveBeenCalled();
      expect(indexing.index).not.toHaveBeenCalled();
      expect(inbox.complete).not.toHaveBeenCalled();
    });
    it('rejects a live uncompleted lease so delivery cannot be acknowledged', async () => {
      const { handler, inbox, sources } = setup(Handler);
      inbox.claim.mockResolvedValue(null);
      await expect(handler.handle(event)).rejects.toBeInstanceOf(
        RagInboxBusyError,
      );
      expect(inbox.isProcessed).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: event.eventId, eventType: type }),
      );
      expect(sources[read]).not.toHaveBeenCalled();
      expect(inbox.complete).not.toHaveBeenCalled();
      expect(inbox.release).not.toHaveBeenCalled();
    });
    it('completes an unavailable source only after its read/disable work', async () => {
      const { handler, inbox, sources, writer, indexing } = setup(Handler);
      await expect(handler.handle(event)).resolves.toBe(true);
      expect(sources[read]).toHaveBeenCalledOnce();
      expect(inbox.complete).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: event.eventId }),
        { lockToken: 'owner-token' },
      );
      if (type !== 'dictionary.changed.v1')
        expect(writer.disable.mock.invocationCallOrder[0]).toBeLessThan(
          inbox.complete.mock.invocationCallOrder[0]!,
        );
      expect(indexing.index).not.toHaveBeenCalled();
    });
    it('preserves the source error even when releasing its own lease fails', async () => {
      const { handler, inbox, sources } = setup(Handler);
      const failure = new Error('read failed');
      sources[read].mockRejectedValue(failure);
      inbox.release.mockRejectedValue(new Error('release failed'));
      await expect(handler.handle(event)).rejects.toBe(failure);
      expect(inbox.complete).not.toHaveBeenCalled();
      expect(inbox.release).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: event.eventId }),
        { lockToken: 'owner-token' },
      );
    });
    it('rejects a lost completion claim instead of claiming success', async () => {
      const { handler, inbox } = setup(Handler);
      inbox.complete.mockResolvedValue(false);
      await expect(handler.handle(event)).rejects.toThrow('claim was lost');
      expect(inbox.release).toHaveBeenCalledOnce();
    });
  },
);
