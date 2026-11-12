import { LOGIN_ATTEMPT_STORE } from '../src/modules/identity-access/application/ports/login-attempt-store.js';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureHttp } from '../src/shared/http/configure-http.js';
import { AUTH_TOKEN_SERVICE } from '../src/modules/identity-access/application/ports/auth-token-service.js';
import { AUTH_SESSION_REPOSITORY } from '../src/modules/identity-access/application/ports/auth-session-repository.js';
import { AUTHORIZATION_PRINCIPAL_READER } from '../src/modules/identity-access/application/ports/authorization-principal-reader.js';
import {
  AI_CONVERSATION_REPOSITORY,
  type AiConversationRepository,
} from '../src/modules/ai-assistant/application/ports/ai-conversation.repository.js';
import {
  CHAT_MODEL_PROVIDER,
  type ChatModelProvider,
} from '../src/modules/ai-assistant/application/ports/chat-model-provider.js';
import { EMBEDDING_PROVIDER } from '../src/modules/ai-assistant/application/ports/embedding-provider.js';
import { RAG_CANDIDATE_RETRIEVER } from '../src/modules/ai-assistant/application/ports/rag-candidate-retriever.js';
import { RAG_EVIDENCE_VALIDATOR } from '../src/modules/ai-assistant/application/ports/rag-evidence-validator.js';

const conversationId = '11111111-1111-4111-8111-111111111111';
const clientRequestId = '22222222-2222-4222-8222-222222222222';
const source = {
  chunkId: '91',
  sourceKey: 'resort:7',
  sourceType: 'resort',
  sourceId: 7,
  title: 'Fixture ski resort',
  content: 'Public ski guidance',
  chunkIndex: 0,
  similarity: 1,
};
const saved = {
  messageId: '2',
  senderRole: 'assistant' as const,
  content: 'Allowed ski answer',
  citations: [],
  createdAt: new Date('2026-11-03T00:00:00Z'),
};

