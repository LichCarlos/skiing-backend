import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../src/shared/persistence/prisma.service.js';
import { PrismaRagCandidateRetriever } from '../src/modules/ai-assistant/infrastructure/prisma-rag-candidate-retriever.js';
import { PrismaRagDocumentWriter } from '../src/modules/ai-assistant/infrastructure/prisma-rag-document-writer.js';
import { PrismaRagSourceReader } from '../src/modules/ai-assistant/infrastructure/prisma-rag-source.reader.js';
import { PrismaInboxExecutor } from '../src/modules/integration-events/infrastructure/prisma-inbox.executor.js';
import { ArticleRagEventHandler } from '../src/modules/ai-assistant/application/article-rag-event-handler.js';
import { ProjectKnowledgeRagEventHandler } from '../src/modules/ai-assistant/application/project-knowledge-rag-event-handler.js';
import { RagInboxBusyError } from '../src/modules/ai-assistant/application/claim-rag-event.js';
import { RagDocumentIndexingService } from '../src/modules/ai-assistant/application/rag-document-indexing.service.js';
import type { RagIndexDocument } from '../src/modules/ai-assistant/application/ports/rag-document-writer.js';
import type { EmbeddingProvider } from '../src/modules/ai-assistant/application/ports/embedding-provider.js';
import {
  articleSourceState,
  dictionarySourceState,
  dynamicSourceState,
  projectSourceState,
  resortSourceState,
} from '../src/modules/ai-assistant/domain/rag-source-state.js';

