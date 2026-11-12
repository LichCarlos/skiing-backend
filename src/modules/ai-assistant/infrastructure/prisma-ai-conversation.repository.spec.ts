import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../../shared/persistence/prisma.service.js';
import { PrismaAiConversationRepository } from './prisma-ai-conversation.repository.js';
import {
  AiConversationNotFoundError,
  AiMessageInProgressError,
  AiMessageRateLimitError,
  AiMessageRequestConflictError,
} from '../application/ai-conversation.service.js';

const now = new Date('2026-10-29T00:00:00Z');
const input = {
  userId: 7,
  conversationId: '11111111-1111-4111-8111-111111111111',
  clientRequestId: '22222222-2222-4222-8222-222222222222',
  content: '初学者建议',
  now,
};
const prompt = {
  ConversationId: input.conversationId,
  MessageId: 1n,
  SenderRole: 'user',
  Content: input.content,
  ClientRequestId: input.clientRequestId,
  CreateTime: now,
  Citations: null,
};
const assistant = {
  MessageId: 2n,
  SenderRole: 'assistant',
  Content: '完整回答',
  GenerationStatus: 'completed',
  GenerationToken: null,
  GenerationExpiresAt: null,
  CreateTime: now,
  Citations: [],
};
function fixture() {
  const tx = {
    $queryRaw: vi.fn(
      async (strings: TemplateStringsArray, ..._values: unknown[]) =>
        strings.join('').includes('COUNT(*)') ? [{ Count: 0n }] : [],
    ),
    aiConversation: {
      findFirst: vi.fn(async () => ({
        ConversationId: input.conversationId,
        DeletedAt: null as Date | null,
      })),
      update: vi.fn(async () => ({})),
    },
    aiMessage: {
      findMany: vi.fn(async (_query: unknown) => [{ Content: '北岭雪场' }]),
      findUnique: vi.fn(async (_query: unknown): Promise<unknown> => null),
      create: vi.fn(async (query: { data: { SenderRole: string } }) =>
        query.data.SenderRole === 'user' ? prompt : assistant,
      ),
      update: vi.fn(async () => assistant),
      updateMany: vi.fn(async () => ({ count: 1 })),
      findUniqueOrThrow: vi.fn(async () => assistant),
    },
  };
  const prisma = {
    ...tx,
    $transaction: vi.fn(async (work: (value: typeof tx) => unknown) =>
      work(tx),
    ),
  };
  const repository = new PrismaAiConversationRepository(
    prisma as unknown as PrismaService,
  );
  return { repository, prisma, tx };
}

