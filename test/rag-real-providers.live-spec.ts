import { ConfigModule } from '@nestjs/config';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AiAssistantModule } from '../src/modules/ai-assistant/ai-assistant.module.js';
import { RagDocumentIndexingService } from '../src/modules/ai-assistant/application/rag-document-indexing.service.js';
import { RagRetrievalService } from '../src/modules/ai-assistant/application/rag-retrieval.service.js';
import { ProjectKnowledgeRagEventHandler } from '../src/modules/ai-assistant/application/project-knowledge-rag-event-handler.js';
import { INBOX_LEASE } from '../src/modules/integration-events/application/ports/inbox-lease.js';
import { PrismaInboxExecutor } from '../src/modules/integration-events/infrastructure/prisma-inbox.executor.js';
import { contextualRetrievalQuery } from '../src/modules/ai-assistant/domain/conversation-context.js';
import {
  projectSourceState,
  articleSourceState,
  resortSourceState,
} from '../src/modules/ai-assistant/domain/rag-source-state.js';
import { OpenAiCompatibleEmbeddingProvider } from '../src/modules/ai-assistant/infrastructure/openai-compatible-embedding.provider.js';
import { OpenAiCompatibleChatModelProvider } from '../src/modules/ai-assistant/infrastructure/openai-compatible-chat-model.provider.js';
import {
  EMBEDDING_PROVIDER,
  type EmbeddingProvider,
} from '../src/modules/ai-assistant/application/ports/embedding-provider.js';
import {
  CHAT_MODEL_PROVIDER,
  type ChatModelProvider,
} from '../src/modules/ai-assistant/application/ports/chat-model-provider.js';
import { RAG_QUERY_PERMISSION } from '../src/modules/identity-access/domain/permissions.js';
import { IdentityAccessModule } from '../src/modules/identity-access/identity-access.module.js';
import { BcryptPasswordHasher } from '../src/modules/identity-access/infrastructure/bcrypt-password-hasher.js';
import { DatabaseModule } from '../src/shared/persistence/database.module.js';
import { PrismaService } from '../src/shared/persistence/prisma.service.js';
import { configureHttp } from '../src/shared/http/configure-http.js';
import {
  liveResorts,
  liveArticles,
  liveProjectDocuments,
  liveRetrievalQuestions,
} from './fixtures/rag-live-corpus.js';