describe('RAG current-source PostgreSQL/pgvector checks (dedicated migrated DB)', () => {
  const prisma = new PrismaService();
  const vector = Array.from({ length: 1024 }, (_, index) =>
    index === 0 ? 1 : 0,
  );
  const embed = vi
    .fn<EmbeddingProvider['embed']>()
    .mockImplementation(async (texts) => texts.map(() => vector));
  const indexing = new RagDocumentIndexingService(
    new ConfigService({ EMBEDDING_MODEL: 'BAAI/bge-m3' }),
    { embed },
    new PrismaRagDocumentWriter(prisma),
  );
  const retriever = new PrismaRagCandidateRetriever(prisma);
  const ids = {
    resorts: [] as number[],
    articles: [] as number[],
    projects: [] as number[],
    dynamics: [] as number[],
  };
  const sourceKeys: string[] = [];
  const eventIds: string[] = [];
  const dictType = `rag-test-${randomUUID()}`;
  const fieldKey = `rag_${randomUUID().replaceAll('-', '')}`;
  const groupKey = `rag-${randomUUID()}`;
  const articleCategoryValue = `rag-category-${randomUUID()}`;
  let categoryTypeCreated = false,
    articleCategoryId: number;
  let userId: number;
  let parent: { ItemId: number; ParentId: number | null; Label: string };
  let child: typeof parent & { Value: string };

  beforeAll(async () => {
    if (!process.env.DATABASE_URL)
      throw new Error('Dedicated migrated DATABASE_URL is required');
    await prisma.$connect();
    const articleCategoryType = await prisma.dictionaryType.findUnique({
      where: { DictType: 'knowledge.article_category' },
    });
    if (articleCategoryType)
      expect(articleCategoryType).toMatchObject({
        Status: 'active',
        PubliclyReadable: true,
      });
    else {
      await prisma.dictionaryType.create({
        data: {
          DictType: 'knowledge.article_category',
          DictName: 'Categories',
          GroupKey: 'knowledge',
          PubliclyReadable: true,
        },
      });
      categoryTypeCreated = true;
    }
    const articleCategory = await prisma.dictionaryItem.create({
      data: {
        DictType: 'knowledge.article_category',
        Value: articleCategoryValue,
        Label: 'Test article category',
      },
    });
    articleCategoryId = articleCategory.ItemId;
    const user = await prisma.user.create({
      data: {
        Account: `rag-${randomUUID()}`,
        PasswordHash: 'test-only',
        Nickname: '雪友',
        Status: 'active',
      },
    });
    userId = user.UserId;
    await prisma.dictionaryType.create({
      data: {
        DictType: dictType,
        DictName: '技能',
        GroupKey: 'test',
        PubliclyReadable: true,
      },
    });
    parent = await prisma.dictionaryItem.create({
      data: { DictType: dictType, Label: '初级', Value: 'beginner' },
    });
    child = await prisma.dictionaryItem.create({
      data: {
        DictType: dictType,
        Label: '转弯',
        Value: 'turn',
        ParentId: parent.ItemId,
      },
    });
    await prisma.customFieldGroup.create({
      data: { EntityType: 'article', GroupKey: groupKey, Label: '测试' },
    });
    // GroupKey is unique only within EntityType; an active resort group must
    // never make a disabled article group publicly readable.
    await prisma.customFieldGroup.create({
      data: {
        EntityType: 'ski_resort',
        GroupKey: groupKey,
        Label: 'Resort group',
      },
    });
    await prisma.customFieldDefinition.create({
      data: {
        EntityType: 'article',
        GroupKey: groupKey,
        FieldKey: fieldKey,
        Label: '公开内容',
        DataType: 'text',
        Status: 'active',
        IsPublic: true,
      },
    });
  });
  afterAll(async () => {
    try {
      if (eventIds.length)
        await prisma.consumedEvent.deleteMany({
          where: { EventId: { in: eventIds } },
        });
      if (sourceKeys.length)
        await prisma.ragDocument.deleteMany({
          where: { SourceKey: { in: sourceKeys } },
        });
      await prisma.dynamic.deleteMany({
        where: { DynamicId: { in: ids.dynamics } },
      });
      await prisma.article.deleteMany({
        where: { ArticleId: { in: ids.articles } },
      });
      await prisma.projectKnowledge.deleteMany({
        where: { ProjectKnowledgeId: { in: ids.projects } },
      });
      await prisma.skiResort.deleteMany({
        where: { ResortId: { in: ids.resorts } },
      });
      await prisma.customFieldDefinition.deleteMany({
        where: { EntityType: 'article', FieldKey: fieldKey },
      });
      await prisma.customFieldGroup.deleteMany({
        where: {
          EntityType: { in: ['article', 'ski_resort'] },
          GroupKey: groupKey,
        },
      });
      // Children first: the dictionary parent FK is restrictive.
      await prisma.dictionaryItem.updateMany({
        where: { DictType: dictType },
        data: { ParentId: null },
      });
      await prisma.dictionaryItem.deleteMany({ where: { DictType: dictType } });
      await prisma.dictionaryType.deleteMany({ where: { DictType: dictType } });
      if (articleCategoryId)
        await prisma.dictionaryItem.delete({
          where: { ItemId: articleCategoryId },
        });
      if (categoryTypeCreated)
        await prisma.dictionaryType.delete({
          where: { DictType: 'knowledge.article_category' },
        });
      if (userId) await prisma.user.deleteMany({ where: { UserId: userId } });
    } finally {
      await prisma.$disconnect();
    }
  });
  async function index(document: RagIndexDocument) {
    sourceKeys.push(document.sourceKey);
    await indexing.index(document);
  }
  async function visible(sourceKey: string) {
    const rows = await retriever.search(
      { embedding: vector, embeddingModel: 'BAAI/bge-m3', limit: 100 },
      { public: true, merchant: { kind: 'none' }, admin: false },
    );
    return rows.some((row) => row.sourceKey === sourceKey);
  }
  async function resort() {
    const row = await prisma.skiResort.create({
      data: {
        Name: '北山',
        LegacyDistance: 0,
        Price: 100,
        SnowCondition: 'powder',
        Description: '简介',
        Status: 'published',
      },
      include: { FitTags: { include: { Item: true } } },
    });
    ids.resorts.push(row.ResortId);
    const sourceKey = `resort:${row.ResortId}`;
    const document: RagIndexDocument = {
      sourceKey,
      sourceType: 'resort',
      sourceId: row.ResortId,
      title: row.Name,
      content: '雪场公开资料',
      accessScope: 'public',
      merchantId: null,
      sourceUpdatedAt: row.UpdateTime,
      sourceState: resortSourceState(row),
    };
    await index(document);
    return { row, sourceKey, document };
  }

  it('hides resort review/deletion and same-timestamp content changes before Kafka catches up', async () => {
    const { row, sourceKey, document } = await resort();
    expect(await visible(sourceKey)).toBe(true);
    await prisma.skiResort.update({
      where: { ResortId: row.ResortId },
      data: { Status: 'pending_review' },
    });
    expect(await visible(sourceKey)).toBe(false);
    const changed = await prisma.skiResort.update({
      where: { ResortId: row.ResortId },
      data: { Status: 'published', Price: 101, UpdateTime: row.UpdateTime },
      include: { FitTags: { include: { Item: true } } },
    });
    expect(await visible(sourceKey)).toBe(false);
    await index({
      ...document,
      sourceState: resortSourceState(changed),
      content: '新价格 101',
    });
    expect(await visible(sourceKey)).toBe(true);
    await prisma.skiResort.update({
      where: { ResortId: row.ResortId },
      data: { DeletedAt: new Date() },
    });
    expect(await visible(sourceKey)).toBe(false);
  });

  it('rejects legacy snapshots and revoked/renamed public article fields without source timestamp changes', async () => {
    const row = await prisma.article.create({
      data: {
        Title: '指南',
        Summary: '摘要',
        Body: '正文',
        CategoryDictType: 'knowledge.article_category',
        CategoryValue: articleCategoryValue,
        Status: 'published',
        PublishTime: new Date(),
        CustomFields: { [fieldKey]: [false, 0, '雪'], private: 'secret' },
      },
    });
    ids.articles.push(row.ArticleId);
    const sourceKey = `article:${row.ArticleId}`;
    const document: RagIndexDocument = {
      sourceKey,
      sourceType: 'article',
      sourceId: row.ArticleId,
      title: row.Title,
      content: '文章公开内容',
      accessScope: 'public',
      merchantId: null,
      sourceUpdatedAt: row.UpdateTime,
    };
    await index(document);
    expect(await visible(sourceKey)).toBe(false);
    await index({
      ...document,
      sourceState: articleSourceState(row, [
        { FieldKey: fieldKey, Label: '公开内容' },
      ]),
    });
    expect(await visible(sourceKey)).toBe(true);
    await prisma.dictionaryItem.update({
      where: { ItemId: articleCategoryId },
      data: { Status: 'disabled' },
    });
    expect(await visible(sourceKey)).toBe(false);
    await prisma.dictionaryItem.update({
      where: { ItemId: articleCategoryId },
      data: { Status: 'active' },
    });
    expect(await visible(sourceKey)).toBe(true);
    try {
      await prisma.dictionaryType.update({
        where: { DictType: 'knowledge.article_category' },
        data: { PubliclyReadable: false },
      });
      expect(await visible(sourceKey)).toBe(false);
    } finally {
      await prisma.dictionaryType.update({
        where: { DictType: 'knowledge.article_category' },
        data: { PubliclyReadable: true },
      });
    }
    await prisma.article.update({
      where: { ArticleId: row.ArticleId },
      data: { PublishTime: null },
    });
    expect(await visible(sourceKey)).toBe(false);
    await prisma.article.update({
      where: { ArticleId: row.ArticleId },
      data: { PublishTime: row.PublishTime },
    });
    expect(await visible(sourceKey)).toBe(true);
    await prisma.customFieldDefinition.updateMany({
      where: { EntityType: 'article', FieldKey: fieldKey },
      data: { Label: '新名称' },
    });
    expect(await visible(sourceKey)).toBe(false);
    await prisma.customFieldDefinition.updateMany({
      where: { EntityType: 'article', FieldKey: fieldKey },
      data: { IsPublic: false },
    });
    await index({ ...document, sourceState: articleSourceState(row, []) });
    expect(await visible(sourceKey)).toBe(true);
    await prisma.article.update({
      where: { ArticleId: row.ArticleId },
      data: { Body: '更正后的正文', UpdateTime: row.UpdateTime },
    });
    expect(await visible(sourceKey)).toBe(false);
    await prisma.article.update({
      where: { ArticleId: row.ArticleId },
      data: { Status: 'withdrawn' },
    });
    expect(await visible(sourceKey)).toBe(false);
  });

  it('processes sources through real reader/Inbox/writer and disables a revoked category', async () => {
    const row = await prisma.article.create({
      data: {
        Title: 'Source reader',
        Summary: 'Summary',
        Body: 'Ski safety',
        CategoryValue: articleCategoryValue,
        Status: 'published',
        PublishTime: new Date(),
      },
    });
    ids.articles.push(row.ArticleId);
    sourceKeys.push(`article:${row.ArticleId}`);
    const inbox = new PrismaInboxExecutor(prisma);
    const handler = new ArticleRagEventHandler(
      new PrismaRagSourceReader(prisma),
      inbox,
      indexing,
      new PrismaRagDocumentWriter(prisma),
    );
    const event = {
      eventId: randomUUID(),
      eventType: 'article.changed.v1',
      aggregateType: 'article',
      aggregateId: String(row.ArticleId),
      occurredAt: new Date(),
      payload: { articleId: row.ArticleId },
    };
    eventIds.push(event.eventId);
    await expect(handler.handle(event)).resolves.toBe(true);
    await expect(handler.handle(event)).resolves.toBe(false);
    expect(await visible(`article:${row.ArticleId}`)).toBe(true);
    const changed = { ...event, eventId: randomUUID() };
    eventIds.push(changed.eventId);
    try {
      await prisma.dictionaryItem.update({
        where: { ItemId: articleCategoryId },
        data: { Status: 'disabled' },
      });
      await expect(handler.handle(changed)).resolves.toBe(true);
      expect(
        await prisma.ragDocument.findUnique({
          where: { SourceKey: `article:${row.ArticleId}` },
          select: { Status: true, _count: { select: { Chunks: true } } },
        }),
      ).toEqual({ Status: 'disabled', _count: { Chunks: 0 } });
    } finally {
      await prisma.dictionaryItem.update({
        where: { ItemId: articleCategoryId },
        data: { Status: 'active' },
      });
    }
  });

  it('hides indexed fields as soon as their group is disabled and safely reindexes/restores them', async () => {
    const row = await prisma.article.create({
      data: {
        Title: 'Group visibility',
        Summary: 'Summary',
        Body: 'Public ski guidance',
        CategoryValue: articleCategoryValue,
        Status: 'published',
        PublishTime: new Date(),
        CustomFields: { [fieldKey]: 'group-public-marker' },
      },
    });
    ids.articles.push(row.ArticleId);
    const key = `article:${row.ArticleId}`;
    sourceKeys.push(key);
    const reader = new PrismaRagSourceReader(prisma);
    const handler = new ArticleRagEventHandler(
      reader,
      new PrismaInboxExecutor(prisma),
      indexing,
      new PrismaRagDocumentWriter(prisma),
    );
    async function replay() {
      const eventId = randomUUID();
      eventIds.push(eventId);
      await expect(
        handler.handle({
          eventId,
          eventType: 'article.changed.v1',
          aggregateType: 'article',
          aggregateId: String(row.ArticleId),
          occurredAt: new Date(),
          payload: { articleId: row.ArticleId },
        }),
      ).resolves.toBe(true);
    }
    const groupWhere = {
      EntityType_GroupKey: { EntityType: 'article', GroupKey: groupKey },
    };
    // The preceding revocation test intentionally left this definition private.
    await prisma.customFieldDefinition.updateMany({
      where: { EntityType: 'article', FieldKey: fieldKey },
      data: { IsPublic: true },
    });
    try {
      await replay();
      expect(await visible(key)).toBe(true);
      await prisma.customFieldGroup.update({
        where: groupWhere,
        data: { Status: 'disabled' },
      });
      // Kafka has not run; source timestamp, field status and IsPublic are unchanged.
      expect(await visible(key)).toBe(false);
      const source = await reader.findArticle(row.ArticleId);
      expect(source?.publicFields).toEqual([]);
      expect(source?.sourceState).toEqual(articleSourceState(row, []));
      await replay();
      expect(await visible(key)).toBe(true);
      const document = await prisma.ragDocument.findUniqueOrThrow({
        where: { SourceKey: key },
        include: { Chunks: true },
      });
      expect(JSON.stringify(document.Metadata)).not.toContain(
        'group-public-marker',
      );
      expect(
        document.Chunks.map((chunk) => chunk.ChunkContent).join(''),
      ).not.toContain('group-public-marker');
      // Restoring the group changes the effective public projection again.
      await prisma.customFieldGroup.update({
        where: groupWhere,
        data: { Status: 'active' },
      });
      expect(await visible(key)).toBe(false);
      await replay();
      expect(await visible(key)).toBe(true);
      expect((await reader.findArticle(row.ArticleId))?.publicFields).toEqual([
        expect.objectContaining({
          fieldKey,
          value: { value: 'group-public-marker', options: [] },
        }),
      ]);
    } finally {
      await prisma.customFieldGroup.update({
        where: groupWhere,
        data: { Status: 'active' },
      });
      await prisma.customFieldDefinition.updateMany({
        where: { EntityType: 'article', FieldKey: fieldKey },
        data: { IsPublic: false },
      });
    }
  });

  it('keeps articles without values in the disabled group visible', async () => {
    const row = await prisma.article.create({
      data: {
        Title: 'No group values',
        Summary: 'Summary',
        Body: 'Public ski guidance',
        CategoryValue: articleCategoryValue,
        Status: 'published',
        PublishTime: new Date(),
        CustomFields: { unrelated: 'not-public' },
      },
    });
    ids.articles.push(row.ArticleId);
    const sourceKey = `article:${row.ArticleId}`;
    await index({
      sourceKey,
      sourceType: 'article',
      sourceId: row.ArticleId,
      title: row.Title,
      content: row.Body,
      accessScope: 'public',
      merchantId: null,
      sourceUpdatedAt: row.UpdateTime,
      sourceState: articleSourceState(row, []),
    });
    const where = {
      EntityType_GroupKey: { EntityType: 'article', GroupKey: groupKey },
    };
    try {
      await prisma.customFieldDefinition.updateMany({
        where: { EntityType: 'article', FieldKey: fieldKey },
        data: { IsPublic: true },
      });
      expect(await visible(sourceKey)).toBe(true);
      await prisma.customFieldGroup.update({
        where,
        data: { Status: 'disabled' },
      });
      expect(await visible(sourceKey)).toBe(true);
    } finally {
      await prisma.customFieldGroup.update({
        where,
        data: { Status: 'active' },
      });
      await prisma.customFieldDefinition.updateMany({
        where: { EntityType: 'article', FieldKey: fieldKey },
        data: { IsPublic: false },
      });
    }
  });

  it('filters revoked group values before the vector LIMIT so a valid fallback is returned', async () => {
    const keys: string[] = [];
    const definition = await prisma.customFieldDefinition.findUniqueOrThrow({
      where: {
        EntityType_FieldKey: { EntityType: 'article', FieldKey: fieldKey },
      },
    });
    for (const revoked of [true, false]) {
      const row = await prisma.article.create({
        data: {
          Title: revoked ? 'Revoked closest source' : 'Authorized fallback',
          Summary: 'Summary',
          Body: 'Ski guidance',
          CategoryValue: articleCategoryValue,
          Status: 'published',
          PublishTime: new Date(),
          CustomFields: revoked ? { [fieldKey]: 'rank-private-marker' } : {},
        },
      });
      ids.articles.push(row.ArticleId);
      const sourceKey = `article:${row.ArticleId}`;
      keys.push(sourceKey);
      await index({
        sourceKey,
        sourceType: 'article',
        sourceId: row.ArticleId,
        title: row.Title,
        content: row.Body,
        accessScope: 'public',
        merchantId: null,
        sourceUpdatedAt: row.UpdateTime,
        sourceState: articleSourceState(
          row,
          revoked ? [{ FieldKey: fieldKey, Label: definition.Label }] : [],
        ),
      });
      const embedding = Array.from({ length: 1024 }, (_, i) =>
        i === 1 ? 1 : i === 2 && !revoked ? 0.1 : 0,
      );
      // All other fixture vectors point at axis 0. These two local documents
      // point near axis 1, making their order deterministic for this query.
      await prisma.$executeRaw`
        UPDATE "RagChunk" chunk SET "Embedding" = ${`[${embedding.join(',')}]`}::vector(1024)
        FROM "RagDocument" document
        WHERE chunk."RagDocumentId" = document."RagDocumentId"
          AND document."SourceKey" = ${sourceKey}
      `;
    }
    const where = {
      EntityType_GroupKey: { EntityType: 'article', GroupKey: groupKey },
    };
    const query = {
      embedding: Array.from({ length: 1024 }, (_, i) => (i === 1 ? 1 : 0)),
      embeddingModel: 'BAAI/bge-m3',
      limit: 1,
    };
    const access = {
      public: true,
      merchant: { kind: 'none' as const },
      admin: false,
    };
    try {
      await prisma.customFieldDefinition.updateMany({
        where: { EntityType: 'article', FieldKey: fieldKey },
        data: { IsPublic: true },
      });
      expect(
        (await retriever.search(query, access)).map((item) => item.sourceKey),
      ).toEqual([keys[0]]);
      await prisma.customFieldGroup.update({
        where,
        data: { Status: 'disabled' },
      });
      expect(
        (await retriever.search(query, access)).map((item) => item.sourceKey),
      ).toEqual([keys[1]]);
    } finally {
      await prisma.customFieldGroup.update({
        where,
        data: { Status: 'active' },
      });
      await prisma.customFieldDefinition.updateMany({
        where: { EntityType: 'article', FieldKey: fieldKey },
        data: { IsPublic: false },
      });
    }
  });

  it('leaves a live Inbox lease unacknowledged and succeeds after its owner releases it', async () => {
    const inbox = new PrismaInboxExecutor(prisma);
    const handler = new ArticleRagEventHandler(
      new PrismaRagSourceReader(prisma),
      inbox,
      indexing,
      new PrismaRagDocumentWriter(prisma),
    );
    const event = {
      eventId: randomUUID(),
      eventType: 'article.changed.v1',
      aggregateType: 'article',
      aggregateId: '2147483647',
      occurredAt: new Date(),
      payload: { articleId: 2147483647 },
    };
    eventIds.push(event.eventId);
    const identity = {
      consumerKey: 'rag-article-indexer.v1',
      eventId: event.eventId,
      eventType: event.eventType,
    };
    const claim = await inbox.claim(identity);
    expect(claim).not.toBeNull();
    await expect(handler.handle(event)).rejects.toBeInstanceOf(
      RagInboxBusyError,
    );
    expect(await inbox.isProcessed(identity)).toBe(false);
    await inbox.release(identity, claim!);
    await expect(handler.handle(event)).resolves.toBe(true);
    expect(await inbox.isProcessed(identity)).toBe(true);
  });

  it('checks project status and dynamic author/resort dependencies in the same SQL snapshot', async () => {
    const p = await prisma.projectKnowledge.create({
      data: {
        Title: '规则',
        Content: '公开规则',
        Category: 'faq',
        Status: 'published',
        PublishTime: new Date(),
      },
    });
    ids.projects.push(p.ProjectKnowledgeId);
    const key = `project:${p.ProjectKnowledgeId}`;
    await index({
      sourceKey: key,
      sourceType: 'project_doc',
      sourceId: p.ProjectKnowledgeId,
      title: p.Title,
      content: p.Content,
      accessScope: 'public',
      merchantId: null,
      sourceUpdatedAt: p.UpdateTime,
      sourceState: projectSourceState(p),
    });
    expect(await visible(key)).toBe(true);
    await prisma.projectKnowledge.update({
      where: { ProjectKnowledgeId: p.ProjectKnowledgeId },
      data: { Status: 'withdrawn' },
    });
    expect(await visible(key)).toBe(false);
    const r = await resort();
    const d = await prisma.dynamic.create({
      data: {
        AuthorId: userId,
        ResortId: r.row.ResortId,
        Content: '雪况好',
        Status: 'published',
      },
      include: { Author: true, Resort: true },
    });
    ids.dynamics.push(d.DynamicId);
    const dynamicKey = `dynamic:${d.DynamicId}`;
    await index({
      sourceKey: dynamicKey,
      sourceType: 'dynamic',
      sourceId: d.DynamicId,
      title: '滑雪动态',
      content: d.Content,
      accessScope: 'public',
      merchantId: null,
      sourceUpdatedAt: d.UpdateTime,
      sourceState: dynamicSourceState(d),
    });
    expect(await visible(dynamicKey)).toBe(true);
    await prisma.user.update({
      where: { UserId: userId },
      data: { Nickname: '新昵称' },
    });
    expect(await visible(dynamicKey)).toBe(false);
    await prisma.user.update({
      where: { UserId: userId },
      data: { Nickname: '雪友', Status: 'disabled' },
    });
    expect(await visible(dynamicKey)).toBe(false);
    await prisma.user.update({
      where: { UserId: userId },
      data: { Status: 'active' },
    });
    await prisma.skiResort.update({
      where: { ResortId: r.row.ResortId },
      data: { Status: 'pending_review' },
    });
    expect(await visible(dynamicKey)).toBe(false);
  });

  it.each([
    { Title: 'api_key=legacy-title-marker' },
    { Content: 'password=legacy-content-marker' },
    { Category: 'person@example.org' },
    { SourceUrl: 'https://person:legacy-password@example.org/guide' },
    { SourceUrl: 'https://example.org/?api%5Fkey=legacy-url-marker' },
    { SourceUrl: 'javascript:alert(1)' },
    { Content: '-----BEGIN PRIVATE KEY-----' },
  ])(
    'blocks unchanged published legacy knowledge and disables its chunks on replay: %j',
    async (change) => {
      const row = await prisma.projectKnowledge.create({
        data: {
          Title: 'Legacy knowledge',
          Content: 'Public ski guidance',
          Category: 'faq',
          Status: 'published',
          PublishTime: new Date(),
          ...change,
        },
      });
      ids.projects.push(row.ProjectKnowledgeId);
      const key = `project:${row.ProjectKnowledgeId}`;
      await index({
        sourceKey: key,
        sourceType: 'project_doc',
        sourceId: row.ProjectKnowledgeId,
        title: row.Title,
        content: row.Content,
        accessScope: 'public',
        merchantId: null,
        sourceUpdatedAt: row.UpdateTime,
        sourceState: { ...projectSourceState(row), v: 1 },
      });
      // The business source and legacy indexed snapshot still match exactly.
      expect(await visible(key)).toBe(false);
      const reader = new PrismaRagSourceReader(prisma);
      expect(
        await reader.findProjectKnowledge(row.ProjectKnowledgeId),
      ).toBeNull();
      const handler = new ProjectKnowledgeRagEventHandler(
        reader,
        new PrismaInboxExecutor(prisma),
        indexing,
        new PrismaRagDocumentWriter(prisma),
      );
      const eventId = randomUUID();
      eventIds.push(eventId);
      await expect(
        handler.handle({
          eventId,
          eventType: 'project_doc.changed.v1',
          aggregateType: 'project_doc',
          aggregateId: String(row.ProjectKnowledgeId),
          occurredAt: new Date(),
          payload: { projectKnowledgeId: row.ProjectKnowledgeId },
        }),
      ).resolves.toBe(true);
      expect(
        await prisma.ragDocument.findUnique({
          where: { SourceKey: key },
          select: { Status: true, _count: { select: { Chunks: true } } },
        }),
      ).toEqual({ Status: 'disabled', _count: { Chunks: 0 } });
      expect(
        await prisma.projectKnowledge.findUnique({
          where: { ProjectKnowledgeId: row.ProjectKnowledgeId },
        }),
      ).toEqual(row);
    },
  );

  it('requires safe legacy knowledge to be revalidated before recovering retrieval and preserves raw source identity', async () => {
    const row = await prisma.projectKnowledge.create({
      data: {
        Title: '  Public account guidance  ',
        Content: 'Use account settings to change your password.',
        Category: ' faq ',
        SourceUrl: 'https://example.org',
        Status: 'published',
        PublishTime: new Date(),
      },
    });
    ids.projects.push(row.ProjectKnowledgeId);
    const key = `project:${row.ProjectKnowledgeId}`;
    const legacy = {
      sourceKey: key,
      sourceType: 'project_doc',
      sourceId: row.ProjectKnowledgeId,
      title: row.Title,
      content: row.Content,
      accessScope: 'public',
      merchantId: null,
      sourceUpdatedAt: row.UpdateTime,
      sourceState: { ...projectSourceState(row), v: 1 },
    } as const;
    await index(legacy);
    expect(await visible(key)).toBe(false);
    const before = await prisma.ragDocument.findUniqueOrThrow({
      where: { SourceKey: key },
    });
    const reader = new PrismaRagSourceReader(prisma);
    const source = await reader.findProjectKnowledge(row.ProjectKnowledgeId);
    expect(source?.sourceState).toEqual({ ...projectSourceState(row), v: 2 });
    expect(source?.sourceUrl).toBe('https://example.org');
    const handler = new ProjectKnowledgeRagEventHandler(
      reader,
      new PrismaInboxExecutor(prisma),
      indexing,
      new PrismaRagDocumentWriter(prisma),
    );
    async function replay() {
      const eventId = randomUUID();
      eventIds.push(eventId);
      await handler.handle({
        eventId,
        eventType: 'project_doc.changed.v1',
        aggregateType: 'project_doc',
        aggregateId: String(row.ProjectKnowledgeId),
        occurredAt: new Date(),
        payload: { projectKnowledgeId: row.ProjectKnowledgeId },
      });
    }
    await replay();
    expect(await visible(key)).toBe(true);
    const reindexed = await prisma.ragDocument.findUniqueOrThrow({
      where: { SourceKey: key },
    });
    expect(reindexed.ContentHash).not.toBe(before.ContentHash);
    const embeddingCalls = embed.mock.calls.length;
    await replay();
    expect(embed.mock.calls).toHaveLength(embeddingCalls);
    expect(
      (
        await prisma.ragDocument.findUniqueOrThrow({
          where: { SourceKey: key },
        })
      ).ContentHash,
    ).toBe(reindexed.ContentHash);
    await prisma.projectKnowledge.update({
      where: { ProjectKnowledgeId: row.ProjectKnowledgeId },
      data: {
        Category: 'api_key=changed-after-index',
        UpdateTime: row.UpdateTime,
      },
    });
    expect(await visible(key)).toBe(false);
    await replay();
    expect(
      await prisma.ragDocument.findUnique({
        where: { SourceKey: key },
        select: { Status: true },
      }),
    ).toEqual({ Status: 'disabled' });
  });

  it('rejects private dictionaries, renamed ancestors, broken/cyclic paths and changed source keys', async () => {
    const sourceKey = `dictionary:${dictType}:${child.Value}`;
    const document: RagIndexDocument = {
      sourceKey,
      sourceType: 'dictionary',
      sourceId: child.ItemId,
      title: '技能：转弯',
      content: '初级 / 转弯',
      accessScope: 'public',
      merchantId: null,
      sourceUpdatedAt: new Date(),
      sourceState: dictionarySourceState(dictType, '技能', child.Value, [
        parent,
        child,
      ]),
    };
    await index(document);
    expect(await visible(sourceKey)).toBe(true);
    await prisma.dictionaryItem.update({
      where: { ItemId: parent.ItemId },
      data: { Label: '高级' },
    });
    expect(await visible(sourceKey)).toBe(false);
    await prisma.dictionaryItem.update({
      where: { ItemId: parent.ItemId },
      data: { Label: parent.Label, Status: 'disabled' },
    });
    expect(await visible(sourceKey)).toBe(false);
    await prisma.dictionaryItem.update({
      where: { ItemId: parent.ItemId },
      data: { Status: 'active', ParentId: child.ItemId },
    });
    expect(await visible(sourceKey)).toBe(false);
    await prisma.dictionaryItem.update({
      where: { ItemId: parent.ItemId },
      data: { ParentId: null },
    });
    await prisma.dictionaryType.update({
      where: { DictType: dictType },
      data: { PubliclyReadable: false },
    });
    expect(await visible(sourceKey)).toBe(false);
    await prisma.dictionaryType.update({
      where: { DictType: dictType },
      data: { PubliclyReadable: true },
    });
    await prisma.ragDocument.update({
      where: { SourceKey: sourceKey },
      data: { SourceKey: `${sourceKey}:wrong` },
    });
    sourceKeys.push(`${sourceKey}:wrong`);
    expect(await visible(`${sourceKey}:wrong`)).toBe(false);
  });
});
