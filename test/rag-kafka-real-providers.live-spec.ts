import { ConfigModule } from '@nestjs/config';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { Kafka, logLevel, type Admin } from 'kafkajs';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { OutboxEvent } from '@prisma/client';
import { DatabaseModule } from '../src/shared/persistence/database.module.js';
import { PrismaService } from '../src/shared/persistence/prisma.service.js';
import { configureHttp } from '../src/shared/http/configure-http.js';
import { ApiExceptionFilter } from '../src/shared/http/api-exception.filter.js';
import { KnowledgeContentModule } from '../src/modules/knowledge-content/knowledge-content.module.js';
import { ResortManagementModule } from '../src/modules/resort-management/resort-management.module.js';
import { CommunityModule } from '../src/modules/community/community.module.js';
import { IdentityAccessModule } from '../src/modules/identity-access/identity-access.module.js';
import { BcryptPasswordHasher } from '../src/modules/identity-access/infrastructure/bcrypt-password-hasher.js';
import { RagRetrievalService } from '../src/modules/ai-assistant/application/rag-retrieval.service.js';
import { EMBEDDING_PROVIDER } from '../src/modules/ai-assistant/application/ports/embedding-provider.js';
import { CHAT_MODEL_PROVIDER } from '../src/modules/ai-assistant/application/ports/chat-model-provider.js';
import { OpenAiCompatibleEmbeddingProvider } from '../src/modules/ai-assistant/infrastructure/openai-compatible-embedding.provider.js';
import { OpenAiCompatibleChatModelProvider } from '../src/modules/ai-assistant/infrastructure/openai-compatible-chat-model.provider.js';
import { KafkaEventPublisher } from '../src/modules/integration-events/infrastructure/kafka-event.publisher.js';
import type { IntegrationEvent } from '../src/modules/integration-events/domain/integration-event.js';
import {
  integrationKafkaClientConfig,
  integrationKafkaSettings,
} from './helpers/kafka-integration-transport.js';
import { waitForTopicLeaders } from './helpers/kafka-topic-readiness.js';
import { observeCommittedOffset } from './helpers/kafka-offset-observer.js';
import { nativeKafkaRecovery } from './helpers/native-kafka-recovery.js';

