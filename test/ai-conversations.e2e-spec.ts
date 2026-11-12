import { LOGIN_ATTEMPT_STORE } from '../src/modules/identity-access/application/ports/login-attempt-store.js';
import { Test } from '@nestjs/testing';
import { Logger, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureHttp } from '../src/shared/http/configure-http.js';
import { createOpenApiDocument } from '../src/shared/http/openapi-document.js';
import { AUTHORIZATION_PRINCIPAL_READER } from '../src/modules/identity-access/application/ports/authorization-principal-reader.js';
import { AUTH_TOKEN_SERVICE } from '../src/modules/identity-access/application/ports/auth-token-service.js';
import { AUTH_SESSION_REPOSITORY } from '../src/modules/identity-access/application/ports/auth-session-repository.js';
import { AI_CONVERSATION_REPOSITORY } from '../src/modules/ai-assistant/application/ports/ai-conversation.repository.js';
import type { AiConversationRepository } from '../src/modules/ai-assistant/application/ports/ai-conversation.repository.js';
import { RagAnswerService } from '../src/modules/ai-assistant/application/rag-answer.service.js';
import {
  AiConversationNotFoundError,
  AiMessageInProgressError,
  AiMessageRateLimitError,
} from '../src/modules/ai-assistant/application/ai-conversation.service.js';
import { UpstreamHttpError } from '../src/shared/diagnostics/failure-diagnostic.js';
import { ConfigService } from '@nestjs/config';
import { createServer } from 'node:http';
import { OpenAiCompatibleChatModelProvider } from '../src/modules/ai-assistant/infrastructure/openai-compatible-chat-model.provider.js';

const id = '11111111-1111-4111-8111-111111111111';
const clientRequestId = '22222222-2222-4222-8222-222222222222';
const time = new Date('2026-10-29T00:00:00Z');
const summary = {
  conversationId: id,
  title: null,
  status: 'active',
  createdAt: time,
  updatedAt: time,
  messageCount: 0,
};
const message = {
  messageId: '2',
  senderRole: 'assistant' as const,
  content: '公开雪场资料',
  citations: [],
  createdAt: time,
};