describe('PrismaAiConversationRepository', () => {
  it('rejects an out-of-range skip before starting a database transaction', async () => {
    const { repository, prisma } = fixture();
    await expect(repository.list(7, 2147483647, 100)).rejects.toThrow(
      'pagination',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('scopes paginated lists and ordered history to the owner and hides generation placeholders', async () => {
    const findMany = vi.fn(async () => []);
    const count = vi.fn(async () => 0);
    const findFirst = vi.fn(async () => null);
    const prisma = {
      aiConversation: { findMany, count, findFirst },
      $transaction: vi.fn(async (queries: Promise<unknown>[]) =>
        Promise.all(queries),
      ),
    };
    const repository = new PrismaAiConversationRepository(
      prisma as unknown as PrismaService,
    );
    expect(await repository.list(7, 2, 5)).toEqual({ items: [], total: 0 });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { UserId: 7, DeletedAt: null },
        skip: 5,
        take: 5,
        orderBy: [{ UpdateTime: 'desc' }, { ConversationId: 'desc' }],
        include: {
          _count: {
            select: {
              Messages: {
                where: {
                  OR: [
                    { SenderRole: 'user' },
                    { SenderRole: 'assistant', GenerationStatus: 'completed' },
                  ],
                },
              },
            },
          },
        },
      }),
    );
    expect(count).toHaveBeenCalledWith({
      where: { UserId: 7, DeletedAt: null },
    });
    expect(await repository.findDetail(7, input.conversationId)).toBeNull();
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          ConversationId: input.conversationId,
          UserId: 7,
          DeletedAt: null,
        },
        include: {
          Messages: {
            where: {
              OR: [
                { SenderRole: 'user' },
                { SenderRole: 'assistant', GenerationStatus: 'completed' },
              ],
            },
            orderBy: [{ CreateTime: 'asc' }, { MessageId: 'asc' }],
          },
        },
      }),
    );
  });
  it('locks per user, checks ownership, then counts all conversations including soft-deleted ones', async () => {
    const { repository, tx } = fixture();
    const result = await repository.beginMessage(input);
    expect(result).toMatchObject({
      kind: 'started',
      userMessageId: 1n,
      assistantMessageId: 2n,
      generationToken: expect.any(String),
    });
    const calls = tx.$queryRaw.mock.calls;
    expect(calls[0]?.[0].join('')).toContain('pg_advisory_xact_lock');
    expect(calls[0]?.slice(1)).toEqual([7]);
    expect(calls[1]?.[0].join('')).toContain('FOR UPDATE');
    expect(calls[2]?.[0].join('')).not.toContain('DeletedAt');
    expect(tx.aiConversation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          ConversationId: input.conversationId,
          UserId: 7,
          DeletedAt: null,
        },
      }),
    );
    expect(tx.aiMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        SenderRole: 'assistant',
        Content: '',
        ParentMessageId: 1n,
        GenerationStatus: 'streaming',
        GenerationToken: expect.any(String),
        GenerationExpiresAt: new Date(now.getTime() + 300_000),
      }),
    });
  });

  it('rejects foreign/deleted conversations before looking up request or model data', async () => {
    const { repository, tx } = fixture();
    tx.aiConversation.findFirst.mockResolvedValue(null!);
    await expect(repository.beginMessage(input)).rejects.toBeInstanceOf(
      AiConversationNotFoundError,
    );
    expect(tx.aiMessage.findUnique).not.toHaveBeenCalled();
    expect(tx.aiMessage.create).not.toHaveBeenCalled();
    expect(tx.aiMessage.findMany).not.toHaveBeenCalled();
  });

  it('reads bounded prior completed user questions under the owner claim and original cutoff', async () => {
    const { repository, tx } = fixture();
    tx.aiMessage.findMany.mockResolvedValueOnce([
      { Content: '第二个问题' },
      { Content: '第一个问题' },
    ]);
    expect(await repository.beginMessage(input)).toMatchObject({
      previousQuestions: ['第一个问题', '第二个问题'],
    });
    const query = {
      where: {
        ConversationId: input.conversationId,
        Conversation: { UserId: 7, DeletedAt: null },
        SenderRole: 'user',
        MessageId: { lt: 1n },
        Replies: {
          some: {
            ConversationId: input.conversationId,
            SenderRole: 'assistant',
            GenerationStatus: 'completed',
            CreateTime: { lte: now },
          },
        },
      },
      orderBy: { MessageId: 'desc' },
      take: 4,
      select: { Content: true },
    };
    expect(tx.aiMessage.findMany).toHaveBeenCalledWith(query);
    tx.aiMessage.findUnique
      .mockResolvedValueOnce(prompt)
      .mockResolvedValueOnce({ ...assistant, GenerationStatus: 'failed' });
    await repository.beginMessage({
      ...input,
      now: new Date(now.getTime() + 60_000),
    });
    expect(tx.aiMessage.findMany).toHaveBeenLastCalledWith(query);
  });

  it('rejects the sixth new request with no writes', async () => {
    const { repository, tx } = fixture();
    tx.$queryRaw.mockImplementation(async (strings) =>
      strings.join('').includes('COUNT(*)') ? [{ Count: 5n }] : [],
    );
    await expect(repository.beginMessage(input)).rejects.toBeInstanceOf(
      AiMessageRateLimitError,
    );
    expect(tx.aiMessage.create).not.toHaveBeenCalled();
  });

  it('replays complete results even at rate limit and rejects changed payloads', async () => {
    const { repository, tx } = fixture();
    tx.aiMessage.findUnique
      .mockResolvedValueOnce(prompt)
      .mockResolvedValueOnce(assistant);
    expect(await repository.beginMessage(input)).toMatchObject({
      kind: 'completed',
      message: { messageId: '2', content: '完整回答' },
    });
    expect(tx.$queryRaw.mock.calls).toHaveLength(2);
    expect(tx.aiMessage.create).not.toHaveBeenCalled();
    expect(tx.aiMessage.findMany).not.toHaveBeenCalled();
    tx.aiMessage.findUnique.mockResolvedValueOnce({
      ...prompt,
      Content: 'different',
    });
    await expect(repository.beginMessage(input)).rejects.toBeInstanceOf(
      AiMessageRequestConflictError,
    );
  });

  it('rejects a live duplicate and reclaims failed or expired attempts with a new token', async () => {
    const { repository, tx } = fixture();
    tx.aiMessage.findUnique
      .mockResolvedValueOnce(prompt)
      .mockResolvedValueOnce({
        ...assistant,
        GenerationStatus: 'streaming',
        GenerationExpiresAt: new Date(now.getTime() + 1000),
      });
    await expect(repository.beginMessage(input)).rejects.toBeInstanceOf(
      AiMessageInProgressError,
    );
    for (const status of ['failed', 'streaming']) {
      tx.aiMessage.findUnique
        .mockResolvedValueOnce(prompt)
        .mockResolvedValueOnce({
          ...assistant,
          GenerationStatus: status,
          GenerationExpiresAt: new Date(now.getTime() - 1000),
        });
      expect(await repository.beginMessage(input)).toMatchObject({
        kind: 'started',
        generationToken: expect.any(String),
      });
    }
    expect(tx.aiMessage.create).not.toHaveBeenCalled();
  });

  it('fences completion and failure so an old generator cannot change a new attempt', async () => {
    const { repository, tx, prisma } = fixture();
    const complete = {
      conversationId: input.conversationId,
      assistantMessageId: 2n,
      generationToken: 'new-attempt',
      content: 'answer',
      citations: [],
      modelName: 'test-model',
      completedAt: now,
    };
    await repository.completeMessage(complete);
    expect(tx.aiMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          MessageId: 2n,
          ConversationId: input.conversationId,
          GenerationStatus: 'streaming',
          GenerationToken: 'new-attempt',
          GenerationExpiresAt: { gt: now },
        },
      }),
    );
    tx.aiMessage.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      repository.completeMessage({
        ...complete,
        generationToken: 'old-attempt',
      }),
    ).rejects.toBeInstanceOf(AiMessageInProgressError);
    await repository.failMessage(2n, 'old-attempt');
    expect(prisma.aiMessage.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          MessageId: 2n,
          GenerationStatus: 'streaming',
          GenerationToken: 'old-attempt',
        },
      }),
    );
  });

  it('serializes deletion with completion, keeps messages, and accepts repeated owner deletion', async () => {
    const { repository, tx } = fixture();
    expect(await repository.softDelete(7, input.conversationId)).toBe(true);
    expect(tx.$queryRaw.mock.calls[0]?.[0].join('')).toContain('FOR UPDATE');
    expect(tx.aiConversation.findFirst).toHaveBeenCalledWith({
      where: { ConversationId: input.conversationId, UserId: 7 },
    });
    expect(tx.aiConversation.update).toHaveBeenCalledWith({
      where: { ConversationId: input.conversationId },
      data: { DeletedAt: expect.any(Date) },
    });
    tx.aiConversation.update.mockClear();
    tx.aiConversation.findFirst.mockResolvedValue({
      ConversationId: input.conversationId,
      DeletedAt: now,
    });
    expect(await repository.softDelete(7, input.conversationId)).toBe(true);
    expect(tx.aiConversation.update).not.toHaveBeenCalled();
  });
});