// Paid-provider opt-in. Production modules, workers and providers run unchanged.
describe('real management HTTP / Outbox / secure Kafka / BGE-M3 / pgvector / DeepSeek', () => {
  let app: INestApplication<App>,
    http: App,
    prisma: PrismaService,
    admin: Admin;
  let embed: OpenAiCompatibleEmbeddingProvider,
    chat: OpenAiCompatibleChatModelProvider;
  let recovery: Awaited<ReturnType<typeof nativeKafkaRecovery>>;
  let output: string, adminToken: string, userToken: string;
  let projectId: number,
    userId: number,
    adminId: number,
    conversationId: string;
  const adminSessionIds: string[] = [],
    loginBucketKeys: string[] = [];
  let initialHash: string, publishEvent: OutboxEvent;
  let articleId: number, resortId: number, categoryId: number;
  let dynamicId: number, dictionaryParentId: number, dictionaryLeafId: number;
  let dictionaryCreated = false;
  const publicDictionary = `pipeline.safety.${randomUUID().slice(0, 8)}`;
  const dynamicContent = (updated = false) =>
    `合成银桦夜滑签到点${updated ? '18:40' : '18:20'}开始签到，参与者在紫色帐篷集合。资料仅供验收。`;
  let categoryTypeCreated = false;
  const categoryType = 'knowledge.article_category';
  const articleBody = (updated = false) => ({
    title: '合成青杉初学滑雪护具说明',
    summary: '合成资料：初学滑雪护具准备。',
    body: updated
      ? '合成青杉初学课程要求佩戴滑雪头盔和护目镜，并在前台领取蓝色护具卡。资料仅供验收。'
      : '合成青杉初学课程要求佩戴滑雪头盔和护目镜，并在前台领取绿色护具卡。资料仅供验收。',
    categoryValue: `pipeline-${key}`,
  });
  const resortBody = {
    name: '合成青杉练习雪场',
    price: 180,
    openStatus: 'open',
    snowCondition: '合成压雪雪面',
    openingHours: '09:00–16:30',
    description: '合成青杉练习雪场只提供初学缓坡和头盔租赁。资料仅供验收。',
  };
  let embeddingCalls = 0,
    chatCalls = 0;
  const events = new Set<string>();
  const results: Record<string, unknown>[] = [];
  const failures: Record<string, unknown>[] = [];
  const key = randomUUID().slice(0, 8),
    topic = `linji-real-rag-${key}`,
    group = topic;
  const title = '合成北坡咨询服务站开放规则';
  const content = (hour: number) =>
    `合成北坡咨询服务站每天09:00至${hour}:00开放，只提供滑雪咨询，访客在前台窗口获得指导。这是专用验收的虚构资料。`;
  const endpoint = '/api/v1/admin/project-knowledge';

  beforeAll(async () => {
    if (
      process.env.LINJI_REAL_KAFKA_RAG_CONFIRM !==
      'linji_real_kafka_rag_validation'
    )
      throw new Error(
        'Explicit real Kafka/model disposable database confirmation required',
      );
    const database = new URL(process.env.DATABASE_URL ?? '');
    if (
      !['localhost', '127.0.0.1'].includes(database.hostname) ||
      database.pathname !== '/linji_real_kafka_rag_validation'
    )
      throw new Error('Dedicated loopback Kafka/live-model database required');
    if (process.env.KAFKA_INTEGRATION_SECURITY_ENABLED !== 'true')
      throw new Error('TLS/SCRAM integration settings required');
    for (const field of [
      'EMBEDDING_BASE_URL',
      'EMBEDDING_MODEL',
      'EMBEDDING_API_KEY',
      'CHAT_MODEL_BASE_URL',
      'CHAT_MODEL_API_KEY',
      'CHAT_MODEL_NAME',
      'INITIAL_ADMIN_ACCOUNT',
      'INITIAL_ADMIN_PASSWORD',
    ])
      if (!process.env[field])
        throw new Error('Real model/admin configuration incomplete');
    const configured = process.env.LINJI_REAL_KAFKA_RAG_RUN ?? '';
    if (!isAbsolute(configured))
      throw new Error('Absolute output outside the repository required');
    const repository = await realpath(
      fileURLToPath(new URL('../', import.meta.url)),
    );
    const outside = (target: string) => {
      const path = relative(repository, target);
      return path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path);
    };
    output = resolve(configured);
    if (!outside(output)) throw new Error('Independent output required');
    await mkdir(output, { recursive: true });
    output = await realpath(output);
    if (!outside(output))
      throw new Error('Output must resolve outside the repository');
    recovery = await nativeKafkaRecovery(); // Explicit owned process capability; no Docker fallback.
    admin = new Kafka({
      ...integrationKafkaClientConfig('admin'),
      clientId: topic + '-setup',
      logLevel: logLevel.NOTHING,
    }).admin();
    await admin.connect();
    await admin.createTopics({
      topics: [{ topic, numPartitions: 1, replicationFactor: 1 }],
      waitForLeaders: false,
    });
    await waitForTopicLeaders(admin, topic, 1);
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              ...integrationKafkaSettings(),
              KAFKA_EVENTS_TOPIC: topic,
              KAFKA_CONSUMER_GROUP: group,
              KAFKA_CONSUMER_ENABLED: 'true',
              OUTBOX_DISPATCH_ENABLED: 'true',
              OUTBOX_POLL_INTERVAL_MS: '100',
            }),
          ],
        }),
        DatabaseModule,
        IdentityAccessModule,
        KnowledgeContentModule,
        ResortManagementModule,
        CommunityModule,
      ],
    }).compile();
    app = module.createNestApplication();
    configureHttp(app);
    prisma = app.get(PrismaService);
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.outboxEvent.count()).toBe(0);
    expect(await prisma.ragDocument.count()).toBe(0);
    expect(await prisma.authSession.count()).toBe(0);
    expect(await prisma.loginAttemptBucket.count()).toBe(0);
    adminId = (
      await prisma.user.findUniqueOrThrow({
        where: { Account: process.env.INITIAL_ADMIN_ACCOUNT! },
      })
    ).UserId;
    embed = app.get(EMBEDDING_PROVIDER);
    chat = app.get(CHAT_MODEL_PROVIDER);
    expect(embed).toBeInstanceOf(OpenAiCompatibleEmbeddingProvider);
    expect(chat).toBeInstanceOf(OpenAiCompatibleChatModelProvider);
    // Observe only allowlisted error classifications; never log credentials,
    // provider response bodies, arbitrary messages, or database connection text.
    const filterPrototype = ApiExceptionFilter.prototype;
    const actualCatch = filterPrototype.catch.bind(filterPrototype);
    vi.spyOn(ApiExceptionFilter.prototype, 'catch').mockImplementation(
      function (this: ApiExceptionFilter, exception, host) {
        const error = exception instanceof Error ? exception : null;
        const cause = error?.cause as { code?: unknown } | undefined;
        const status = error?.message.match(
          /^Model provider returned HTTP (\d{3})$/u,
        )?.[1];
        failures.push({
          test: expect.getState().currentTestName,
          errorType:
            error && /^[A-Za-z][A-Za-z0-9]{0,79}$/u.test(error.name)
              ? error.name
              : 'unclassified',
          providerStatus: status ? Number(status) : null,
          causeCode:
            typeof cause?.code === 'string' &&
            /^[A-Z_]{1,60}$/u.test(cause.code)
              ? cause.code
              : null,
        });
        return actualCatch(exception, host);
      },
    );
    const actualEmbed = embed.embed.bind(embed),
      actualChat = chat.stream.bind(chat);
    vi.spyOn(embed, 'embed').mockImplementation((...args) => {
      embeddingCalls++;
      return actualEmbed(...args);
    });
    vi.spyOn(chat, 'stream').mockImplementation((...args) => {
      chatCalls++;
      return actualChat(...args);
    });
    // Vitest normally suppresses production workers. Enable the unchanged bootstrap hooks.
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'live-rag';
    try {
      await app.listen(0, '127.0.0.1');
    } finally {
      process.env.NODE_ENV = previous;
    }
    http = app.getHttpServer();
    adminToken = await login(
      process.env.INITIAL_ADMIN_ACCOUNT!,
      process.env.INITIAL_ADMIN_PASSWORD!,
    );
    const role = await prisma.role.findUniqueOrThrow({
      where: { SystemRoleCode: 'registered_user' },
    });
    const password = 'test-only-' + randomUUID();
    const user = await prisma.user.create({
      data: {
        Account: 'pipeline-' + key,
        Nickname: '合成链路用户',
        PasswordHash: await new BcryptPasswordHasher().hash(password),
        UserRoles: { create: { RoleId: role.RoleId } },
      },
    });
    userId = user.UserId;
    userToken = await login(user.Account, password);
    adminSessionIds.push(
      ...(
        await prisma.authSession.findMany({
          where: { UserId: adminId },
          select: { SessionId: true },
        })
      ).map((row) => row.SessionId),
    );
    loginBucketKeys.push(
      ...(
        await prisma.loginAttemptBucket.findMany({
          select: { BucketKey: true },
        })
      ).map((row) => row.BucketKey),
    );
  });

  afterAll(async () => {
    await app?.close(); // Drain real worker, consumer and producer before deleting fixtures.
    const cleanup = new PrismaService();
    try {
      await cleanup.$connect();
      await cleanup.authSession.deleteMany({
        where: { UserId: adminId, SessionId: { in: adminSessionIds } },
      });
      await cleanup.loginAttemptBucket.deleteMany({
        where: { BucketKey: { in: loginBucketKeys } },
      });
      // A dynamic retains its author FK even after soft deletion.
      if (dynamicId)
        await cleanup.dynamic.deleteMany({ where: { DynamicId: dynamicId } });
      if (userId) {
        await cleanup.aiConversation.deleteMany({ where: { UserId: userId } });
        await cleanup.user.deleteMany({ where: { UserId: userId } });
      }
      // All additional fixtures belong to this otherwise empty disposable database.
      // Capture events even if an HTTP command succeeded before its assertion failed.
      const extraEvents = await cleanup.outboxEvent.findMany({
        where: {
          OR: [
            { AggregateType: 'Dynamic', AggregateId: String(dynamicId ?? -1) },
            {
              AggregateType: 'DictionaryItem',
              AggregateId: { startsWith: `${publicDictionary}:` },
            },
            { AggregateType: 'article', AggregateId: String(articleId ?? -1) },
            {
              AggregateType: 'ski_resort',
              AggregateId: String(resortId ?? -1),
            },
            {
              AggregateType: 'DictionaryItem',
              AggregateId: `${categoryType}:${categoryId ?? -1}`,
            },
          ],
        },
      });
      const extraIds = extraEvents.map((row) => row.EventId);
      await cleanup.consumedEvent.deleteMany({
        where: { EventId: { in: extraIds } },
      });
      await cleanup.outboxEvent.deleteMany({
        where: { EventId: { in: extraIds } },
      });
      await cleanup.operationLog.deleteMany({
        where: {
          ActorUserId: adminId,
          OR: [
            {
              ResourceKey: 'community',
              TargetType: 'Dynamic',
              TargetId: String(dynamicId ?? -1),
            },
            {
              ResourceKey: 'system:dict',
              TargetId: {
                in: [
                  publicDictionary,
                  String(dictionaryParentId ?? -1),
                  String(dictionaryLeafId ?? -1),
                ],
              },
            },
            { ResourceKey: 'article', TargetId: String(articleId ?? -1) },
            { ResourceKey: 'resort', TargetId: String(resortId ?? -1) },
            { ResourceKey: 'system:dict', TargetId: String(categoryId ?? -1) },
          ],
        },
      });
      await cleanup.ragDocument.deleteMany({
        where: {
          SourceKey: {
            in: [
              `article:${articleId ?? -1}`,
              `resort:${resortId ?? -1}`,
              `dictionary:${categoryType}:pipeline-${key}`,
              `dynamic:${dynamicId ?? -1}`,
              `dictionary:${publicDictionary}:meeting-point`,
              `dictionary:${publicDictionary}:headlamp`,
            ],
          },
        },
      });
      if (articleId)
        await cleanup.article.deleteMany({ where: { ArticleId: articleId } });
      if (resortId)
        await cleanup.skiResort.deleteMany({ where: { ResortId: resortId } });
      if (categoryId)
        await cleanup.dictionaryItem.deleteMany({
          where: { ItemId: categoryId },
        });
      if (categoryTypeCreated)
        await cleanup.dictionaryType.delete({
          where: { DictType: categoryType },
        });
      if (dictionaryCreated) {
        await cleanup.dictionaryItem.deleteMany({
          where: { DictType: publicDictionary },
        });
        await cleanup.dictionaryType.delete({
          where: { DictType: publicDictionary },
        });
      }
      if (projectId) {
        const rows = await cleanup.outboxEvent.findMany({
          where: {
            AggregateType: 'project_doc',
            AggregateId: String(projectId),
          },
        });
        for (const row of rows) events.add(row.EventId);
        await cleanup.consumedEvent.deleteMany({
          where: { EventId: { in: [...events] } },
        });
        await cleanup.outboxEvent.deleteMany({
          where: { EventId: { in: [...events] } },
        });
        await cleanup.operationLog.deleteMany({
          where: {
            ResourceKey: 'content:project-knowledge',
            TargetId: String(projectId),
          },
        });
        await cleanup.ragDocument.deleteMany({
          where: { SourceKey: `project:${projectId}` },
        });
        await cleanup.projectKnowledge.deleteMany({
          where: { ProjectKnowledgeId: projectId },
        });
      }
    } finally {
      await cleanup.$disconnect();
      if (admin) {
        try {
          if ((await admin.listTopics()).includes(topic))
            await admin.deleteTopics({ topics: [topic] });
          if (
            (await admin.listGroups()).groups.some(
              (row) => row.groupId === group,
            )
          )
            await admin.deleteGroups([group]);
        } finally {
          await admin.disconnect();
        }
      }
      if (output)
        await writeFile(
          join(output, 'live-kafka-rag-results.json'),
          JSON.stringify(
            {
              scope: 'synthetic-management-http-secure-kafka-real-models',
              embeddingModel: process.env.EMBEDDING_MODEL,
              chatModel: process.env.CHAT_MODEL_NAME,
              topic,
              group,
              embeddingCalls,
              chatCalls,
              failures,
              results,
            },
            null,
            2,
          ),
        );
      vi.restoreAllMocks();
    }
  });

  it('refuses ordinary-user management writes without an event or audit', async () => {
    await request(http)
      .post(endpoint)
      .auth(userToken, { type: 'bearer' })
      .send({ title, content: content(18), category: '合成规则' })
      .expect(403);
    expect(await prisma.outboxEvent.count()).toBe(0);
    expect(
      await prisma.operationLog.count({
        where: { ResourceKey: 'content:project-knowledge' },
      }),
    ).toBe(0);
    results.push({ id: 'K01', denied: true });
  });
  it('creates a draft over HTTP and delivers its real Outbox event without embedding private content', async () => {
    const response = await command('post', endpoint, {
      title,
      content: content(18),
      category: '合成规则',
    });
    projectId = response.body.data.projectKnowledgeId as number;
    const event = await changedEvent();
    await delivered(event);
    const doc = await prisma.ragDocument.findUnique({
      where: { SourceKey: `project:${projectId}` },
    });
    expect(doc === null || doc.Status === 'disabled').toBe(true);
    expect(embeddingCalls).toBe(0);
    expect(
      await prisma.operationLog.count({
        where: {
          TargetId: String(projectId),
          ActionKey: 'content:project-knowledge:create',
        },
      }),
    ).toBe(1);
    results.push({ id: 'K02', eventId: event.EventId, draftExcluded: true });
  });
  it('publishes through production workers and stores a real 1024-dimension vector', async () => {
    await command('patch', `${endpoint}/${projectId}/publish`, {});
    publishEvent = await changedEvent();
    await delivered(publishEvent);
    const doc = await indexed(18);
    initialHash = doc.ContentHash;
    const vectors = await prisma.$queryRaw<
      { dimensions: number; norm: number }[]
    >`SELECT vector_dims(c."Embedding") AS dimensions, vector_norm(c."Embedding") AS norm FROM "RagChunk" c JOIN "RagDocument" d USING ("RagDocumentId") WHERE d."SourceKey" = ${`project:${projectId}`}`;
    expect(vectors.length).toBeGreaterThan(0);
    for (const vector of vectors) {
      expect(vector.dimensions).toBe(1024);
      expect(vector.norm).toBeGreaterThan(0.99);
      expect(vector.norm).toBeLessThan(1.01);
    }
    expect(embeddingCalls).toBe(1);
    results.push({
      id: 'K03',
      eventId: publishEvent.EventId,
      dimensions: 1024,
      norm: vectors[0]!.norm,
    });
  });
  it('answers using only the knowledge indexed via secure Kafka and persists its citation', async () => {
    conversationId = (
      await request(http)
        .post('/api/v1/ai/conversations')
        .auth(userToken, { type: 'bearer' })
        .send({})
        .expect(201)
    ).body.data.conversationId as string;
    const message = await answer();
    expect(String(message.content)).toMatch(/18[:：]00|18点|下午六|下午6/);
    expect(String(message.content)).toMatch(/\[S\d+\]/);
    expect(message.citations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceType: 'project',
          sourceId: String(projectId),
        }),
      ]),
    );
    const detail = (
      await request(http)
        .get(`/api/v1/ai/conversations/${conversationId}`)
        .auth(userToken, { type: 'bearer' })
        .expect(200)
    ).body.data;
    expect(detail.messages[1]).toEqual(message);
    results.push({
      id: 'K04',
      answer: message.content,
      citations: message.citations,
    });
  });
  it('consumes a duplicate event from Kafka without a second real embedding request', async () => {
    await eventually(async () => {
      const offset = await observeCommittedOffset(admin, group, topic);
      return offset !== null && BigInt(offset) >= 2n;
    }, 'initial event commits');
    const before = await observeCommittedOffset(admin, group, topic);
    expect(before).not.toBeNull();
    const calls = embeddingCalls;
    await app.get(KafkaEventPublisher).publish({
      eventId: publishEvent.EventId,
      eventType: publishEvent.EventType,
      aggregateType: publishEvent.AggregateType,
      aggregateId: publishEvent.AggregateId,
      occurredAt: publishEvent.OccurredAt,
      payload: publishEvent.Payload as IntegrationEvent['payload'],
    });
    await eventually(async () => {
      const current = await observeCommittedOffset(admin, group, topic);
      return current !== null && BigInt(current) > BigInt(before!);
    }, 'duplicate commit');
    expect(embeddingCalls).toBe(calls);
    expect(
      await prisma.consumedEvent.count({
        where: { EventId: publishEvent.EventId, Status: 'completed' },
      }),
    ).toBe(1);
    results.push({ id: 'K05', duplicateSuppressed: true });
  });
  it('retains an HTTP update during an owned broker interruption, rejects the stale vector and recovers real indexing', async () => {
    const previous = await prisma.projectKnowledge.findUniqueOrThrow({
      where: { ProjectKnowledgeId: projectId },
    });
    await recovery.stop();
    let event: OutboxEvent;
    try {
      await command('patch', `${endpoint}/${projectId}`, {
        title,
        content: content(19),
        category: '合成规则',
        version: previous.Version,
      });
      event = await changedEvent();
      expect(
        (
          await prisma.outboxEvent.findUniqueOrThrow({
            where: { EventId: event.EventId },
          })
        ).Status,
      ).not.toBe('published');
      const [embedding] = await embed.embed(['合成北坡咨询服务站几点结束服务']);
      const stale = await app.get(RagRetrievalService).search(
        {
          embedding: embedding!,
          embeddingModel: process.env.EMBEDDING_MODEL!,
          limit: 5,
        },
        null,
      );
      expect(stale).toEqual([]);
      expect(
        (
          await prisma.ragDocument.findUniqueOrThrow({
            where: { SourceKey: `project:${projectId}` },
          })
        ).ContentHash,
      ).toBe(initialHash);
    } finally {
      await recovery.start();
    }
    await delivered(event!);
    const doc = await indexed(19);
    expect(doc.ContentHash).not.toBe(initialHash);
    results.push({
      id: 'K06',
      eventId: event!.EventId,
      brokerRestarted: true,
      staleExcludedBeforeReindex: true,
      realVectorUpdated: true,
    });
  });
  it('answers from the recovered new vector rather than the earlier published facts', async () => {
    const message = await answer();
    expect(String(message.content)).toMatch(
      /19[:：]00|19点|晚上七|晚上7|下午七|下午7/,
    );
    expect(String(message.content)).toMatch(/\[S\d+\]/);
    results.push({
      id: 'K07',
      answer: message.content,
      citations: message.citations,
    });
  });
  it('withdraws through Kafka and returns deterministic no-evidence text without a chat call', async () => {
    const calls = [embeddingCalls, chatCalls];
    await command('patch', `${endpoint}/${projectId}/withdraw`, {});
    const event = await changedEvent();
    await delivered(event);
    expect(
      (
        await prisma.ragDocument.findUniqueOrThrow({
          where: { SourceKey: `project:${projectId}` },
        })
      ).Status,
    ).toBe('disabled');
    expect(embeddingCalls).toBe(calls[0]);
    const message = await answer();
    expect(message.content).toBe(
      '目前没有检索到可用于回答的资料，请调整问题后重试。',
    );
    expect(message.citations).toEqual([]);
    expect(chatCalls).toBe(calls[1]);
    results.push({
      id: 'K08',
      eventId: event.EventId,
      withdrawnExcluded: true,
      noChatCharge: true,
    });
  });
  it('soft-deletes knowledge and completes its final event and transaction audit', async () => {
    await request(http)
      .delete(`${endpoint}/${projectId}`)
      .auth(adminToken, { type: 'bearer' })
      .expect(204);
    const event = await changedEvent();
    await delivered(event);
    expect(
      (
        await prisma.projectKnowledge.findUniqueOrThrow({
          where: { ProjectKnowledgeId: projectId },
        })
      ).DeletedAt,
    ).not.toBeNull();
    expect(
      await prisma.operationLog.count({
        where: {
          ResourceKey: 'content:project-knowledge',
          TargetId: String(projectId),
        },
      }),
    ).toBe(5);
    expect(chatCalls).toBe(2);
    results.push({ id: 'K09', eventId: event.EventId, auditedCommands: 5 });
  });

  it('denies ordinary-user resort and article management without writing an event or audit', async () => {
    const before = [
      await prisma.outboxEvent.count(),
      await prisma.operationLog.count(),
    ];
    for (const [path, body] of [
      ['/api/v1/admin/articles', articleBody()],
      ['/api/v1/admin/resorts', resortBody],
    ] as const) {
      await request(http)
        .post(path)
        .auth(userToken, { type: 'bearer' })
        .send(body)
        .expect(403);
    }
    expect([
      await prisma.outboxEvent.count(),
      await prisma.operationLog.count(),
    ]).toEqual(before);
    results.push({
      id: 'K10',
      deniedResources: ['article', 'resort'],
      noWrite: true,
    });
  });
  it('creates resort and article drafts through HTTP without embedding their private contents', async () => {
    // Reference-data bootstrap only. Business source rows are always created over HTTP.
    if (
      !(await prisma.dictionaryType.findUnique({
        where: { DictType: categoryType },
      }))
    ) {
      await prisma.dictionaryType.create({
        data: {
          DictType: categoryType,
          DictName: '合成文章分类',
          GroupKey: 'knowledge',
          Status: 'active',
          PubliclyReadable: true,
        },
      });
      categoryTypeCreated = true;
    }
    categoryId = (
      await prisma.dictionaryItem.create({
        data: {
          DictType: categoryType,
          Value: `pipeline-${key}`,
          Label: '合成初学知识',
          Status: 'active',
        },
      })
    ).ItemId;
    const calls = embeddingCalls;
    articleId = (await command('post', '/api/v1/admin/articles', articleBody()))
      .body.data.articleId as number;
    await delivered(await changedEvent('article', articleId));
    resortId = (await command('post', '/api/v1/admin/resorts', resortBody)).body
      .data.resortId as number;
    await delivered(await changedEvent('ski_resort', resortId));
    expect(embeddingCalls).toBe(calls);
    for (const sourceKey of [`article:${articleId}`, `resort:${resortId}`]) {
      const row = await prisma.ragDocument.findUnique({
        where: { SourceKey: sourceKey },
      });
      expect(row === null || row.Status === 'disabled').toBe(true);
    }
    results.push({
      id: 'K11',
      draftSourceKeys: [`article:${articleId}`, `resort:${resortId}`],
      noEmbedding: true,
    });
  });
  it('publishes resort and article sources through automatic secure Kafka workers and real BGE-M3', async () => {
    await command('patch', `/api/v1/admin/articles/${articleId}/publish`, {});
    await delivered(await changedEvent('article', articleId));
    await command('patch', `/api/v1/admin/resorts/${resortId}/publish`, {});
    await delivered(await changedEvent('ski_resort', resortId));
    await sourceIndexed(`article:${articleId}`, '绿色护具卡');
    await sourceIndexed(`resort:${resortId}`, '16:30');
    const vectors = await prisma.$queryRaw<
      { dimensions: number; norm: number }[]
    >`
      SELECT vector_dims(c."Embedding") AS dimensions, vector_norm(c."Embedding") AS norm
      FROM "RagChunk" c JOIN "RagDocument" d USING ("RagDocumentId")
      WHERE d."SourceKey" IN (${`article:${articleId}`}, ${`resort:${resortId}`})`;
    expect(vectors.length).toBeGreaterThanOrEqual(2);
    expect(
      vectors.every(
        (row) => row.dimensions === 1024 && row.norm > 0.99 && row.norm < 1.01,
      ),
    ).toBe(true);
    expect(
      (await searchSources()).some(
        (row) => row.sourceKey === `article:${articleId}`,
      ),
    ).toBe(true);
    expect(
      (await searchSources()).some(
        (row) => row.sourceKey === `resort:${resortId}`,
      ),
    ).toBe(true);
    results.push({
      id: 'K12',
      sourceTypes: ['article', 'resort'],
      realVectors: vectors,
    });
  });
  it('answers authenticated SSE questions from both new source types and persists their citations', async () => {
    const questions = [
      {
        type: 'article',
        id: articleId,
        content:
          '根据合成青杉初学滑雪护具说明，初学课程要求哪两种护具？请简短回答并引用资料。',
        expected: /头盔/u,
      },
      {
        type: 'resort',
        id: resortId,
        content: '合成青杉练习雪场的营业时间到几点？请简短回答并引用资料。',
        expected: /16[:：]30|四点半|4点半/u,
      },
    ];
    for (const question of questions) {
      const id = (
        await request(http)
          .post('/api/v1/ai/conversations')
          .auth(userToken, { type: 'bearer' })
          .send({})
          .expect(201)
      ).body.data.conversationId as string;
      const message = await answer(question.content, id);
      expect(String(message.content)).toMatch(question.expected);
      expect(String(message.content)).toMatch(/\[S\d+\]/u);
      expect(message.citations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sourceType: question.type,
            sourceId: String(question.id),
          }),
        ]),
      );
      const detail = (
        await request(http)
          .get(`/api/v1/ai/conversations/${id}`)
          .auth(userToken, { type: 'bearer' })
          .expect(200)
      ).body.data;
      expect(detail.messages[1]).toEqual(message);
      results.push({
        id: 'K13-' + question.type,
        answer: message.content,
        citations: message.citations,
      });
    }
  });
  it('rejects stale article and resort vectors before Kafka catches up with published administrator edits', async () => {
    const previous = await prisma.ragDocument.findMany({
      where: {
        SourceKey: { in: [`article:${articleId}`, `resort:${resortId}`] },
      },
      select: { SourceKey: true, ContentHash: true },
    });
    let articleEvent: OutboxEvent, resortEvent: OutboxEvent;
    await recovery.stop();
    try {
      const article = await command(
        'patch',
        `/api/v1/admin/articles/${articleId}`,
        articleBody(true),
      );
      expect(article.body.data.status).toBe('published');
      articleEvent = await changedEvent('article', articleId);
      const resort = await command(
        'patch',
        `/api/v1/admin/resorts/${resortId}`,
        { openingHours: '09:00–17:30' },
      );
      expect(resort.body.data.status).toBe('published');
      resortEvent = await changedEvent('ski_resort', resortId);
      expect(
        (await searchSources()).filter((row) =>
          [`article:${articleId}`, `resort:${resortId}`].includes(
            row.sourceKey,
          ),
        ),
      ).toEqual([]);
      expect(
        await prisma.ragDocument.findMany({
          where: {
            SourceKey: { in: [`article:${articleId}`, `resort:${resortId}`] },
          },
          select: { SourceKey: true, ContentHash: true },
        }),
      ).toEqual(previous);
      for (const event of [articleEvent, resortEvent])
        expect(
          (
            await prisma.outboxEvent.findUniqueOrThrow({
              where: { EventId: event.EventId },
            })
          ).Status,
        ).not.toBe('published');
    } finally {
      await recovery.start();
    }
    await delivered(articleEvent!);
    await delivered(resortEvent!);
    await sourceIndexed(`article:${articleId}`, '蓝色护具卡');
    await sourceIndexed(`resort:${resortId}`, '17:30');
    results.push({
      id: 'K14',
      staleExcludedBeforeConsumer: true,
      articleRemainsPublished: true,
      globalAdminResortRemainsPublished: true,
      brokerRestarted: true,
    });
  });
  it('filters an article immediately when its category is disabled while preserving the published resort', async () => {
    await sourceIndexed(`resort:${resortId}`, '17:30');
    await recovery.stop();
    try {
      await command(
        'patch',
        `/api/v1/admin/dictionaries/${categoryType}/items/${categoryId}`,
        { status: 'disabled' },
      );
      const sources = await searchSources();
      expect(
        sources.some((row) => row.sourceKey === `article:${articleId}`),
      ).toBe(false);
      expect(
        sources.some((row) => row.sourceKey === `resort:${resortId}`),
      ).toBe(true);
      expect(
        (
          await prisma.ragDocument.findUniqueOrThrow({
            where: { SourceKey: `article:${articleId}` },
          })
        ).Status,
      ).toBe('indexed');
    } finally {
      await recovery.start();
    }
    await drainNewEvents();
    results.push({
      id: 'K15',
      disabledCategoryExcludedBeforeConsumer: true,
      publishedResortUnaffected: true,
    });
  });
  it('restores category visibility through real Kafka then excludes withdrawn and offline sources before consumption', async () => {
    await command(
      'patch',
      `/api/v1/admin/dictionaries/${categoryType}/items/${categoryId}`,
      { status: 'active' },
    );
    await drainNewEvents();
    expect(
      (await searchSources()).some(
        (row) => row.sourceKey === `article:${articleId}`,
      ),
    ).toBe(true);
    let articleEvent: OutboxEvent, resortEvent: OutboxEvent;
    await recovery.stop();
    try {
      await command(
        'patch',
        `/api/v1/admin/articles/${articleId}/withdraw`,
        {},
      );
      articleEvent = await changedEvent('article', articleId);
      await command('patch', `/api/v1/admin/resorts/${resortId}/offline`, {});
      resortEvent = await changedEvent('ski_resort', resortId);
      expect(
        (await searchSources()).filter((row) =>
          [`article:${articleId}`, `resort:${resortId}`].includes(
            row.sourceKey,
          ),
        ),
      ).toEqual([]);
    } finally {
      await recovery.start();
    }
    await delivered(articleEvent!);
    await delivered(resortEvent!);
    for (const sourceKey of [`article:${articleId}`, `resort:${resortId}`])
      expect(
        (
          await prisma.ragDocument.findUniqueOrThrow({
            where: { SourceKey: sourceKey },
          })
        ).Status,
      ).toBe('disabled');
    results.push({
      id: 'K16',
      restoredCategoryVisible: true,
      withdrawalExcludedBeforeConsumer: true,
      resortOfflineExcludedBeforeConsumer: true,
    });
  });
  it('soft-deletes both source types with their final events and exact per-resource audits', async () => {
    for (const [path, type, id] of [
      ['/api/v1/admin/articles', 'article', articleId],
      ['/api/v1/admin/resorts', 'ski_resort', resortId],
    ] as const) {
      await request(http)
        .delete(`${path}/${id}`)
        .auth(adminToken, { type: 'bearer' })
        .expect(204);
      await delivered(await changedEvent(type, id));
    }
    expect(
      (
        await prisma.article.findUniqueOrThrow({
          where: { ArticleId: articleId },
        })
      ).DeletedAt,
    ).not.toBeNull();
    expect(
      (
        await prisma.skiResort.findUniqueOrThrow({
          where: { ResortId: resortId },
        })
      ).DeletedAt,
    ).not.toBeNull();
    expect(
      await prisma.operationLog.count({
        where: { ResourceKey: 'article', TargetId: String(articleId) },
      }),
    ).toBe(5);
    expect(
      await prisma.operationLog.count({
        where: { ResourceKey: 'resort', TargetId: String(resortId) },
      }),
    ).toBe(5);
    await command(
      'patch',
      `/api/v1/admin/dictionaries/${categoryType}/items/${categoryId}`,
      { status: 'disabled' },
    );
    await drainNewEvents();
    expect(
      (await searchSources()).filter((row) =>
        [`article:${articleId}`, `resort:${resortId}`].includes(row.sourceKey),
      ),
    ).toEqual([]);
    expect(chatCalls).toBe(4);
    results.push({
      id: 'K17',
      softDeleted: true,
      articleAudits: 5,
      resortAudits: 5,
    });
  });

  it('keeps pending dynamics and private dictionary hierarchies out of real embeddings', async () => {
    const before = embeddingCalls;
    const created = await request(http)
      .post('/api/v1/dynamics')
      .auth(userToken, { type: 'bearer' })
      .send({ content: dynamicContent(), imageAssetIds: [] })
      .expect(201);
    dynamicId = created.body.data.dynamicId as number;
    expect(created.body.data.status).toBe('pending');
    await command('post', '/api/v1/admin/dictionaries', {
      dictType: publicDictionary,
      dictName: '合成银桦夜滑安全准备',
      groupKey: 'pipeline',
      publiclyReadable: false,
    });
    dictionaryCreated = true;
    dictionaryParentId = (
      await command(
        'post',
        `/api/v1/admin/dictionaries/${publicDictionary}/items`,
        {
          label: '合成银桦夜滑集合须知',
          value: 'meeting-point',
          sortOrder: 0,
          isDefault: false,
        },
      )
    ).body.data.itemId as number;
    dictionaryLeafId = (
      await command(
        'post',
        `/api/v1/admin/dictionaries/${publicDictionary}/items`,
        {
          label: '合成银桦夜滑必须携带头灯',
          value: 'headlamp',
          parentId: dictionaryParentId,
          sortOrder: 0,
          isDefault: false,
        },
      )
    ).body.data.itemId as number;
    await drainNewEvents();
    expect(embeddingCalls).toBe(before);
    expect(
      await prisma.ragDocument.count({
        where: { SourceKey: { in: extraSourceKeys() } },
      }),
    ).toBe(0);
    results.push({
      id: 'K18',
      pendingExcluded: true,
      privateHierarchyExcluded: true,
    });
  });

  it('requires moderation and explicit public dictionary policy before Kafka indexes either source', async () => {
    const before = [
      await prisma.outboxEvent.count(),
      await prisma.operationLog.count(),
    ];
    await request(http)
      .patch(`/api/v1/admin/dynamics/${dynamicId}/moderation`)
      .auth(userToken, { type: 'bearer' })
      .send({ action: 'approve' })
      .expect(403);
    await request(http)
      .patch(`/api/v1/admin/dictionaries/${publicDictionary}`)
      .auth(userToken, { type: 'bearer' })
      .send({ publiclyReadable: true })
      .expect(403);
    expect([
      await prisma.outboxEvent.count(),
      await prisma.operationLog.count(),
    ]).toEqual(before);
    await command('patch', `/api/v1/admin/dynamics/${dynamicId}/moderation`, {
      action: 'approve',
      reason: '合成验收审核',
    });
    await command('patch', `/api/v1/admin/dictionaries/${publicDictionary}`, {
      publiclyReadable: true,
    });
    await drainNewEvents();
    await sourceIndexed(`dynamic:${dynamicId}`, '18:20');
    const leaf = await sourceIndexed(
      `dictionary:${publicDictionary}:headlamp`,
      '必须携带头灯',
    );
    expect(leaf.Content).toContain(
      '合成银桦夜滑集合须知 / 合成银桦夜滑必须携带头灯',
    );
    for (const key of extraSourceKeys()) {
      const doc = await prisma.ragDocument.findUniqueOrThrow({
        where: { SourceKey: key },
      });
      const vectors = await prisma.$queryRaw<
        { dimensions: number; norm: number }[]
      >`
        SELECT vector_dims("Embedding") AS dimensions, vector_norm("Embedding") AS norm
        FROM "RagChunk" WHERE "RagDocumentId" = ${doc.RagDocumentId}`;
      expect(vectors.length).toBeGreaterThan(0);
      for (const vector of vectors) {
        expect(vector.dimensions).toBe(1024);
        expect(vector.norm).toBeCloseTo(1, 3);
      }
    }
    const visible = (await searchExtraSources()).map((row) => row.sourceKey);
    for (const key of extraSourceKeys()) expect(visible).toContain(key);
    results.push({
      id: 'K19',
      approvalRequired: true,
      explicitPublicPolicyRequired: true,
      realVectors: 3,
    });
  });

  it('answers and persists traceable citations from both dynamic and hierarchical dictionary sources', async () => {
    for (const question of [
      {
        type: 'dynamic',
        id: dynamicId,
        text: '根据合成银桦夜滑签到点动态，几点开始签到、在哪种颜色的帐篷集合？请简短回答并引用动态来源。',
        expected: /18[:：]20|六点二十/u,
      },
      {
        type: 'dictionary',
        id: dictionaryLeafId,
        text: '根据合成银桦夜滑安全准备公开字典，夜滑必须携带什么照明装备？请简短回答并引用对应字典条目。',
        expected: /头灯/u,
      },
    ]) {
      const id = (
        await request(http)
          .post('/api/v1/ai/conversations')
          .auth(userToken, { type: 'bearer' })
          .send({})
          .expect(201)
      ).body.data.conversationId as string;
      const message = await answer(question.text, id);
      expect(String(message.content)).toMatch(question.expected);
      expect(String(message.content)).toMatch(/\[S\d+\]/u);
      expect(message.citations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sourceType: question.type,
            sourceId: String(question.id),
          }),
        ]),
      );
      const detail = (
        await request(http)
          .get(`/api/v1/ai/conversations/${id}`)
          .auth(userToken, { type: 'bearer' })
          .expect(200)
      ).body.data;
      expect(detail.messages[1]).toEqual(message);
      results.push({
        id: 'K20-' + question.type,
        answer: message.content,
        citations: message.citations,
      });
    }
    expect(chatCalls).toBe(6);
  });

  it('rejects stale dynamics and descendant dictionary paths while the owned broker is stopped', async () => {
    await recovery.stop();
    try {
      await request(http)
        .patch(`/api/v1/dynamics/${dynamicId}`)
        .auth(userToken, { type: 'bearer' })
        .send({ content: dynamicContent(true) })
        .expect(200);
      expect(
        (
          await prisma.dynamic.findUniqueOrThrow({
            where: { DynamicId: dynamicId },
          })
        ).Status,
      ).toBe('pending');
      await command(
        'patch',
        `/api/v1/admin/dictionaries/${publicDictionary}/items/${dictionaryParentId}`,
        { label: '合成银桦夜滑更新集合须知' },
      );
      const old = await prisma.ragDocument.findMany({
        where: { SourceKey: { in: extraSourceKeys() } },
      });
      expect(old).toHaveLength(3);
      expect(old.every((doc) => doc.Status === 'indexed')).toBe(true);
      expect(
        (await searchExtraSources()).filter((row) =>
          extraSourceKeys().includes(row.sourceKey),
        ),
      ).toEqual([]);
    } finally {
      await recovery.start();
    }
    await drainNewEvents();
    expect(
      (
        await prisma.ragDocument.findUniqueOrThrow({
          where: { SourceKey: `dynamic:${dynamicId}` },
        })
      ).Status,
    ).toBe('disabled');
    await sourceIndexed(
      `dictionary:${publicDictionary}:headlamp`,
      '更新集合须知 /',
    );
    await command('patch', `/api/v1/admin/dynamics/${dynamicId}/moderation`, {
      action: 'approve',
      reason: '合成更新复审',
    });
    await drainNewEvents();
    await sourceIndexed(`dynamic:${dynamicId}`, '18:40');
    const visible = (await searchExtraSources()).map((row) => row.sourceKey);
    for (const key of extraSourceKeys()) expect(visible).toContain(key);
    results.push({
      id: 'K21',
      staleSnapshotsExcluded: true,
      descendantReindexed: true,
      publishedEditRequiredApproval: true,
    });
  });

  it('filters descendants immediately when an ancestor is disabled and recovers after re-enabling', async () => {
    await recovery.stop();
    try {
      await command(
        'patch',
        `/api/v1/admin/dictionaries/${publicDictionary}/items/${dictionaryParentId}`,
        { status: 'disabled' },
      );
      const visible = (await searchExtraSources()).map((row) => row.sourceKey);
      expect(visible).not.toContain(`dictionary:${publicDictionary}:headlamp`);
      expect(visible).not.toContain(
        `dictionary:${publicDictionary}:meeting-point`,
      );
      expect(visible).toContain(`dynamic:${dynamicId}`);
      expect(
        (
          await prisma.ragDocument.findUniqueOrThrow({
            where: { SourceKey: `dictionary:${publicDictionary}:headlamp` },
          })
        ).Status,
      ).toBe('indexed');
    } finally {
      await recovery.start();
    }
    await drainNewEvents();
    for (const key of extraSourceKeys().filter((key) =>
      key.startsWith('dictionary:'),
    ))
      expect(
        (
          await prisma.ragDocument.findUniqueOrThrow({
            where: { SourceKey: key },
          })
        ).Status,
      ).toBe('disabled');
    await command(
      'patch',
      `/api/v1/admin/dictionaries/${publicDictionary}/items/${dictionaryParentId}`,
      { status: 'active' },
    );
    await drainNewEvents();
    await sourceIndexed(`dictionary:${publicDictionary}:headlamp`, '头灯');
    expect((await searchExtraSources()).map((row) => row.sourceKey)).toContain(
      `dictionary:${publicDictionary}:headlamp`,
    );
    results.push({
      id: 'K22',
      ancestorStateAppliedBeforeKafka: true,
      recoveredHierarchy: true,
    });
  });

  it('revokes dynamic moderation and dictionary public visibility before delayed Kafka consumption', async () => {
    await recovery.stop();
    try {
      await command('patch', `/api/v1/admin/dynamics/${dynamicId}/moderation`, {
        action: 'hide',
        reason: '合成隐藏验证',
      });
      await command('patch', `/api/v1/admin/dictionaries/${publicDictionary}`, {
        publiclyReadable: false,
      });
      expect(
        (await searchExtraSources()).filter((row) =>
          extraSourceKeys().includes(row.sourceKey),
        ),
      ).toEqual([]);
      expect(
        await prisma.ragDocument.count({
          where: { SourceKey: { in: extraSourceKeys() }, Status: 'indexed' },
        }),
      ).toBe(3);
    } finally {
      await recovery.start();
    }
    await drainNewEvents();
    expect(
      await prisma.ragDocument.count({
        where: { SourceKey: { in: extraSourceKeys() }, Status: 'disabled' },
      }),
    ).toBe(3);
    const before = chatCalls;
    const id = (
      await request(http)
        .post('/api/v1/ai/conversations')
        .auth(userToken, { type: 'bearer' })
        .send({})
        .expect(201)
    ).body.data.conversationId as string;
    const message = await answer('合成银桦夜滑需要什么装备，几点签到？', id);
    expect(message.content).toBe(
      '目前没有检索到可用于回答的资料，请调整问题后重试。',
    );
    expect(message.citations).toEqual([]);
    expect(chatCalls).toBe(before);
    results.push({
      id: 'K23',
      hiddenAndPrivateExcludedBeforeKafka: true,
      deterministicNoEvidence: true,
      noChatCharge: true,
    });
  });

  it('soft-deletes the dynamic and disables the dictionary with delivered events and exact transaction audits', async () => {
    await request(http)
      .delete(`/api/v1/admin/dynamics/${dynamicId}`)
      .auth(adminToken, { type: 'bearer' })
      .expect(204);
    await request(http)
      .delete(`/api/v1/admin/dictionaries/${publicDictionary}`)
      .auth(adminToken, { type: 'bearer' })
      .expect(204);
    await drainNewEvents();
    expect(
      (
        await prisma.dynamic.findUniqueOrThrow({
          where: { DynamicId: dynamicId },
        })
      ).DeletedAt,
    ).not.toBeNull();
    expect(
      (
        await prisma.dictionaryType.findUniqueOrThrow({
          where: { DictType: publicDictionary },
        })
      ).Status,
    ).toBe('disabled');
    expect(
      await prisma.operationLog.count({
        where: {
          ResourceKey: 'community',
          TargetType: 'Dynamic',
          TargetId: String(dynamicId),
        },
      }),
    ).toBe(4);
    expect(
      await prisma.operationLog.count({
        where: {
          ResourceKey: 'system:dict',
          TargetId: {
            in: [
              publicDictionary,
              String(dictionaryParentId),
              String(dictionaryLeafId),
            ],
          },
        },
      }),
    ).toBe(9);
    expect(chatCalls).toBe(6);
    results.push({
      id: 'K24',
      softDeleted: true,
      dictionaryDisabled: true,
      dynamicModerationAudits: 4,
      dictionaryAudits: 9,
    });
  });

  function extraSourceKeys() {
    return [
      `dynamic:${dynamicId}`,
      `dictionary:${publicDictionary}:meeting-point`,
      `dictionary:${publicDictionary}:headlamp`,
    ];
  }
  async function searchExtraSources() {
    const [embedding] = await embed.embed([
      '合成银桦夜滑签到时间与头灯安全准备',
    ]);
    return app.get(RagRetrievalService).search(
      {
        embedding: embedding!,
        embeddingModel: process.env.EMBEDDING_MODEL!,
        limit: 10,
      },
      null,
    );
  }

  async function login(account: string, password: string) {
    return (
      await request(http)
        .post('/api/v1/auth/login')
        .send({ account, password })
        .expect(200)
    ).body.data.accessToken as string;
  }
  function command(
    method: 'post' | 'patch',
    path: string,
    body: Record<string, unknown>,
  ) {
    return request(http)
      [method](path)
      .auth(adminToken, { type: 'bearer' })
      .send(body)
      .expect(method === 'post' ? 201 : 200);
  }
  async function changedEvent(
    aggregateType = 'project_doc',
    aggregateId = projectId,
  ) {
    const rows = await prisma.outboxEvent.findMany({
      where: {
        AggregateType: aggregateType,
        AggregateId: String(aggregateId),
        EventId: { notIn: [...events] },
      },
    });
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    events.add(row.EventId);
    return row;
  }
  async function delivered(event: OutboxEvent) {
    await eventually(
      async () =>
        (
          await prisma.outboxEvent.findUniqueOrThrow({
            where: { EventId: event.EventId },
          })
        ).Status === 'published' &&
        (await prisma.consumedEvent.count({
          where: { EventId: event.EventId, Status: 'completed' },
        })) === 1,
      'Outbox / Inbox ' + event.EventId,
    );
  }
  async function indexed(hour: number) {
    const doc = await prisma.ragDocument.findUniqueOrThrow({
      where: { SourceKey: `project:${projectId}` },
      include: { Chunks: true },
    });
    expect(doc.Status).toBe('indexed');
    expect(doc.Chunks.map((c) => c.ChunkContent).join('\n')).toContain(
      `${hour}:00`,
    );
    expect(
      doc.Chunks.every((c) => c.EmbeddingModel === process.env.EMBEDDING_MODEL),
    ).toBe(true);
    return doc;
  }
  async function drainNewEvents() {
    const rows = await prisma.outboxEvent.findMany({
      where: { EventId: { notIn: [...events] } },
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      events.add(row.EventId);
      await delivered(row);
    }
  }
  async function sourceIndexed(sourceKey: string, text: string) {
    const doc = await prisma.ragDocument.findUniqueOrThrow({
      where: { SourceKey: sourceKey },
      include: { Chunks: true },
    });
    expect(doc.Status).toBe('indexed');
    expect(doc.Chunks.map((row) => row.ChunkContent).join('\n')).toContain(
      text,
    );
    expect(
      doc.Chunks.every(
        (row) => row.EmbeddingModel === process.env.EMBEDDING_MODEL,
      ),
    ).toBe(true);
    return doc;
  }
  async function searchSources() {
    const [embedding] = await embed.embed([
      '合成青杉练习雪场营业时间与初学滑雪护具说明',
    ]);
    return app.get(RagRetrievalService).search(
      {
        embedding: embedding!,
        embeddingModel: process.env.EMBEDDING_MODEL!,
        limit: 10,
      },
      null,
    );
  }
  async function answer(
    content = '根据当前最新公开资料，合成北坡咨询服务站每天几点结束服务？请简短回答并引用资料。',
    id = conversationId,
  ) {
    const response = await request(http)
      .post(`/api/v1/ai/conversations/${id}/messages`)
      .auth(userToken, { type: 'bearer' })
      .send({
        clientRequestId: randomUUID(),
        content,
      })
      .expect(200);
    const frames = response.text
      .trim()
      .split(/\r?\n\r?\n/u)
      .map((frame) => {
        const name = frame
          .split(/\r?\n/u)
          .find((line) => line.startsWith('event:'))
          ?.slice(6)
          .trim();
        const data = frame
          .split(/\r?\n/u)
          .find((line) => line.startsWith('data:'))
          ?.slice(5)
          .trim();
        return {
          name,
          data: data ? (JSON.parse(data) as Record<string, unknown>) : null,
        };
      });
    expect(frames.some((frame) => frame.name === 'error')).toBe(false);
    const completed = frames.find((frame) => frame.name === 'completed')?.data;
    expect(completed).toBeDefined();
    return completed!;
  }
});

async function eventually(check: () => Promise<boolean>, description: string) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(100);
  }
  throw new Error('Timed out: ' + description);
}