describe('RAG live evidence / actual Nest answer and conversation pipeline', () => {
  let app: INestApplication;
  const areCurrent = vi.fn(async () => true);
  const search = vi.fn(async () => [source]);
  const chat = vi.fn<ChatModelProvider['stream']>();
  const beginMessage = vi.fn<AiConversationRepository['beginMessage']>();
  const completeMessage = vi.fn(async () => saved);
  const failMessage = vi.fn(async () => undefined);
  let providerSignal: AbortSignal | undefined;
  const closed = vi.fn();
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LOGIN_ATTEMPT_STORE)
      .useValue({ consume: async () => ({ allowed: true }) })
      .overrideProvider(AUTH_TOKEN_SERVICE)
      .useValue({
        verifyAccessToken: (token: string) =>
          token === 'owner' ? { userId: 7, sessionId: 'fixture' } : null,
      })
      .overrideProvider(AUTH_SESSION_REPOSITORY)
      .useValue({ isActive: async () => true })
      .overrideProvider(AUTHORIZATION_PRINCIPAL_READER)
      .useValue({
        findByUserId: async () => ({
          userId: 7,
          status: 'active',
          merchant: null,
          roles: [
            {
              key: 'custom-user',
              status: 'active',
              dataScope: 'self',
              permissions: [{ key: 'ai:conversation:use', status: 'active' }],
            },
          ],
        }),
      })
      .overrideProvider(AI_CONVERSATION_REPOSITORY)
      .useValue({ beginMessage, completeMessage, failMessage })
      .overrideProvider(EMBEDDING_PROVIDER)
      .useValue({
        embed: async () => [
          Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0)),
        ],
      })
      .overrideProvider(RAG_CANDIDATE_RETRIEVER)
      .useValue({ search })
      .overrideProvider(RAG_EVIDENCE_VALIDATOR)
      .useValue({ areCurrent })
      .overrideProvider(CHAT_MODEL_PROVIDER)
      .useValue({ stream: chat })
      .compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.init();
  });
  afterAll(async () => app.close());
  beforeEach(() => {
    vi.resetAllMocks();
    providerSignal = undefined;
    areCurrent.mockResolvedValue(true);
    search.mockResolvedValue([source]);
    beginMessage.mockResolvedValue({
      kind: 'started',
      conversationId,
      userMessageId: 1n,
      assistantMessageId: 2n,
      generationToken: 'fixture',
      previousQuestions: [],
    });
    completeMessage.mockResolvedValue(saved);
    failMessage.mockResolvedValue(undefined);
    chat.mockImplementation(async function* (_input, signal) {
      providerSignal = signal;
      try {
        yield saved.content;
      } finally {
        closed();
      }
    });
  });
  const send = () =>
    request(app.getHttpServer())
      .post(`/api/v1/ai/conversations/${conversationId}/messages`)
      .auth('owner', { type: 'bearer' })
      .send({ clientRequestId, content: '滑雪场怎么选？' });

  it('returns delta and completed for evidence that remains current', async () => {
    const result = await send().expect(200);
    expect(result.text).toContain('event: delta');
    expect(result.text).toContain('event: completed');
    expect(areCurrent).toHaveBeenCalledWith(
      [expect.objectContaining({ chunkId: '91', content: source.content })],
      expect.any(String),
    );
    expect(completeMessage).toHaveBeenCalledOnce();
    expect(failMessage).not.toHaveBeenCalled();
  });
  it('returns 409 without contacting chat when evidence changed after retrieval', async () => {
    areCurrent.mockResolvedValue(false);
    const result = await send().expect(409);
    expect(result.headers['content-type']).toContain('application/json');
    expect(chat).not.toHaveBeenCalled();
    expect(completeMessage).not.toHaveBeenCalled();
    expect(failMessage).toHaveBeenCalledWith(2n, 'fixture');
  });
  it.each(['withdrawn', 'storage-error'] as const)(
    'stops the next chunk for %s evidence and closes the provider',
    async (kind) => {
      chat.mockImplementation(async function* (_input, signal) {
        providerSignal = signal;
        try {
          yield 'allowed first chunk';
          if (kind === 'withdrawn') areCurrent.mockResolvedValue(false);
          else
            areCurrent.mockRejectedValue(
              new Error('private evidence database error'),
            );
          yield 'must not reach client';
        } finally {
          closed();
        }
      });
      const result = await send().expect(200);
      expect(result.text).toContain('allowed first chunk');
      expect(result.text).toContain('event: error');
      expect(result.text).not.toContain('event: completed');
      expect(result.text).not.toContain('must not reach client');
      expect(result.text).not.toContain('private evidence database error');
      expect(completeMessage).not.toHaveBeenCalled();
      expect(failMessage).toHaveBeenCalledOnce();
      expect(closed).toHaveBeenCalledOnce();
      expect(providerSignal?.aborted).toBe(true);
    },
  );
  it('refuses completion if evidence changes after the last provider chunk', async () => {
    chat.mockImplementation(async function* () {
      yield 'allowed';
      areCurrent.mockResolvedValue(false);
    });
    const result = await send().expect(200);
    expect(result.text).toContain('event: error');
    expect(result.text).not.toContain('event: completed');
    expect(completeMessage).not.toHaveBeenCalled();
    expect(failMessage).toHaveBeenCalledOnce();
  });
  it('preserves already committed history but withholds completed when evidence changes during save', async () => {
    completeMessage.mockImplementation(async () => {
      areCurrent.mockResolvedValue(false);
      return saved;
    });
    const result = await send().expect(200);
    expect(result.text).toContain('event: error');
    expect(result.text).not.toContain('event: completed');
    expect(completeMessage).toHaveBeenCalledOnce();
    expect(failMessage).not.toHaveBeenCalled();
  });
  it('keeps deterministic no-evidence refusal independent of evidence validation storage', async () => {
    search.mockResolvedValue([]);
    areCurrent.mockRejectedValue(new Error('unavailable'));
    const result = await send().expect(200);
    expect(result.text).toContain('目前没有检索到');
    expect(result.text).toContain('event: completed');
    expect(areCurrent).not.toHaveBeenCalled();
    expect(chat).not.toHaveBeenCalled();
    expect(completeMessage).toHaveBeenCalledOnce();
  });
});