// Explicit paid-provider opt-in. No provider overrides and no synthetic vectors.
describe('real BGE-M3 / pgvector / DeepSeek / authenticated Nest SSE', () => {
  let app: INestApplication<App>, http: App, prisma: PrismaService;
  let embed: EmbeddingProvider, chat: ChatModelProvider;
  let embeddingCalls = 0,
    chatCalls = 0;
  const key = `live-${randomUUID().slice(0, 8)}`;
  const sources = new Map<string, string>();
  const resortIds: number[] = [],
    articleIds: number[] = [],
    projectIds: number[] = [],
    userIds: number[] = [];
  const results: Record<string, unknown>[] = [];
  const forbiddenSources: string[] = [];
  const eventIds: string[] = [];
  let categoryTypeCreated = false;
  let actor: { id: number; token: string },
    other: { id: number; token: string };
  let passwordHash: string, categoryId: number, roleId: number;
  let conversationId: string,
    firstRequestId: string,
    firstMessage: Record<string, unknown>;
  const password = `test-only-${randomUUID()}`;
  const base = '/api/v1/ai/conversations';
  let output: string;

  beforeAll(async () => {
    if (process.env.LINJI_REAL_RAG_CONFIRM !== 'linji_real_rag_validation')
      throw new Error(
        'Explicit live provider and disposable database confirmation required',
      );
    const database = new URL(process.env.DATABASE_URL ?? '');
    if (
      !['localhost', '127.0.0.1'].includes(database.hostname) ||
      database.pathname !== '/linji_real_rag_validation'
    )
      throw new Error('Dedicated loopback live RAG database required');
    for (const name of [
      'EMBEDDING_BASE_URL',
      'EMBEDDING_MODEL',
      'EMBEDDING_API_KEY',
      'CHAT_MODEL_BASE_URL',
      'CHAT_MODEL_NAME',
      'CHAT_MODEL_API_KEY',
      'LINJI_REAL_RAG_RUN',
    ])
      if (!process.env[name])
        throw new Error('Live provider configuration incomplete');
    const configuredOutput = process.env.LINJI_REAL_RAG_RUN!;
    if (!isAbsolute(configuredOutput))
      throw new Error('Absolute independent live output required');
    output = resolve(configuredOutput);
    const repository = await realpath(
      fileURLToPath(new URL('../', import.meta.url)),
    );
    const outsideRepository = (target: string) => {
      const path = relative(repository, target);
      return path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path);
    };
    if (!outsideRepository(output))
      throw new Error('Explicit independent live output required');
    await mkdir(output, { recursive: true });
    output = await realpath(output);
    if (!outsideRepository(output))
      throw new Error('Live output must resolve outside the repository');
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        IdentityAccessModule,
        AiAssistantModule,
        DatabaseModule,
      ],
      providers: [
        ProjectKnowledgeRagEventHandler,
        PrismaInboxExecutor,
        { provide: INBOX_LEASE, useExisting: PrismaInboxExecutor },
      ],
    }).compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.listen(0, '127.0.0.1');
    http = app.getHttpServer();
    prisma = app.get(PrismaService);
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.ragDocument.count()).toBe(0);
    embed = app.get(EMBEDDING_PROVIDER);
    chat = app.get(CHAT_MODEL_PROVIDER);
    expect(embed).toBeInstanceOf(OpenAiCompatibleEmbeddingProvider);
    expect(chat).toBeInstanceOf(OpenAiCompatibleChatModelProvider);
    const actualEmbed = embed.embed.bind(embed),
      actualChat = chat.stream.bind(chat);
    // Transparent call counters still execute the original providers.
    vi.spyOn(embed, 'embed').mockImplementation((...args) => {
      embeddingCalls++;
      return actualEmbed(...args);
    });
    vi.spyOn(chat, 'stream').mockImplementation((...args) => {
      chatCalls++;
      return actualChat(...args);
    });
    roleId = (
      await prisma.role.findUniqueOrThrow({
        where: { SystemRoleCode: 'registered_user' },
      })
    ).RoleId;
    passwordHash = await new BcryptPasswordHasher().hash(password);
    actor = await account();
    other = await account();
    // Article's fixed relation key is part of its publication policy.
    const existing = await prisma.dictionaryType.findUnique({
      where: { DictType: 'knowledge.article_category' },
    });
    if (!existing) {
      await prisma.dictionaryType.create({
        data: {
          DictType: 'knowledge.article_category',
          DictName: '文章分类',
          GroupKey: 'knowledge',
          Status: 'active',
          PubliclyReadable: true,
        },
      });
      categoryTypeCreated = true;
    }
    const category = await prisma.dictionaryItem.create({
      data: {
        DictType: 'knowledge.article_category',
        Value: key,
        Label: '合成知识',
        Status: 'active',
      },
    });
    categoryId = category.ItemId;
    const indexing = app.get(RagDocumentIndexingService);
    for (const fixture of liveResorts) {
      const row = await prisma.skiResort.create({
        data: {
          Name: fixture.name,
          LegacyDistance: 0,
          Price: fixture.price,
          OpeningHours: fixture.hours,
          TrailSummary: fixture.trails,
          FacilitySummary: fixture.facilities,
          Description: fixture.description,
          SnowCondition: '合成雪况',
          Status: 'published',
        },
        include: { FitTags: { include: { Item: true } } },
      });
      resortIds.push(row.ResortId);
      const sourceKey = `resort:${row.ResortId}`;
      sources.set(fixture.key, sourceKey);
      await indexing.index({
        sourceKey,
        sourceType: 'resort',
        sourceId: row.ResortId,
        title: row.Name,
        content: [
          row.Name,
          `票价${row.Price}元`,
          row.OpeningHours,
          row.TrailSummary,
          row.FacilitySummary,
          row.Description,
        ].join('\n'),
        accessScope: 'public',
        merchantId: null,
        sourceUpdatedAt: row.UpdateTime,
        sourceState: resortSourceState(row),
      });
    }
    for (const fixture of liveArticles) {
      const row = await prisma.article.create({
        data: {
          Title: fixture.title,
          Summary: fixture.body.slice(0, 80),
          Body: fixture.body,
          CategoryValue: key,
          Status: 'published',
          PublishTime: new Date(),
        },
      });
      articleIds.push(row.ArticleId);
      const sourceKey = `article:${row.ArticleId}`;
      sources.set(fixture.key, sourceKey);
      await indexing.index({
        sourceKey,
        sourceType: 'article',
        sourceId: row.ArticleId,
        title: row.Title,
        content: row.Title + '\n' + row.Body,
        accessScope: 'public',
        merchantId: null,
        sourceUpdatedAt: row.UpdateTime,
        sourceState: articleSourceState(row, []),
      });
    }
    for (const fixture of liveProjectDocuments) {
      const row = await prisma.projectKnowledge.create({
        data: {
          Title: fixture.title,
          Content: fixture.content,
          Category: 'guide',
          Status: 'published',
          PublishTime: new Date(),
        },
      });
      projectIds.push(row.ProjectKnowledgeId);
      const sourceKey = `project:${row.ProjectKnowledgeId}`;
      sources.set(fixture.key, sourceKey);
      await indexing.index({
        sourceKey,
        sourceType: 'project_doc',
        sourceId: row.ProjectKnowledgeId,
        title: row.Title,
        content: row.Title + '\n' + row.Content,
        accessScope: 'public',
        merchantId: null,
        sourceUpdatedAt: row.UpdateTime,
        sourceState: projectSourceState(row),
      });
    }
    // Deliberately stored poisoned indexes exercise current-source SQL filtering.
    for (const kind of ['draft', 'private', 'stale', 'disabled'] as const) {
      const row = await prisma.projectKnowledge.create({
        data: {
          Title: `合成不可见${kind}`,
          Content: `保密校验标记 SECRET_${kind}。松林雪场日票为9999元。`,
          Category: 'guide',
          Status: kind === 'draft' ? 'draft' : 'published',
          PublishTime: kind === 'draft' ? null : new Date(),
        },
      });
      projectIds.push(row.ProjectKnowledgeId);
      const sourceKey = `project:${row.ProjectKnowledgeId}`;
      forbiddenSources.push(sourceKey);
      await indexing.index({
        sourceKey,
        sourceType: 'project_doc',
        sourceId: row.ProjectKnowledgeId,
        title: row.Title,
        content: row.Content,
        accessScope: kind === 'private' ? 'admin' : 'public',
        merchantId: null,
        sourceUpdatedAt: row.UpdateTime,
        sourceState: projectSourceState(row),
      });
      if (kind === 'stale')
        await prisma.projectKnowledge.update({
          where: { ProjectKnowledgeId: row.ProjectKnowledgeId },
          data: { Content: '已改变的合成内容' },
        });
      if (kind === 'disabled')
        await prisma.ragDocument.update({
          where: { SourceKey: sourceKey },
          data: { ManualDisabled: true },
        });
    }
  });

  afterAll(async () => {
    try {
      if (prisma) {
        await prisma.aiConversation.deleteMany({
          where: { UserId: { in: userIds } },
        });
        await prisma.user.deleteMany({ where: { UserId: { in: userIds } } });
        await prisma.ragDocument.deleteMany({
          where: {
            SourceKey: { in: [...sources.values(), ...forbiddenSources] },
          },
        });
        await prisma.consumedEvent.deleteMany({
          where: { EventId: { in: eventIds } },
        });
        await prisma.article.deleteMany({
          where: { ArticleId: { in: articleIds } },
        });
        await prisma.projectKnowledge.deleteMany({
          where: { ProjectKnowledgeId: { in: projectIds } },
        });
        await prisma.skiResort.deleteMany({
          where: { ResortId: { in: resortIds } },
        });
        if (categoryId)
          await prisma.dictionaryItem.delete({ where: { ItemId: categoryId } });
        if (categoryTypeCreated)
          await prisma.dictionaryType.delete({
            where: { DictType: 'knowledge.article_category' },
          });
      }
      if (output)
        await writeFile(
          join(output, 'live-rag-results.json'),
          JSON.stringify(
            {
              scope: 'synthetic-live-providers-http-rag',
              embeddingModel: process.env.EMBEDDING_MODEL,
              chatModel: process.env.CHAT_MODEL_NAME,
              embeddingCalls,
              chatCalls,
              results,
            },
            null,
            2,
          ),
        );
    } finally {
      await app?.close();
      vi.restoreAllMocks();
    }
  });

  it.each(liveRetrievalQuestions)(
    '$id retrieves the labelled synthetic sources',
    async (fixture) => {
      const previousQuestions =
        'previousQuestions' in fixture ? fixture.previousQuestions : [];
      const query = contextualRetrievalQuery(
        fixture.question,
        previousQuestions,
      );
      const [embedding] = await embed.embed([query]);
      expect(embedding).toHaveLength(1024);
      const candidates = await app.get(RagRetrievalService).search(
        {
          embedding: embedding!,
          embeddingModel: process.env.EMBEDDING_MODEL!,
          limit: 5,
        },
        {
          userId: actor.id,
          active: true,
          merchantId: null,
          roles: [
            {
              active: true,
              dataScope: 'self',
              permissionKeys: [RAG_QUERY_PERMISSION],
            },
          ],
        },
      );
      const actual = candidates.map((candidate) => candidate.sourceKey),
        expected = fixture.expected.map((key) => sources.get(key)!);
      const passed = expected.every((key) => actual.includes(key));
      results.push({
        id: fixture.id,
        question: fixture.question,
        previousQuestions,
        expected,
        actual,
        scores: candidates.map((candidate) => candidate.similarity),
        passed,
      });
      expect(actual.some((key) => forbiddenSources.includes(key))).toBe(false);
      expect(actual).toEqual(expect.arrayContaining(expected));
    },
  );

  it('rejects anonymous conversation access without calling a provider', async () => {
    const before = [embeddingCalls, chatCalls];
    await request(http).post(base).send({}).expect(401);
    expect([embeddingCalls, chatCalls]).toEqual(before);
  });
  it('streams a real cited answer and persists the completed message', async () => {
    conversationId = (
      await request(http)
        .post(base)
        .auth(actor.token, { type: 'bearer' })
        .send({})
        .expect(201)
    ).body.data.conversationId as string;
    firstRequestId = randomUUID();
    const content =
      '合成松林雪场的日票价格是多少元？请简短回答，并标注资料引用。';
    const response = await send(content, firstRequestId);
    const events = parseEvents(response.text);
    expect(events.some((event) => event.event === 'error')).toBe(false);
    firstMessage = events.find((event) => event.event === 'completed')!.data;
    expect(firstMessage).toMatchObject({
      role: 'assistant',
      status: 'complete',
    });
    expect(String(firstMessage.content)).toContain('180');
    expect(String(firstMessage.content)).toMatch(/\[S\d+\]/);
    const citations = firstMessage.citations as Array<{
      sourceType: string;
      sourceId: string;
    }>;
    expect(
      citations.some(
        (c) => `${c.sourceType}:${c.sourceId}` === sources.get('pine'),
      ),
    ).toBe(true);
    expect(JSON.stringify(firstMessage)).not.toMatch(/SECRET_|9999/);
    const detail = (
      await request(http)
        .get(`${base}/${conversationId}`)
        .auth(actor.token, { type: 'bearer' })
        .expect(200)
    ).body.data;
    expect(detail.messages).toHaveLength(2);
    expect(detail.messages[1]).toEqual(firstMessage);
    results.push({
      id: 'HTTP01',
      question: content,
      answer: firstMessage.content,
      citations,
      passed: true,
    });
  });
  it('replays a completed idempotency key with no repeated model or embedding request', async () => {
    const before = [embeddingCalls, chatCalls];
    const response = await send(
      '合成松林雪场的日票价格是多少元？请简短回答，并标注资料引用。',
      firstRequestId,
    );
    expect(parseEvents(response.text)).toEqual([
      { event: 'completed', data: firstMessage },
    ]);
    expect([embeddingCalls, chatCalls]).toEqual(before);
  });
  it('answers a follow-up through persisted question context using real providers', async () => {
    const question = '这个雪场几点结束营业？请简短回答并引用资料。';
    const response = await send(question, randomUUID());
    const completed = parseEvents(response.text).find(
      (event) => event.event === 'completed',
    );
    expect(completed).toBeDefined();
    expect(String(completed!.data.content)).toMatch(
      /17[:：]00|下午五|下午5|17点/,
    );
    expect(String(completed!.data.content)).toMatch(/\[S\d+\]/);
    results.push({
      id: 'HTTP02',
      question,
      answer: completed!.data.content,
      citations: completed!.data.citations,
      passed: true,
    });
  });
  it('isolates another account from the persisted conversation', async () => {
    const before = [embeddingCalls, chatCalls];
    await request(http)
      .get(`${base}/${conversationId}`)
      .auth(other.token, { type: 'bearer' })
      .expect(404);
    await request(http)
      .post(`${base}/${conversationId}/messages`)
      .auth(other.token, { type: 'bearer' })
      .send({ clientRequestId: randomUUID(), content: '读取另一账号对话' })
      .expect(404);
    expect([embeddingCalls, chatCalls]).toEqual(before);
  });
  it('withdraws a real indexed source before asynchronous reindex and excludes it immediately', async () => {
    const sourceKey = sources.get('pine')!,
      id = Number(sourceKey.split(':')[1]);
    await prisma.skiResort.update({
      where: { ResortId: id },
      data: { Status: 'offline' },
    });
    const [embedding] = await embed.embed(['松林雪场票价']);
    const matches = await app.get(RagRetrievalService).search(
      {
        embedding: embedding!,
        embeddingModel: process.env.EMBEDDING_MODEL!,
        limit: 20,
      },
      null,
    );
    expect(matches.map((item) => item.sourceKey)).not.toContain(sourceKey);
  });
  it('reindexes changed public knowledge with real embeddings and deduplicates its Inbox event', async () => {
    const sourceKey = sources.get('ai')!,
      id = Number(sourceKey.split(':')[1]);
    const before = await prisma.ragDocument.findUniqueOrThrow({
      where: { SourceKey: sourceKey },
      include: { Chunks: true },
    });
    await prisma.projectKnowledge.update({
      where: { ProjectKnowledgeId: id },
      data: {
        Content:
          '合成平台AI仅向登录用户开放。回答必须附带当前公开来源，撤回内容不能作为证据。此项规则已更新，人工咨询时间为每天09:00至18:00。',
      },
    });
    const eventId = randomUUID();
    eventIds.push(eventId);
    const event = {
      eventId,
      eventType: 'project_doc.changed.v1',
      aggregateType: 'project_doc',
      aggregateId: String(id),
      occurredAt: new Date(),
      payload: { projectKnowledgeId: id },
    };
    const handler = app.get(ProjectKnowledgeRagEventHandler);
    expect(await handler.handle(event)).toBe(true);
    const indexed = await prisma.ragDocument.findUniqueOrThrow({
      where: { SourceKey: sourceKey },
      include: { Chunks: true },
    });
    expect(indexed.Status).toBe('indexed');
    expect(indexed.ContentHash).not.toBe(before.ContentHash);
    expect(
      indexed.Chunks.map((chunk) => chunk.ChunkContent).join('\n'),
    ).toContain('09:00至18:00');
    const calls = embeddingCalls;
    expect(await handler.handle(event)).toBe(false);
    expect(embeddingCalls).toBe(calls);
    expect(
      await prisma.consumedEvent.count({
        where: { EventId: eventId, Status: 'completed' },
      }),
    ).toBe(1);
  });
  it('uses the deterministic no-evidence response without charging the chat model', async () => {
    await prisma.ragDocument.updateMany({
      where: { SourceKey: { in: [...sources.values(), ...forbiddenSources] } },
      data: { ManualDisabled: true },
    });
    const before = chatCalls;
    const response = await send('合成松林雪场的票价是多少？', randomUUID());
    const completed = parseEvents(response.text).find(
      (event) => event.event === 'completed',
    );
    expect(completed?.data.content).toBe(
      '目前没有检索到可用于回答的资料，请调整问题后重试。',
    );
    expect(completed?.data.citations).toEqual([]);
    expect(chatCalls).toBe(before);
  });

  async function account() {
    const row = await prisma.user.create({
      data: {
        Account: `${key}-${userIds.length}`,
        Nickname: '合成验收用户',
        PasswordHash: passwordHash,
        UserRoles: { create: { RoleId: roleId } },
      },
    });
    userIds.push(row.UserId);
    const result = await request(http)
      .post('/api/v1/auth/login')
      .send({ account: row.Account, password })
      .expect(200);
    return { id: row.UserId, token: result.body.data.accessToken as string };
  }
  function send(content: string, clientRequestId: string) {
    return request(http)
      .post(`${base}/${conversationId}/messages`)
      .auth(actor.token, { type: 'bearer' })
      .send({ content, clientRequestId })
      .timeout({ response: 150000, deadline: 180000 })
      .expect(200);
  }
});

function parseEvents(
  body: string,
): Array<{ event: string; data: Record<string, unknown> }> {
  return body
    .trim()
    .split(/\r?\n\r?\n/)
    .filter(Boolean)
    .map((block) => {
      const lines = block.split(/\r?\n/);
      return {
        event: lines.find((line) => line.startsWith('event: '))!.slice(7),
        data: JSON.parse(
          lines
            .filter((line) => line.startsWith('data: '))
            .map((line) => line.slice(6))
            .join('\n'),
        ) as Record<string, unknown>,
      };
    });
}
