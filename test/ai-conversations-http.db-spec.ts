import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { IdentityAccessModule } from '../src/modules/identity-access/identity-access.module.js';
import { BcryptPasswordHasher } from '../src/modules/identity-access/infrastructure/bcrypt-password-hasher.js';
import { AiAssistantModule } from '../src/modules/ai-assistant/ai-assistant.module.js';
import {
  CHAT_MODEL_PROVIDER,
  type ChatModelProvider,
} from '../src/modules/ai-assistant/application/ports/chat-model-provider.js';
import {
  EMBEDDING_PROVIDER,
  type EmbeddingProvider,
} from '../src/modules/ai-assistant/application/ports/embedding-provider.js';
import { RagDocumentIndexingService } from '../src/modules/ai-assistant/application/rag-document-indexing.service.js';
import {
  projectSourceState,
  resortSourceState,
} from '../src/modules/ai-assistant/domain/rag-source-state.js';
import { ProjectKnowledgeRagEventHandler } from '../src/modules/ai-assistant/application/project-knowledge-rag-event-handler.js';
import { INBOX_LEASE } from '../src/modules/integration-events/application/ports/inbox-lease.js';
import { PrismaInboxExecutor } from '../src/modules/integration-events/infrastructure/prisma-inbox.executor.js';
import { DatabaseModule } from '../src/shared/persistence/database.module.js';
import { PrismaService } from '../src/shared/persistence/prisma.service.js';
import { configureHttp } from '../src/shared/http/configure-http.js';
import { LoginBucketKeys } from '../src/modules/identity-access/infrastructure/login-bucket-keys.js';

