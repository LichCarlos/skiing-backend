import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import {
  AiConversationNotFoundError,
  AiConversationService,
} from './ai-conversation.service.js';
import type { AiMessageStreamEvent } from './ai-conversation.service.js';
import type { AiConversationRepository } from './ports/ai-conversation.repository.js';
import type { RagAnswerService } from './rag-answer.service.js';
import { OpenAiCompatibleChatModelProvider } from '../infrastructure/openai-compatible-chat-model.provider.js';

const time = new Date('2026-10-29T00:00:00Z');
const summary = {
  conversationId: 'conversation',
  title: null,
  status: 'active',
  createdAt: time,
  updatedAt: time,
  messageCount: 0,
};
const message = {
  messageId: '2',
  senderRole: 'assistant' as const,
  content: '参考雪场信息',
  citations: [],
  createdAt: time,
};
const input = {
  userId: 7,
  sessionId: 'session',
  principal: { userId: 7, active: true, merchantId: null, roles: [] },
  conversationId: 'conversation',
  clientRequestId: 'request',
  content: ' 雪场怎么选？ ',
};

function fixture(
  configValues: Record<string, string> = { CHAT_MODEL_NAME: 'test-model' },
) {
  const repository = {
    list: vi.fn(async () => ({ items: [summary], total: 1 })),
    create: vi.fn(async () => summary),
    findDetail: vi.fn<AiConversationRepository['findDetail']>(async () => ({
      ...summary,
      messages: [message],
    })),
    softDelete: vi.fn(async () => true),
    beginMessage: vi.fn<AiConversationRepository['beginMessage']>(async () => ({
      kind: 'started',
      conversationId: 'conversation',
      userMessageId: 1n,
      assistantMessageId: 2n,
      generationToken: 'attempt',
      previousQuestions: ['北岭雪场适合初学者吗？'],
    })),
    completeMessage: vi.fn(async () => message),
    failMessage: vi.fn(async () => undefined),
  } satisfies AiConversationRepository;
  const prepare = vi.fn<RagAnswerService['prepare']>(async () => ({
    citations: [],
    assertEvidenceCurrent: async () => undefined,
    stream: chunks(),
  }));
  const authorization = { assert: vi.fn(async () => undefined) };
  const service = new AiConversationService(
    repository,
    { prepare } as unknown as RagAnswerService,
    new ConfigService(configValues),
    authorization,
  );
  return { repository, prepare, service, authorization };
}

