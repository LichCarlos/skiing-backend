import { describe, expect, it, vi } from 'vitest';
import { PrismaRagSourceReader } from './prisma-rag-source.reader.js';
import type { PrismaService } from '../../../shared/persistence/prisma.service.js';
import type { InboxLease } from '../../integration-events/application/ports/inbox-lease.js';
import type { IntegrationEvent } from '../../integration-events/domain/integration-event.js';
import type { RagDocumentIndexingService } from '../application/rag-document-indexing.service.js';
import type { RagDocumentWriter } from '../application/ports/rag-document-writer.js';
import { ArticleRagEventHandler } from '../application/article-rag-event-handler.js';

const event: IntegrationEvent = {
  eventId: 'c9a5b5d0-6ba3-4fe0-8f4e-7d8478b2bacc',
  eventType: 'article.changed.v1',
  aggregateType: 'article',
  aggregateId: '19',
  occurredAt: new Date('2026-10-28T00:00:00Z'),
  payload: { articleId: 19, status: 'published' },
};

function setup(
  article: unknown,
  publicFields = [{ FieldKey: 'level', Label: '难度等级' }],
  processed = false,
) {
  const tx = {
    article: { findUnique: vi.fn().mockResolvedValue(article) },
    customFieldDefinition: {
      findMany: vi.fn().mockResolvedValue(publicFields),
    },
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
    handler: new ArticleRagEventHandler(
      new PrismaRagSourceReader(prisma as unknown as PrismaService),
      inbox,
      indexing as unknown as RagDocumentIndexingService,
      writer as unknown as RagDocumentWriter,
    ),
    prisma,
    claim,
    complete,
    release,
    indexing,
    writer,
  };
}

const published = {
  PublishTime: new Date('2026-10-28T00:00:00Z'),
  Category: {
    DictType: 'knowledge.article_category',
    Status: 'active',
    Type: { Status: 'active', PubliclyReadable: true },
  },
  ArticleId: 19,
  Title: '初学者如何选雪道',
  Summary: '从坡度和雪道颜色开始了解。',
  Body: '绿道适合初学者。',
  CategoryValue: 'basics',
  AuthorName: '编辑部',
  CustomFields: { level: 'beginner', internalNote: '不可公开' },
  Status: 'published',
  UpdateTime: new Date('2026-10-28T00:00:00Z'),
  DeletedAt: null,
};

describe('ArticleRagEventHandler', () => {
  it.each([
    { PublishTime: null },
    { Category: { ...published.Category, Status: 'inactive' } },
    { Category: { ...published.Category, DictType: 'another.public.type' } },
    {
      Category: {
        ...published.Category,
        Type: { Status: 'active', PubliclyReadable: false },
      },
    },
    {
      Category: {
        ...published.Category,
        Type: { Status: 'inactive', PubliclyReadable: true },
      },
    },
  ])(
    'does not index articles with unavailable publication/category: %j',
    async (change) => {
      const { handler, writer, indexing } = setup({ ...published, ...change });
      await expect(handler.handle(event)).resolves.toBe(true);
      expect(writer.disable).toHaveBeenCalledWith('article:19');
      expect(indexing.index).not.toHaveBeenCalled();
    },
  );

  it('reads article and public field definitions in one RepeatableRead snapshot', async () => {
    const { handler, prisma } = setup(published);
    await handler.handle(event);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
    expect(prisma.customFieldDefinition.findMany).toHaveBeenCalledWith({
      where: {
        EntityType: 'article',
        Status: 'active',
        IsPublic: true,
        Group: { Status: 'active' },
        OR: [
          { OptionsDictType: null },
          { OptionsType: { Status: 'active', PubliclyReadable: true } },
        ],
      },
      select: {
        FieldKey: true,
        Label: true,
        OptionsType: {
          select: {
            Items: {
              where: { Status: 'active' },
              select: { Value: true, Label: true },
            },
          },
        },
      },
    });
  });
  it('indexes only a published non-deleted article and public custom fields', async () => {
    const { handler, indexing, complete } = setup(published);
    await expect(handler.handle(event)).resolves.toBe(true);
    expect(indexing.index).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceKey: 'article:19',
        sourceType: 'article',
        accessScope: 'public',
        merchantId: null,
        title: '初学者如何选雪道',
        content: expect.stringContaining(
          '难度等级：{"value":"beginner","options":[]}',
        ),
      }),
    );
    const indexed = indexing.index.mock.calls[0]?.[0] as
      { content: string } | undefined;
    expect(indexed).toBeDefined();
    expect(indexed?.content).not.toContain('不可公开');
    expect(complete).toHaveBeenCalledOnce();
  });

  it('disables withdrawn or missing articles and skips duplicate events', async () => {
    const withdrawn = setup({ ...published, Status: 'withdrawn' });
    await expect(withdrawn.handler.handle(event)).resolves.toBe(true);
    expect(withdrawn.writer.disable).toHaveBeenCalledWith('article:19');
    expect(withdrawn.indexing.index).not.toHaveBeenCalled();

    const missing = setup(null);
    await expect(missing.handler.handle(event)).resolves.toBe(true);
    expect(missing.writer.disable).toHaveBeenCalledWith('article:19');

    const duplicate = setup(published, undefined, true);
    await expect(duplicate.handler.handle(event)).resolves.toBe(false);
    expect(duplicate.indexing.index).not.toHaveBeenCalled();
  });

  it('ignores unrelated events and rejects malformed article identifiers', async () => {
    const { handler, claim } = setup(published);
    await expect(
      handler.handle({ ...event, eventType: 'resort.changed.v1' }),
    ).resolves.toBe(false);
    expect(claim).not.toHaveBeenCalled();
    await expect(
      handler.handle({ ...event, payload: { articleId: '19' } }),
    ).rejects.toThrow('positive integer articleId');
  });
});