describe('AI conversation HTTP contract', () => {
  let app: INestApplication;
  let sessionActive = true;
  let aiGranted = true;
  let roleActive = true;
  let sessionCheckFails = false;
  const repository = {
    list: vi.fn<AiConversationRepository['list']>(),
    create: vi.fn<AiConversationRepository['create']>(),
    findDetail: vi.fn<AiConversationRepository['findDetail']>(),
    softDelete: vi.fn<AiConversationRepository['softDelete']>(),
    beginMessage: vi.fn<AiConversationRepository['beginMessage']>(),
    completeMessage: vi.fn<AiConversationRepository['completeMessage']>(),
    failMessage: vi.fn<AiConversationRepository['failMessage']>(),
  };
  const prepare = vi.fn<RagAnswerService['prepare']>();
  const errorLogs: unknown[] = [];
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    logSpy = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation((value: unknown) => {
        errorLogs.push(value);
      });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LOGIN_ATTEMPT_STORE)
      .useValue({ consume: async () => ({ allowed: true }) })
      .overrideProvider(AUTH_TOKEN_SERVICE)
      .useValue({
        verifyAccessToken: (token: string) =>
          token === 'owner' || token === 'no-grant'
            ? { userId: token === 'owner' ? 7 : 8, sessionId: 'test' }
            : null,
      })
      .overrideProvider(AUTH_SESSION_REPOSITORY)
      .useValue({
        isActive: async () => {
          if (sessionCheckFails)
            throw new Error('private session database error');
          return sessionActive;
        },
      })
      .overrideProvider(AUTHORIZATION_PRINCIPAL_READER)
      .useValue({
        findByUserId: async (userId: number) => ({
          userId,
          status: 'active',
          merchant: null,
          roles: [
            {
              key: 'custom-user',
              status: roleActive ? 'active' : 'disabled',
              dataScope: 'self',
              permissions:
                userId === 7 && aiGranted
                  ? [{ key: 'ai:conversation:use', status: 'active' }]
                  : [],
            },
          ],
        }),
      })
      .overrideProvider(AI_CONVERSATION_REPOSITORY)
      .useValue(repository)
      .overrideProvider(RagAnswerService)
      .useValue({ prepare })
      .compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.init();
  });
  afterAll(async () => {
    await app.close();
    logSpy.mockRestore();
  });
  beforeEach(() => {
    vi.resetAllMocks();
    errorLogs.length = 0;
    logSpy.mockImplementation((value: unknown) => {
      errorLogs.push(value);
    });
    sessionActive = true;
    aiGranted = true;
    roleActive = true;
    sessionCheckFails = false;
    repository.list.mockResolvedValue({ items: [summary], total: 1 });
    repository.create.mockResolvedValue(summary);
    repository.findDetail.mockResolvedValue({ ...summary, messages: [] });
    repository.softDelete.mockResolvedValue(true);
    repository.beginMessage.mockResolvedValue({
      kind: 'started',
      conversationId: id,
      userMessageId: 1n,
      assistantMessageId: 2n,
      generationToken: 'attempt',
      previousQuestions: [],
    });
    repository.completeMessage.mockResolvedValue(message);
    repository.failMessage.mockResolvedValue();
    prepare.mockImplementation(async () => ({
      citations: [],
      assertEvidenceCurrent: async () => undefined,
      stream: (async function* () {
        yield message.content;
      })(),
    }));
  });

  it.each(['session', 'grant', 'role', 'store'] as const)(
    'stops SSE on in-flight %s revocation/failure using the real policy adapter',
    async (kind) => {
      const closed = vi.fn();
      let signal: AbortSignal | undefined;
      prepare.mockImplementation(async (input) => {
        signal = input.signal;
        return {
          citations: [],
          assertEvidenceCurrent: async () => undefined,
          stream: (async function* () {
            try {
              yield 'allowed first chunk';
              if (kind === 'session') sessionActive = false;
              if (kind === 'grant') aiGranted = false;
              if (kind === 'role') roleActive = false;
              if (kind === 'store') sessionCheckFails = true;
              yield 'must not leave server';
            } finally {
              closed();
            }
          })(),
        };
      });
      const response = await request(app.getHttpServer())
        .post(`/api/v1/ai/conversations/${id}/messages`)
        .set('authorization', 'Bearer owner')
        .send({ clientRequestId, content: '雪场' })
        .expect(200);
      expect(response.text).toContain('allowed first chunk');
      expect(response.text).toContain('event: error');
      expect(response.text).not.toContain('must not leave server');
      expect(response.text).not.toContain('event: completed');
      expect(response.text).not.toContain('private session database error');
      expect(repository.completeMessage).not.toHaveBeenCalled();
      expect(repository.failMessage).toHaveBeenCalledWith(2n, 'attempt');
      expect(closed).toHaveBeenCalledOnce();
      expect(signal?.aborted).toBe(true);
    },
  );

  it.each(['session', 'grant'] as const)(
    'rejects %s revocation after beginMessage before sending SSE headers',
    async (kind) => {
      repository.beginMessage.mockImplementation(async () => {
        if (kind === 'session') sessionActive = false;
        else aiGranted = false;
        return {
          kind: 'started',
          conversationId: id,
          userMessageId: 1n,
          assistantMessageId: 2n,
          generationToken: 'attempt',
          previousQuestions: [],
        };
      });
      const response = await request(app.getHttpServer())
        .post(`/api/v1/ai/conversations/${id}/messages`)
        .set('authorization', 'Bearer owner')
        .send({ clientRequestId, content: '雪场' })
        .expect(kind === 'session' ? 401 : 403);
      expect(response.headers['content-type']).toContain('application/json');
      expect(prepare).not.toHaveBeenCalled();
      expect(repository.failMessage).toHaveBeenCalledWith(2n, 'attempt');
    },
  );

  it('rejects anonymous and ungranted accounts without any repository access', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/ai/conversations')
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/ai/conversations')
      .set('authorization', 'Bearer no-grant')
      .expect(403);
    expect(repository.list).not.toHaveBeenCalled();
  });

  it('creates with an empty body, paginates, reads and soft-deletes using the server owner', async () => {
    const base = '/api/v1/ai/conversations';
    const created = await request(app.getHttpServer())
      .post(base)
      .set('authorization', 'Bearer owner')
      .send({})
      .expect(201);
    expect(created.body).toMatchObject({
      code: 201,
      data: { conversationId: id },
    });
    expect(repository.create).toHaveBeenCalledWith(7);
    await request(app.getHttpServer())
      .get(`${base}?page=2&pageSize=5`)
      .set('authorization', 'Bearer owner')
      .expect(200);
    expect(repository.list).toHaveBeenCalledWith(7, 2, 5);
    await request(app.getHttpServer())
      .get(`${base}/${id}`)
      .set('authorization', 'Bearer owner')
      .expect(200);
    expect(repository.findDetail).toHaveBeenCalledWith(7, id);
    await request(app.getHttpServer())
      .delete(`${base}/${id}`)
      .set('authorization', 'Bearer owner')
      .expect(204);
    expect(repository.softDelete).toHaveBeenCalledWith(7, id);
  });

  it('validates pagination, UUIDs, length, whitespace and rejects forged ownership fields', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/ai/conversations?pageSize=101')
      .set('authorization', 'Bearer owner')
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/ai/conversations')
      .set('authorization', 'Bearer owner')
      .send({ userId: 8 })
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/v1/ai/conversations/not-a-uuid')
      .set('authorization', 'Bearer owner')
      .expect(400);
    for (const body of [
      { clientRequestId: 'invalid', content: '雪场' },
      { clientRequestId, content: '😀'.repeat(4001) },
      { clientRequestId, content: '  ' },
      { clientRequestId, content: '雪场', userId: 8 },
    ]) {
      await request(app.getHttpServer())
        .post(`/api/v1/ai/conversations/${id}/messages`)
        .set('authorization', 'Bearer owner')
        .send(body)
        .expect(400);
    }
    expect(repository.beginMessage).not.toHaveBeenCalled();
  });

  it('returns indistinguishable 404s for missing/foreign/deleted conversations', async () => {
    repository.findDetail.mockResolvedValue(null);
    await request(app.getHttpServer())
      .get(`/api/v1/ai/conversations/${id}`)
      .set('authorization', 'Bearer owner')
      .expect(404);
    repository.beginMessage.mockRejectedValue(
      new AiConversationNotFoundError(),
    );
    const response = await request(app.getHttpServer())
      .post(`/api/v1/ai/conversations/${id}/messages`)
      .set('authorization', 'Bearer owner')
      .send({ clientRequestId, content: '雪场' })
      .expect(404);
    expect(response.headers['content-type']).toContain('application/json');
    expect(prepare).not.toHaveBeenCalled();
  });

  it('writes raw SSE delta/completed events and passes the resolved principal', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/ai/conversations/${id}/messages`)
      .set('authorization', 'Bearer owner')
      .send({ clientRequestId, content: ' 雪场 ' })
      .expect(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.headers['cache-control']).toContain('no-cache');
    expect(response.text).toContain(
      'event: delta\ndata: {"text":"公开雪场资料"}\n\n',
    );
    expect(response.text).toContain('event: completed\ndata: {"messageId":"2"');
    expect(repository.beginMessage).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 7, content: '雪场', clientRequestId }),
    );
    expect(prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: expect.objectContaining({ userId: 7 }),
      }),
    );
    expect(repository.completeMessage).toHaveBeenCalledOnce();
  });

  it('returns 409/429 before writing SSE headers and redacts errors after streaming begins', async () => {
    for (const [error, status] of [
      [new AiMessageInProgressError(), 409],
      [new AiMessageRateLimitError(), 429],
    ] as const) {
      repository.beginMessage.mockRejectedValueOnce(error);
      const response = await request(app.getHttpServer())
        .post(`/api/v1/ai/conversations/${id}/messages`)
        .set('authorization', 'Bearer owner')
        .send({ clientRequestId, content: '雪场' })
        .expect(status);
      expect(response.headers['content-type']).toContain('application/json');
    }
    prepare.mockResolvedValue({
      citations: [],
      assertEvidenceCurrent: async () => undefined,
      stream: (async function* () {
        yield 'partial';
        throw new Error('provider-secret');
      })(),
    });
    const response = await request(app.getHttpServer())
      .post(`/api/v1/ai/conversations/${id}/messages`)
      .set('authorization', 'Bearer owner')
      .send({ clientRequestId, content: '雪场' })
      .expect(200);
    expect(response.text).toContain('event: error');
    expect(response.text).not.toContain('provider-secret');
    expect(response.text).not.toContain('event: completed');
    expect(repository.completeMessage).not.toHaveBeenCalled();
    expect(repository.failMessage).toHaveBeenCalledWith(2n, 'attempt');
  });

  it('exports pagination/DTO/citation schema and the SSE media type', () => {
    const spec = createOpenApiDocument(app);
    expect(
      spec.paths[`/api/v1/ai/conversations/{conversationId}/messages`]?.post
        ?.responses['200'],
    ).toMatchObject({
      content: { 'text/event-stream': { schema: { type: 'string' } } },
    });
    expect(spec.components?.schemas?.SendAiMessageDto).toMatchObject({
      required: ['clientRequestId', 'content'],
      properties: { content: { maxLength: 4000 } },
    });
    expect(spec.components?.schemas?.AiCitationVO).toHaveProperty(
      'properties.sourceType',
    );
    expect(spec.components?.schemas?.AiStreamEventVO).toHaveProperty(
      'properties.data.oneOf',
    );
  });

  it('logs one typed upstream failure before headers with the HTTP trace and no prompt/body/credential', async () => {
    prepare.mockRejectedValue(
      new UpstreamHttpError(429, 'private upstream body, Bearer secret'),
    );
    const response = await request(app.getHttpServer())
      .post(`/api/v1/ai/conversations/${id}/messages?private=secret-query`)
      .set('authorization', 'Bearer owner')
      .set('x-trace-id', 'caller-secret-trace')
      .send({ clientRequestId, content: 'private prompt' })
      .expect(500);
    const traceId = response.headers['x-trace-id'];
    expect(traceId).toMatch(/^[a-f0-9-]{36}$/u);
    expect(response.body).toEqual({
      code: 500,
      msg: 'Internal server error',
      data: null,
      traceId,
    });
    expect(errorLogs).toEqual([
      {
        event: 'http_request_failed',
        traceId,
        status: 500,
        failure: { kind: 'upstream_http', upstreamStatus: 429, code: null },
      },
    ]);
    expect(JSON.stringify(errorLogs)).not.toMatch(
      /private|secret|Bearer|owner/u,
    );
    expect(prepare).toHaveBeenCalledOnce();
    expect(repository.failMessage).toHaveBeenCalledOnce();
    expect(repository.completeMessage).not.toHaveBeenCalled();
  });

  it('logs post-header network failure under the same trace and keeps the existing SSE error protocol', async () => {
    prepare.mockResolvedValue({
      citations: [],
      assertEvidenceCurrent: async () => undefined,
      stream: (async function* () {
        yield 'partial';
        throw new TypeError('secret upstream URL', {
          cause: Object.assign(new Error('secret socket'), {
            code: 'ECONNRESET',
          }),
        });
      })(),
    });
    const response = await request(app.getHttpServer())
      .post(`/api/v1/ai/conversations/${id}/messages`)
      .set('authorization', 'Bearer owner')
      .send({ clientRequestId, content: 'private prompt' })
      .expect(200);
    const traceId = response.headers['x-trace-id'];
    expect(response.text).toContain('event: delta');
    expect(response.text).toContain(
      `event: error\ndata: ${JSON.stringify({ code: 'AI_GENERATION_FAILED', msg: 'AI 回答生成失败', traceId })}`,
    );
    expect(response.text).not.toContain('event: completed');
    expect(errorLogs).toEqual([
      {
        event: 'ai_message_stream_failed',
        traceId,
        failure: { kind: 'network', upstreamStatus: null, code: 'ECONNRESET' },
      },
    ]);
    expect(JSON.stringify(errorLogs)).not.toMatch(/secret|private|Bearer/u);
    expect(repository.completeMessage).not.toHaveBeenCalled();
    expect(repository.failMessage).toHaveBeenCalledOnce();
  });

  it.each(['upstream-503', 'body-timeout'] as const)(
    'correlates actual provider HTTP %s through Nest without retry or persisting a partial answer',
    async (scenario) => {
      let calls = 0;
      const upstream = createServer((req, res) => {
        calls++;
        req.resume();
        if (scenario === 'upstream-503') {
          res.writeHead(503);
          res.write('private upstream body');
        } else {
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          res.write('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n');
        }
      });
      await new Promise<void>((resolve, reject) => {
        upstream.once('error', reject);
        upstream.listen(0, '127.0.0.1', resolve);
      });
      const address = upstream.address();
      if (!address || typeof address === 'string')
        throw new Error('Missing loopback test port');
      const provider = new OpenAiCompatibleChatModelProvider(
        new ConfigService({
          CHAT_MODEL_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
          CHAT_MODEL_API_KEY: 'local-only-secret',
          CHAT_MODEL_TIMEOUT_MS: '500',
        }),
      );
      prepare.mockImplementation(async () => ({
        citations: [],
        assertEvidenceCurrent: async () => undefined,
        stream: provider.stream({
          messages: [{ role: 'user', content: 'synthetic diagnostic request' }],
        }),
      }));
      try {
        const response = await request(app.getHttpServer())
          .post(`/api/v1/ai/conversations/${id}/messages`)
          .set('authorization', 'Bearer owner')
          .send({ clientRequestId, content: 'synthetic diagnostic request' })
          .expect(scenario === 'upstream-503' ? 500 : 200);
        const traceId = response.headers['x-trace-id'];
        expect(errorLogs).toEqual([
          scenario === 'upstream-503'
            ? {
                event: 'http_request_failed',
                traceId,
                status: 500,
                failure: {
                  kind: 'upstream_http',
                  upstreamStatus: 503,
                  code: null,
                },
              }
            : {
                event: 'ai_message_stream_failed',
                traceId,
                failure: { kind: 'timeout', upstreamStatus: null, code: null },
              },
        ]);
        expect(JSON.stringify(errorLogs)).not.toMatch(
          /private|secret|synthetic|Bearer|127\.0\.0\.1/u,
        );
        if (scenario === 'body-timeout') {
          expect(response.text).toContain('partial');
          expect(response.text).toContain('event: error');
          expect(response.text).not.toContain('event: completed');
        }
        expect(calls).toBe(1);
        expect(repository.failMessage).toHaveBeenCalledOnce();
        expect(repository.completeMessage).not.toHaveBeenCalled();
      } finally {
        upstream.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          upstream.close((error) => (error ? reject(error) : resolve())),
        );
      }
    },
  );
});