// Only the two external AI providers are replaced. Authentication, authorization,
// HTTP/SSE, indexing, pgvector retrieval and conversation persistence are real.
describe('AI HTTP / SSE / PostgreSQL / pgvector pipeline', () => {
  const prefix = `ai-http-${randomUUID().slice(0, 8)}`;
  const password = 'ai-http-validation-password';
  const model = `${prefix}-embedding`;
  const vector = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0));
  const embed = vi.fn<EmbeddingProvider['embed']>();
  const stream = vi.fn<ChatModelProvider['stream']>();
  const users: number[] = [],
    resorts: number[] = [],
    projects: number[] = [],
    eventIds: string[] = [],
    sourceKeys: string[] = [];
  type Actor = { id: number; token: string };
  type Event = { event: string; data: Record<string, unknown> };
  let app: INestApplication<App>, http: App, prisma: PrismaService;
  let roleId: number,
    actor: Actor,
    passwordHash: string,
    publicResortId: number;
  const base = '/api/v1/ai/conversations';
  const answer = '请参考公开雪场资料 [S1]。';

  beforeAll(async () => {
    if (!process.env.DATABASE_URL)
      throw new Error('Dedicated migrated database required');
    vi.stubEnv(
      'JWT_ACCESS_SECRET',
      'ai-http-validation-secret-at-least-32-characters',
    );
    vi.stubEnv('EMBEDDING_MODEL', model);
    vi.stubEnv('CHAT_MODEL_NAME', `${prefix}-chat`);
    defaults();
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
    })
      .overrideProvider(CHAT_MODEL_PROVIDER)
      .useValue({ stream })
      .overrideProvider(EMBEDDING_PROVIDER)
      .useValue({ embed })
      .compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.listen(0, '127.0.0.1');
    http = app.getHttpServer();
    prisma = app.get(PrismaService);
    roleId = (
      await prisma.role.findUniqueOrThrow({
        where: { SystemRoleCode: 'registered_user' },
      })
    ).RoleId;
    passwordHash = await new BcryptPasswordHasher().hash(password);
    const indexing = app.get(RagDocumentIndexingService);
    for (const kind of ['public', 'draft', 'stale', 'private'] as const) {
      const row = await prisma.skiResort.create({
        data: {
          Name: `${prefix}-${kind}`,
          LegacyDistance: 0,
          Price: 100,
          SnowCondition: 'powder',
          Description: `${kind}-reference-${prefix}`,
          Status: kind === 'draft' ? 'draft' : 'published',
        },
        include: { FitTags: { include: { Item: true } } },
      });
      resorts.push(row.ResortId);
      const sourceKey = `resort:${row.ResortId}`;
      sourceKeys.push(sourceKey);
      await indexing.index({
        sourceKey,
        sourceType: 'resort',
        sourceId: row.ResortId,
        title: row.Name,
        content: row.Description,
        accessScope: kind === 'private' ? 'admin' : 'public',
        merchantId: null,
        sourceUpdatedAt: row.UpdateTime,
        sourceState: resortSourceState(row),
      });
      if (kind === 'public') publicResortId = row.ResortId;
      if (kind === 'stale')
        await prisma.skiResort.update({
          where: { ResortId: row.ResortId },
          data: { Description: 'changed before async reindex' },
        });
    }
  });
  beforeEach(async () => {
    defaults();
    // Independent business examples each start a fresh synthetic IP window.
    // Keep the real limiter and thresholds active within every example.
    await prisma.loginAttemptBucket.deleteMany({
      where: { BucketKey: app.get(LoginBucketKeys).ip('127.0.0.1') },
    });
    actor = await account();
  });
  afterAll(async () => {
    try {
      if (prisma) {
        await prisma.aiConversation.deleteMany({
          where: { UserId: { in: users } },
        });
        await prisma.user.deleteMany({ where: { UserId: { in: users } } });
        await prisma.ragDocument.deleteMany({
          where: { SourceKey: { in: sourceKeys } },
        });
        await prisma.projectKnowledge.deleteMany({
          where: { ProjectKnowledgeId: { in: projects } },
        });
        await prisma.consumedEvent.deleteMany({
          where: { EventId: { in: eventIds } },
        });
        await prisma.skiResort.deleteMany({
          where: { ResortId: { in: resorts } },
        });
      }
    } finally {
      await app?.close();
      vi.unstubAllEnvs();
    }
  });
  function defaults() {
    embed
      .mockReset()
      .mockImplementation(async (texts) => texts.map(() => vector));
    stream.mockReset().mockImplementation(async function* () {
      yield answer.slice(0, 4);
      yield answer.slice(4);
    });
  }
  async function account(granted = true): Promise<Actor> {
    const row = await prisma.user.create({
      data: {
        Account: `${prefix}-${users.length}`,
        Nickname: prefix,
        PasswordHash: passwordHash,
        ...(granted ? { UserRoles: { create: { RoleId: roleId } } } : {}),
      },
    });
    users.push(row.UserId);
    const result = await request(http)
      .post('/api/v1/auth/login')
      .send({ account: row.Account, password })
      .expect(200);
    return { id: row.UserId, token: result.body.data.accessToken as string };
  }
  async function create(owner = actor) {
    const result = await request(http)
      .post(base)
      .auth(owner.token, { type: 'bearer' })
      .send({})
      .expect(201);
    return result.body.data.conversationId as string;
  }
  const get = (path = '', owner = actor) =>
    request(http).get(`${base}${path}`).auth(owner.token, { type: 'bearer' });
  const remove = (id: string, owner = actor) =>
    request(http).delete(`${base}/${id}`).auth(owner.token, { type: 'bearer' });
  const send = (
    id: string,
    key = randomUUID(),
    content = '这家雪场怎么样？',
    owner = actor,
  ) =>
    request(http)
      .post(`${base}/${id}/messages`)
      .auth(owner.token, { type: 'bearer' })
      .send({ clientRequestId: key, content });
  function events(body: string): Event[] {
    return body
      .trim()
      .split('\n\n')
      .map((block) => {
        const lines = block.split('\n');
        return {
          event: lines[0]!.slice('event: '.length),
          data: JSON.parse(lines[1]!.slice('data: '.length)) as Record<
            string,
            unknown
          >,
        };
      });
  }
  const messages = (id: string) =>
    prisma.aiMessage.findMany({
      where: { ConversationId: id },
      orderBy: { MessageId: 'asc' },
    });
  function gate() {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { promise, release };
  }

  it('requires real login and the current AI grant on every route', async () => {
    await request(http).get(base).expect(401);
    const ungranted = await account(false);
    const id = await create();
    for (const makeRequest of [
      () => get('', ungranted),
      () => get(`/${id}`, ungranted),
      () => remove(id, ungranted),
      () => send(id, randomUUID(), 'x', ungranted),
      () =>
        request(http)
          .post(base)
          .auth(ungranted.token, { type: 'bearer' })
          .send({}),
    ])
      await makeRequest().expect(403);
    await prisma.userRole.deleteMany({ where: { UserId: actor.id } });
    await get().expect(403);
    expect(embed).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
  });

  it('isolates owner lists/detail/delete/send and keeps soft-deleted messages', async () => {
    const id = await create(),
      other = await account();
    expect((await get('', other).expect(200)).body.data.total).toBe(0);
    for (const target of [id, randomUUID()]) {
      await get(`/${target}`, other).expect(404);
      await remove(target, other).expect(404);
      await send(target, randomUUID(), 'x', other).expect(404);
    }
    await send(id).expect(200);
    await remove(id).expect(204);
    await remove(id).expect(204);
    await get(`/${id}`).expect(404);
    await send(id).expect(404);
    expect((await get().expect(200)).body.data.total).toBe(0);
    expect(await messages(id)).toHaveLength(2);
  });

  it.each([
    'page=0',
    'page=1.2',
    'pageSize=101',
    'page=2147483647&pageSize=100',
    'page=9007199254740992',
    'page=Infinity',
  ])('rejects invalid pagination %s with 400', async (query) => {
    await get(`?${query}`).expect(400);
  });

  it('validates UUIDs, immutable ownership, whitespace and Unicode length before persistence', async () => {
    const id = await create();
    await get('/invalid-uuid').expect(400);
    await request(http)
      .post(base)
      .auth(actor.token, { type: 'bearer' })
      .send({ userId: actor.id })
      .expect(400);
    for (const content of [null, 42, {}, '', '  ', '😀'.repeat(4001)]) {
      await request(http)
        .post(`${base}/${id}/messages`)
        .auth(actor.token, { type: 'bearer' })
        .send({ clientRequestId: randomUUID(), content })
        .expect(400);
    }
    await request(http)
      .post(`${base}/${id}/messages`)
      .auth(actor.token, { type: 'bearer' })
      .send({ clientRequestId: 'bad', content: 'x' })
      .expect(400);
    expect(await messages(id)).toHaveLength(0);
    expect(embed).not.toHaveBeenCalled();
  });

  it('retrieves only current public evidence, commits before completed, and replays without external calls', async () => {
    const id = await create(),
      key = randomUUID();
    const response = await send(id, key, ' 初学者如何选雪场？ ').expect(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.headers['cache-control']).toContain('no-cache');
    const sequence = events(response.text);
    expect(sequence.map((e) => e.event)).toEqual([
      'delta',
      'delta',
      'completed',
    ]);
    const completed = sequence[2]!.data;
    expect(completed).toMatchObject({
      content: answer,
      role: 'assistant',
      status: 'complete',
      citations: [
        {
          sourceType: 'resort',
          sourceId: String(publicResortId),
          title: `${prefix}-public`,
          href: `/resorts/${publicResortId}`,
        },
      ],
    });
    expect(completed.citations).toHaveLength(1);
    const prompt = JSON.stringify(stream.mock.calls[0]![0]);
    expect(prompt).toContain(`public-reference-${prefix}`);
    for (const hidden of ['draft', 'stale', 'private'])
      expect(prompt).not.toContain(`${hidden}-reference-${prefix}`);
    const rows = await messages(id);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.Content).toBe('初学者如何选雪场？');
    expect(rows[1]).toMatchObject({
      Content: answer,
      GenerationStatus: 'completed',
      GenerationToken: null,
      Citations: completed.citations,
      ModelName: `${prefix}-chat`,
    });
    expect(rows[1]!.MessageId.toString()).toBe(completed.messageId);
    const detail = (await get(`/${id}`).expect(200)).body.data;
    expect(detail.messageCount).toBe(2);
    expect(detail.messages[1]).toEqual(completed);
    const replay = await send(id, key, '初学者如何选雪场？').expect(200);
    expect(events(replay.text)).toEqual([
      { event: 'completed', data: completed },
    ]);
    await send(id, key, 'different').expect(409);
    expect(embed).toHaveBeenCalledTimes(1);
    expect(stream).toHaveBeenCalledTimes(1);
    expect(await messages(id)).toHaveLength(2);
  });

  it('returns 409 during an active attempt and hides the placeholder from reads/counts', async () => {
    const id = await create(),
      key = randomUUID(),
      entered = gate(),
      finish = gate();
    stream.mockImplementation(async function* () {
      entered.release();
      await finish.promise;
      yield answer;
    });
    const pending = send(id, key).then((r) => r);
    try {
      await entered.promise;
      await send(id, key).expect(409);
      expect((await get(`/${id}`).expect(200)).body.data).toMatchObject({
        messageCount: 1,
        messages: [{ role: 'user' }],
      });
      expect((await get().expect(200)).body.data.items[0].messageCount).toBe(1);
    } finally {
      finish.release();
    }
    expect((await pending).status).toBe(200);
    expect(stream).toHaveBeenCalledTimes(1);
    expect(await messages(id)).toHaveLength(2);
  });

  it.each(['embedding', 'chat-before', 'chat-after', 'empty'] as const)(
    'redacts %s failure and retries the same logical message',
    async (failure) => {
      const id = await create(),
        key = randomUUID(),
        secret = 'provider-secret-and-internal-url';
      if (failure === 'embedding')
        embed.mockRejectedValueOnce(new Error(secret));
      else
        stream.mockImplementationOnce(async function* () {
          if (failure === 'chat-after') yield 'incomplete';
          if (failure !== 'empty') throw new Error(secret);
        });
      const failed = await send(id, key).expect(
        failure === 'chat-after' ? 200 : 500,
      );
      expect(failed.text).not.toContain(secret);
      expect(failed.text).not.toContain('event: completed');
      if (failure === 'chat-after') {
        const result = events(failed.text);
        expect(result.map((e) => e.event)).toEqual(['delta', 'error']);
        expect(result[1]!.data).toMatchObject({
          code: 'AI_GENERATION_FAILED',
          traceId: expect.any(String),
        });
      } else
        expect(failed.headers['content-type']).toContain('application/json');
      const before = await messages(id);
      expect(before).toHaveLength(2);
      expect(before[1]).toMatchObject({
        Content: '',
        GenerationStatus: 'failed',
        GenerationToken: null,
      });
      expect((await get(`/${id}`).expect(200)).body.data.messageCount).toBe(1);
      const retry = await send(id, key).expect(200);
      expect(events(retry.text).at(-1)!.event).toBe('completed');
      const after = await messages(id);
      expect(after.map((m) => m.MessageId)).toEqual(
        before.map((m) => m.MessageId),
      );
      expect(after[1]!.GenerationStatus).toBe('completed');
    },
  );

  it.each(['session', 'role-binding', 'account'] as const)(
    'stops the next chunk after a real database %s revocation commits',
    async (kind) => {
      const id = await create(),
        entered = gate(),
        finish = gate();
      let providerSignal: AbortSignal | undefined;
      const closed = vi.fn();
      stream.mockImplementation(async function* (_request, signal) {
        providerSignal = signal;
        try {
          yield 'allowed first chunk';
          entered.release();
          await finish.promise;
          yield 'must not leave server';
        } finally {
          closed();
        }
      });
      const pending = send(id).then((result) => result);
      try {
        await entered.promise;
        if (kind === 'session') {
          await prisma.authSession.updateMany({
            where: { UserId: actor.id },
            data: { RevokedAt: new Date() },
          });
        } else if (kind === 'role-binding') {
          await prisma.userRole.deleteMany({ where: { UserId: actor.id } });
        } else {
          await prisma.user.update({
            where: { UserId: actor.id },
            data: { Status: 'disabled' },
          });
        }
      } finally {
        finish.release();
      }
      const response = await pending;
      expect(response.status).toBe(200);
      expect(response.text).toContain('allowed first chunk');
      expect(response.text).not.toContain('must not leave server');
      expect(events(response.text).map((event) => event.event)).toEqual([
        'delta',
        'error',
      ]);
      const persisted = await messages(id);
      expect(persisted).toHaveLength(2);
      expect(persisted[1]).toMatchObject({
        GenerationStatus: 'failed',
        Content: '',
        GenerationToken: null,
      });
      expect(providerSignal?.aborted).toBe(true);
      expect(closed).toHaveBeenCalledOnce();
    },
  );

  it.each([
    'withdrawn',
    'manual-disabled',
    'source-edited',
    'reindexed',
  ] as const)(
    'stops an in-flight answer after its real RAG source becomes %s',
    async (kind) => {
      const id = await create(),
        entered = gate(),
        finish = gate();
      const original = await prisma.skiResort.findUniqueOrThrow({
        where: { ResortId: publicResortId },
        include: { FitTags: { include: { Item: true } } },
      });
      const sourceKey = `resort:${publicResortId}`;
      const closed = vi.fn();
      let providerSignal: AbortSignal | undefined;
      stream.mockImplementation(async function* (_input, signal) {
        providerSignal = signal;
        try {
          yield 'allowed first chunk';
          entered.release();
          await finish.promise;
          yield 'must not reach client';
        } finally {
          closed();
        }
      });
      const pending = send(id).then((result) => result);
      try {
        try {
          await entered.promise;
          if (kind === 'manual-disabled') {
            await prisma.ragDocument.update({
              where: { SourceKey: sourceKey },
              data: { ManualDisabled: true },
            });
          } else if (kind === 'reindexed') {
            const rebuilt = await app.get(RagDocumentIndexingService).index(
              {
                sourceKey,
                sourceType: 'resort',
                sourceId: original.ResortId,
                title: original.Name,
                content: original.Description,
                accessScope: 'public',
                merchantId: null,
                sourceUpdatedAt: original.UpdateTime,
                sourceState: resortSourceState(original),
              },
              undefined,
              { force: true },
            );
            expect(rebuilt.skipped).toBe(false);
          } else {
            await prisma.skiResort.update({
              where: { ResortId: publicResortId },
              data:
                kind === 'withdrawn'
                  ? { Status: 'pending_review' }
                  : { Description: 'reference edited during generation' },
            });
          }
        } finally {
          finish.release();
        }
        const response = await pending;
        expect(response.status).toBe(200);
        expect(response.text).toContain('allowed first chunk');
        expect(response.text).not.toContain('must not reach client');
        expect(events(response.text).map((event) => event.event)).toEqual([
          'delta',
          'error',
        ]);
        expect((await messages(id))[1]).toMatchObject({
          GenerationStatus: 'failed',
          Content: '',
          GenerationToken: null,
        });
        expect(closed).toHaveBeenCalledOnce();
        expect(providerSignal?.aborted).toBe(true);
      } finally {
        finish.release();
        await pending;
        await prisma.skiResort.update({
          where: { ResortId: publicResortId },
          data: { Status: original.Status, Description: original.Description },
        });
        await prisma.ragDocument.update({
          where: { SourceKey: sourceKey },
          data: { ManualDisabled: false },
        });
      }
    },
  );

  it('refuses completion when deletion commits during model generation', async () => {
    const id = await create(),
      entered = gate(),
      finish = gate();
    stream.mockImplementation(async function* () {
      yield 'partial';
      entered.release();
      await finish.promise;
      yield ' tail';
    });
    const pending = send(id).then((r) => r);
    try {
      await entered.promise;
      await remove(id).expect(204);
    } finally {
      finish.release();
    }
    const result = events((await pending).text);
    expect(result.at(-1)!.event).toBe('error');
    expect(result.some((e) => e.event === 'completed')).toBe(false);
    expect((await messages(id))[1]).toMatchObject({
      GenerationStatus: 'failed',
      Content: '',
    });
    await get(`/${id}`).expect(404);
  });

  it('cancels the external stream on client disconnect and leaves a retryable failed attempt', async () => {
    const id = await create(),
      key = randomUUID(),
      stopped = gate();
    stream.mockImplementationOnce(async function* (_input, signal) {
      try {
        yield 'partial';
        await new Promise<never>((_resolve, reject) => {
          const aborted = () => reject(new Error('provider cancelled'));
          signal!.addEventListener('abort', aborted, { once: true });
          if (signal!.aborted) aborted();
        });
      } finally {
        stopped.release();
      }
    });
    const abort = new AbortController();
    try {
      const response = await fetch(
        `${await app.getUrl()}${base}/${id}/messages`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${actor.token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            clientRequestId: key,
            content: '这家雪场怎么样？',
          }),
          signal: abort.signal,
        },
      );
      expect(response.status).toBe(200);
      const chunk = await response.body!.getReader().read();
      expect(new TextDecoder().decode(chunk.value)).toContain('event: delta');
      abort.abort();
      await stopped.promise;
      await vi.waitFor(async () => {
        expect((await messages(id))[1]).toMatchObject({
          GenerationStatus: 'failed',
          Content: '',
          GenerationToken: null,
        });
      });
    } finally {
      abort.abort();
    }
    expect((await get(`/${id}`).expect(200)).body.data.messageCount).toBe(1);
    await send(id, key).expect(200);
    expect(await messages(id)).toHaveLength(2);
    expect((await messages(id))[1]!.GenerationStatus).toBe('completed');
  });

  it.each(['dimension', 'nonfinite'] as const)(
    'rejects an invalid %s embedding before chat and can retry',
    async (kind) => {
      const id = await create(),
        key = randomUUID();
      embed.mockResolvedValueOnce([
        kind === 'dimension'
          ? [1, 0]
          : vector.map((v, i) => (i === 0 ? NaN : v)),
      ]);
      await send(id, key).expect(500);
      expect(stream).not.toHaveBeenCalled();
      expect((await messages(id))[1]!.GenerationStatus).toBe('failed');
      await send(id, key).expect(200);
      expect(await messages(id)).toHaveLength(2);
    },
  );

  it('uses only completed same-conversation user questions as context', async () => {
    const id = await create(),
      otherId = await create();
    await send(otherId, randomUUID(), 'other-conversation-secret').expect(200);
    await send(id, randomUUID(), '北岭雪场适合初学者吗？').expect(200);
    await send(id, randomUUID(), '那里开放时间？').expect(200);
    expect(embed.mock.calls[2]![0][0]).toContain('北岭雪场适合初学者吗？');
    const prompt = JSON.stringify(stream.mock.calls[2]![0]);
    expect(prompt).toContain('北岭雪场适合初学者吗？');
    expect(prompt).not.toContain(answer);
    expect(prompt).not.toContain('other-conversation-secret');
    expect(stream.mock.calls[2]![0].messages.map((m) => m.role)).toEqual([
      'system',
      'user',
    ]);
  });

  it('returns a deterministic no-evidence answer without calling chat when the public source is withdrawn', async () => {
    const id = await create();
    await prisma.skiResort.update({
      where: { ResortId: publicResortId },
      data: { Status: 'pending_review' },
    });
    try {
      const result = events((await send(id).expect(200)).text).at(-1)!.data;
      expect(result.content).toBe(
        '目前没有检索到可用于回答的资料，请调整问题后重试。',
      );
      expect(result.citations).toEqual([]);
      expect(stream).not.toHaveBeenCalled();
      expect((await messages(id))[1]!.GenerationStatus).toBe('completed');
    } finally {
      await prisma.skiResort.update({
        where: { ResortId: publicResortId },
        data: { Status: 'published' },
      });
    }
  });

  it.each([true, false])(
    'never sends legacy project knowledge to chat and recovers only safe revalidated sources (unsafe=%s)',
    async (unsafe) => {
      const row = await prisma.projectKnowledge.create({
        data: {
          Title: `${prefix}-legacy-project`,
          Content: unsafe
            ? 'api_key=legacy-never-send-marker'
            : 'Public platform ski guidance.',
          Category: 'faq',
          Status: 'published',
          PublishTime: new Date(),
        },
      });
      projects.push(row.ProjectKnowledgeId);
      const sourceKey = `project:${row.ProjectKnowledgeId}`;
      sourceKeys.push(sourceKey);
      await app.get(RagDocumentIndexingService).index({
        sourceKey,
        sourceType: 'project_doc',
        sourceId: row.ProjectKnowledgeId,
        title: row.Title,
        content: row.Content,
        accessScope: 'public',
        merchantId: null,
        sourceUpdatedAt: row.UpdateTime,
        sourceState: { ...projectSourceState(row), v: 1 },
      });
      const conversationId = await create();
      await prisma.skiResort.update({
        where: { ResortId: publicResortId },
        data: { Status: 'pending_review' },
      });
      try {
        const before = events((await send(conversationId).expect(200)).text).at(
          -1,
        )!.data;
        expect(before.citations).toEqual([]);
        expect(before.content).toBe(
          '目前没有检索到可用于回答的资料，请调整问题后重试。',
        );
        expect(stream).not.toHaveBeenCalled();
        const embeddingCallsBeforeReplay = embed.mock.calls.length;
        const eventId = randomUUID();
        eventIds.push(eventId);
        await app.get(ProjectKnowledgeRagEventHandler).handle({
          eventId,
          eventType: 'project_doc.changed.v1',
          aggregateType: 'project_doc',
          aggregateId: String(row.ProjectKnowledgeId),
          occurredAt: new Date(),
          payload: { projectKnowledgeId: row.ProjectKnowledgeId },
        });
        if (unsafe)
          expect(embed.mock.calls).toHaveLength(embeddingCallsBeforeReplay);
        else
          expect(embed.mock.calls.length).toBeGreaterThan(
            embeddingCallsBeforeReplay,
          );
        const after = events((await send(conversationId).expect(200)).text).at(
          -1,
        )!.data;
        if (unsafe) {
          expect(after.citations).toEqual([]);
          expect(stream).not.toHaveBeenCalled();
        } else {
          expect(after.citations).toEqual([
            expect.objectContaining({
              sourceType: 'project',
              sourceId: String(row.ProjectKnowledgeId),
              href: null,
            }),
          ]);
          expect(stream).toHaveBeenCalledOnce();
          expect(JSON.stringify(stream.mock.calls[0]![0])).toContain(
            row.Content,
          );
        }
        const persisted = (await messages(conversationId)).map((message) => ({
          content: message.Content,
          citations: message.Citations,
        }));
        expect(JSON.stringify(persisted)).not.toContain(
          'legacy-never-send-marker',
        );
      } finally {
        await prisma.skiResort.update({
          where: { ResortId: publicResortId },
          data: { Status: 'published' },
        });
        // Keep the common evidence fixture deterministic for subsequent cases.
        await prisma.ragDocument.update({
          where: { SourceKey: sourceKey },
          data: { Status: 'disabled' },
        });
      }
    },
  );

  it('serializes concurrent rate limits across conversations and retains counts after deletion', async () => {
    const ids = await Promise.all(Array.from({ length: 6 }, () => create()));
    const results = await Promise.all(ids.map((id) => send(id).then((r) => r)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(5);
    expect(results.filter((r) => r.status === 429)).toHaveLength(1);
    expect(stream).toHaveBeenCalledTimes(5);
    expect(
      await prisma.aiMessage.count({
        where: { Conversation: { UserId: actor.id } },
      }),
    ).toBe(10);
    await Promise.all(ids.map((id) => remove(id).expect(204)));
    await send(await create()).expect(429);
    const other = await account();
    await send(await create(other), randomUUID(), '独立用户额度', other).expect(
      200,
    );
  });
});