async function* chunks() {
  yield '参考';
  yield '雪场信息';
}
async function collect(stream: AsyncIterable<AiMessageStreamEvent>) {
  const events: AiMessageStreamEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe('AiConversationService', () => {
  it('persists the same verified Flash fallback used by the provider', async () => {
    const { service, repository } = fixture({});
    await collect(service.sendMessage(input));
    expect(repository.completeMessage).toHaveBeenCalledWith(
      expect.objectContaining({ modelName: 'deepseek-flash' }),
    );
  });

  it('checks evidence after authorization before saving the full answer', async () => {
    const { service, repository, prepare, authorization } = fixture();
    const assertEvidenceCurrent = vi.fn(async () => undefined);
    prepare.mockResolvedValue({
      citations: [],
      stream: chunks(),
      assertEvidenceCurrent,
    });
    const stream = service.sendMessage(input);
    await stream.next();
    await stream.next();
    authorization.assert.mockImplementation(async () => {
      assertEvidenceCurrent.mockRejectedValue(new Error('evidence changed'));
    });
    await expect(stream.next()).rejects.toThrow('evidence changed');
    expect(repository.completeMessage).not.toHaveBeenCalled();
    expect(repository.failMessage).toHaveBeenCalledOnce();
  });

  it('withholds completed but preserves a saved answer if evidence changes during persistence', async () => {
    const { service, repository, prepare } = fixture();
    const assertEvidenceCurrent = vi.fn(async () => undefined);
    prepare.mockResolvedValue({
      citations: [],
      stream: chunks(),
      assertEvidenceCurrent,
    });
    repository.completeMessage.mockImplementation(async () => {
      assertEvidenceCurrent.mockRejectedValue(new Error('evidence changed'));
      return message;
    });
    const events: AiMessageStreamEvent[] = [];
    await expect(
      (async () => {
        for await (const event of service.sendMessage(input))
          events.push(event);
      })(),
    ).rejects.toThrow('evidence changed');
    expect(events.every((event) => event.event !== 'completed')).toBe(true);
    expect(repository.completeMessage).toHaveBeenCalledOnce();
    expect(repository.failMessage).not.toHaveBeenCalled();
  });
  it('rejects unavailable stream authorization before creating an attempt or calling providers', async () => {
    const { repository, service, authorization, prepare } = fixture();
    authorization.assert.mockRejectedValue(new Error('stream access revoked'));
    await expect(collect(service.sendMessage(input))).rejects.toThrow(
      'stream access revoked',
    );
    expect(repository.beginMessage).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
    expect(repository.failMessage).not.toHaveBeenCalled();
  });

  it('cancels the actual chat HTTP body when authorization rejects its next buffered chunk', async () => {
    const { service, authorization, repository, prepare } = fixture();
    const cancel = vi.fn();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            const encode = (content: string) =>
              `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
            controller.enqueue(
              new TextEncoder().encode(encode('allowed') + encode('blocked')),
            );
          },
          cancel,
        }),
      ),
    );
    let signal: AbortSignal | undefined;
    try {
      const provider = new OpenAiCompatibleChatModelProvider(
        new ConfigService({
          CHAT_MODEL_BASE_URL: 'http://localhost/v1',
          CHAT_MODEL_API_KEY: 'test-only',
        }),
      );
      prepare.mockImplementation(async (request) => {
        signal = request.signal;
        return {
          citations: [],
          assertEvidenceCurrent: async () => undefined,
          stream: provider.stream({ messages: [] }, signal),
        };
      });
      const stream = service.sendMessage(input);
      expect((await stream.next()).value).toMatchObject({
        event: 'delta',
        data: { text: 'allowed' },
      });
      authorization.assert.mockRejectedValue(
        new Error('stream access revoked'),
      );
      await expect(stream.next()).rejects.toThrow('stream access revoked');
      expect(cancel).toHaveBeenCalledOnce();
      expect(signal?.aborted).toBe(true);
      expect(repository.completeMessage).not.toHaveBeenCalled();
      expect(repository.failMessage).toHaveBeenCalledOnce();
    } finally {
      fetchMock.mockRestore();
    }
  });
  it('stops a revoked stream at the next chunk and closes its provider without persisting', async () => {
    const { repository, prepare, service, authorization } = fixture();
    const closed = vi.fn();
    prepare.mockResolvedValue({
      citations: [],
      assertEvidenceCurrent: async () => undefined,
      stream: (async function* () {
        try {
          yield 'allowed';
          authorization.assert.mockRejectedValue(
            new Error('stream access revoked'),
          );
          yield 'must not leave server';
        } finally {
          closed();
        }
      })(),
    });
    const stream = service.sendMessage(input);
    expect((await stream.next()).value).toMatchObject({
      event: 'delta',
      data: { text: 'allowed' },
    });
    await expect(stream.next()).rejects.toThrow('stream access revoked');
    expect(closed).toHaveBeenCalledOnce();
    expect(repository.completeMessage).not.toHaveBeenCalled();
    expect(repository.failMessage).toHaveBeenCalledWith(2n, 'attempt');
  });

  it('checks revocation after the final provider chunk before saving', async () => {
    const { repository, prepare, service, authorization } = fixture();
    prepare.mockResolvedValue({
      citations: [],
      assertEvidenceCurrent: async () => undefined,
      stream: (async function* () {
        yield 'allowed';
        authorization.assert.mockRejectedValue(
          new Error('stream access revoked'),
        );
      })(),
    });
    await expect(collect(service.sendMessage(input))).rejects.toThrow(
      'stream access revoked',
    );
    expect(repository.completeMessage).not.toHaveBeenCalled();
    expect(repository.failMessage).toHaveBeenCalledOnce();
  });

  it('does not disclose a replay after access is revoked during the request lookup', async () => {
    const { repository, service, authorization, prepare } = fixture();
    repository.beginMessage.mockImplementation(async () => {
      authorization.assert.mockRejectedValue(
        new Error('stream access revoked'),
      );
      return { kind: 'completed', message };
    });
    await expect(collect(service.sendMessage(input))).rejects.toThrow(
      'stream access revoked',
    );
    expect(prepare).not.toHaveBeenCalled();
    expect(repository.failMessage).not.toHaveBeenCalled();
  });

  it('withholds completed when revocation commits during answer persistence', async () => {
    const { repository, service, authorization } = fixture();
    repository.completeMessage.mockImplementation(async () => {
      authorization.assert.mockRejectedValue(
        new Error('stream access revoked'),
      );
      return message;
    });
    const events: AiMessageStreamEvent[] = [];
    await expect(
      (async () => {
        for await (const event of service.sendMessage(input))
          events.push(event);
      })(),
    ).rejects.toThrow('stream access revoked');
    expect(events.every((event) => event.event !== 'completed')).toBe(true);
    expect(repository.completeMessage).toHaveBeenCalledOnce();
    expect(repository.failMessage).not.toHaveBeenCalled();
  });
  it('does not persist a complete answer and cancels the actual adapter on application output limit', async () => {
    const { repository, prepare, service } = fixture();
    const cancel = vi.fn();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                `data: ${JSON.stringify({ choices: [{ delta: { content: 'x'.repeat(100001) } }] })}\n\n`,
              ),
            );
          },
          cancel,
        }),
      ),
    );
    try {
      const provider = new OpenAiCompatibleChatModelProvider(
        new ConfigService({
          CHAT_MODEL_BASE_URL: 'http://localhost/v1',
          CHAT_MODEL_API_KEY: 'test-only',
        }),
      );
      prepare.mockResolvedValue({
        citations: [],
        assertEvidenceCurrent: async () => undefined,
        stream: provider.stream({ messages: [] }),
      });
      await expect(collect(service.sendMessage(input))).rejects.toThrow(
        'output limit',
      );
      expect(repository.completeMessage).not.toHaveBeenCalled();
      expect(repository.failMessage).toHaveBeenCalledWith(2n, 'attempt');
      expect(cancel).toHaveBeenCalledOnce();
    } finally {
      fetchMock.mockRestore();
    }
  });
  it('rejects unsafe pagination before accessing persistence', async () => {
    const { service, repository } = fixture();
    await expect(service.list(7, 2147483647, 100)).rejects.toThrow(
      'pagination',
    );
    expect(repository.list).not.toHaveBeenCalled();
  });
  it('passes the owner to all CRUD queries and serializes dates without internal metadata', async () => {
    const { service, repository } = fixture();
    expect(await service.list(7, 2, 10)).toMatchObject({
      page: 2,
      pageSize: 10,
      total: 1,
      items: [{ createdAt: time.toISOString() }],
    });
    expect(repository.list).toHaveBeenCalledWith(7, 2, 10);
    await service.create(7);
    expect(repository.create).toHaveBeenCalledWith(7);
    expect(await service.detail(7, 'conversation')).toMatchObject({
      messages: [{ messageId: '2', createdAt: time.toISOString() }],
    });
    expect(repository.findDetail).toHaveBeenCalledWith(7, 'conversation');
    await service.remove(7, 'conversation');
    expect(repository.softDelete).toHaveBeenCalledWith(7, 'conversation');
  });

  it('rejects unknown or foreign conversations through the same not-found error', async () => {
    const { service, repository } = fixture();
    repository.findDetail.mockResolvedValue(null);
    repository.softDelete.mockResolvedValue(false);
    await expect(service.detail(7, 'foreign')).rejects.toBeInstanceOf(
      AiConversationNotFoundError,
    );
    await expect(service.remove(7, 'foreign')).rejects.toBeInstanceOf(
      AiConversationNotFoundError,
    );
  });

  it('saves the full response and citations before emitting completed', async () => {
    const { service, repository, prepare } = fixture();
    const events = await collect(service.sendMessage(input));
    expect(events.map((event) => event.event)).toEqual([
      'delta',
      'delta',
      'completed',
    ]);
    expect(repository.beginMessage).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 7, content: '雪场怎么选？' }),
    );
    expect(prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: input.principal,
        previousQuestions: ['北岭雪场适合初学者吗？'],
      }),
    );
    expect(repository.completeMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: '参考雪场信息',
        citations: [],
        generationToken: 'attempt',
        modelName: 'test-model',
      }),
    );
    expect(repository.failMessage).not.toHaveBeenCalled();
  });

  it('replays completed requests without calling the providers again', async () => {
    const { service, repository, prepare } = fixture();
    repository.beginMessage.mockResolvedValue({ kind: 'completed', message });
    expect(await collect(service.sendMessage(input))).toMatchObject([
      { event: 'completed', data: { messageId: '2' } },
    ]);
    expect(prepare).not.toHaveBeenCalled();
    expect(repository.completeMessage).not.toHaveBeenCalled();
  });

  it('does not save a partial provider response and marks the attempt failed', async () => {
    const { service, repository, prepare } = fixture();
    prepare.mockResolvedValue({
      citations: [],
      assertEvidenceCurrent: async () => undefined,
      stream: (async function* () {
        yield 'partial';
        throw new Error('provider secret');
      })(),
    });
    await expect(collect(service.sendMessage(input))).rejects.toThrow(
      'provider secret',
    );
    expect(repository.completeMessage).not.toHaveBeenCalled();
    expect(repository.failMessage).toHaveBeenCalledWith(2n, 'attempt');
  });

  it('preserves the generation error if failure cleanup also fails', async () => {
    const { service, repository, prepare } = fixture();
    prepare.mockRejectedValue(new Error('original failure'));
    repository.failMessage.mockRejectedValue(new Error('database offline'));
    await expect(collect(service.sendMessage(input))).rejects.toThrow(
      'original failure',
    );
    expect(repository.completeMessage).not.toHaveBeenCalled();
  });

  it('cleans up when the consumer closes the generator mid-stream', async () => {
    const { service, repository } = fixture();
    const stream = service.sendMessage(input);
    expect((await stream.next()).value).toMatchObject({ event: 'delta' });
    await stream.return(undefined);
    expect(repository.failMessage).toHaveBeenCalledWith(2n, 'attempt');
    expect(repository.completeMessage).not.toHaveBeenCalled();
  });

  it('checks cancellation before committing and rejects invalid inputs before any write', async () => {
    const { service, repository, prepare } = fixture();
    await expect(
      collect(service.sendMessage({ ...input, content: '  ' })),
    ).rejects.toThrow('required');
    await expect(
      collect(service.sendMessage({ ...input, content: '😀'.repeat(4001) })),
    ).rejects.toThrow('4000');
    await expect(
      collect(service.sendMessage({ ...input, userId: 8 })),
    ).rejects.toBeInstanceOf(AiConversationNotFoundError);
    expect(repository.beginMessage).not.toHaveBeenCalled();
    const abort = new AbortController();
    prepare.mockResolvedValue({
      citations: [],
      assertEvidenceCurrent: async () => undefined,
      stream: (async function* () {
        yield 'partial';
        abort.abort();
      })(),
    });
    await expect(
      collect(service.sendMessage({ ...input, signal: abort.signal })),
    ).rejects.toThrow();
    expect(repository.completeMessage).not.toHaveBeenCalled();
    expect(repository.failMessage).toHaveBeenCalledOnce();
  });
});
