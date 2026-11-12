import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/shared/persistence/prisma.service.js';
import { PrismaAiConversationRepository } from '../src/modules/ai-assistant/infrastructure/prisma-ai-conversation.repository.js';
import {
  AiConversationNotFoundError,
  AiMessageInProgressError,
  AiMessageRateLimitError,
} from '../src/modules/ai-assistant/application/ai-conversation.service.js';

// Run only against an explicitly configured, migrated test database. Tests create
// isolated users and clean up only those users (and their cascading test data).
describe('AI PostgreSQL transactions', () => {
  const prisma = new PrismaService();
  const repository = new PrismaAiConversationRepository(prisma);
  const userIds: number[] = [];
  let userId: number;
  let otherUserId: number;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL)
      throw new Error(
        'DATABASE_URL must explicitly identify a migrated test database',
      );
    await prisma.$connect();
  });
  beforeEach(async () => {
    for (let index = 0; index < 2; index++) {
      const user = await prisma.user.create({
        data: {
          Account: `ai-test-${randomUUID()}`,
          PasswordHash: 'test-only-disabled',
          Nickname: 'DB test',
          Status: 'disabled',
        },
      });
      userIds.push(user.UserId);
    }
    userId = userIds[userIds.length - 2]!;
    otherUserId = userIds[userIds.length - 1]!;
  });
  afterAll(async () => {
    try {
      if (userIds.length)
        await prisma.user.deleteMany({ where: { UserId: { in: userIds } } });
    } finally {
      await prisma.$disconnect();
    }
  });

  it('enforces rolling per-user limits across connections and conversations', async () => {
    const conversations = await Promise.all(
      Array.from({ length: 6 }, () => repository.create(userId)),
    );
    const results = await Promise.allSettled(
      conversations.map((conversation) =>
        repository.beginMessage({
          userId,
          conversationId: conversation.conversationId,
          clientRequestId: randomUUID(),
          content: '并发请求',
          now: new Date(),
        }),
      ),
    );
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(5);
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({
      reason: expect.any(AiMessageRateLimitError),
    });
    expect(
      await prisma.aiMessage.count({
        where: { Conversation: { UserId: userId }, SenderRole: 'user' },
      }),
    ).toBe(5);
    const other = await repository.create(otherUserId);
    await expect(
      repository.beginMessage({
        userId: otherUserId,
        conversationId: other.conversationId,
        clientRequestId: randomUUID(),
        content: '独立计数',
        now: new Date(),
      }),
    ).resolves.toMatchObject({ kind: 'started' });
  });

  it('serializes the same key, replays completion, and preserves messages after soft-delete', async () => {
    const conversation = await repository.create(userId);
    const input = {
      userId,
      conversationId: conversation.conversationId,
      clientRequestId: randomUUID(),
      content: '雪场',
      now: new Date(),
    };
    const results = await Promise.allSettled([
      repository.beginMessage(input),
      repository.beginMessage(input),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.find((result) => result.status === 'rejected'),
    ).toMatchObject({ reason: expect.any(AiMessageInProgressError) });
    const winner = results.find((result) => result.status === 'fulfilled');
    if (winner?.status !== 'fulfilled' || winner.value.kind !== 'started')
      throw new Error('No generation acquired');
    const completed = await repository.completeMessage({
      ...winner.value,
      content: '完整回复',
      citations: [],
      modelName: 'test-model',
      completedAt: new Date(),
    });
    expect(await repository.beginMessage(input)).toMatchObject({
      kind: 'completed',
      message: { messageId: completed.messageId },
    });
    expect(
      await repository.findDetail(otherUserId, input.conversationId),
    ).toBeNull();
    expect(await repository.softDelete(otherUserId, input.conversationId)).toBe(
      false,
    );
    expect(await repository.softDelete(userId, input.conversationId)).toBe(
      true,
    );
    expect(await repository.softDelete(userId, input.conversationId)).toBe(
      true,
    );
    expect(
      await repository.findDetail(userId, input.conversationId),
    ).toBeNull();
    expect((await repository.list(userId, 1, 20)).total).toBe(0);
    expect(
      await prisma.aiMessage.count({
        where: { ConversationId: input.conversationId },
      }),
    ).toBe(2);
    await expect(repository.beginMessage(input)).rejects.toBeInstanceOf(
      AiConversationNotFoundError,
    );
  });

  it('uses only earlier completed questions from the same owned conversation, including on retry', async () => {
    const conversation = await repository.create(userId);
    const otherConversation = await repository.create(otherUserId);
    const oldTime = new Date(Date.now() - 3_600_000);
    const historical = async (
      conversationId: string,
      content: string,
      status: string,
      completedAt = oldTime,
    ) => {
      const question = await prisma.aiMessage.create({
        data: {
          ConversationId: conversationId,
          SenderRole: 'user',
          Content: content,
          CreateTime: oldTime,
        },
      });
      await prisma.aiMessage.create({
        data: {
          ConversationId: conversationId,
          ParentMessageId: question.MessageId,
          SenderRole: 'assistant',
          Content: '历史内部回复不进入新提示词',
          GenerationStatus: status,
          ...(status === 'streaming'
            ? {
                GenerationToken: randomUUID(),
                GenerationExpiresAt: new Date(Date.now() + 60_000),
              }
            : {}),
          CreateTime: completedAt,
        },
      });
    };
    for (let index = 0; index < 6; index++) {
      await historical(
        conversation.conversationId,
        `问题${index}`,
        'completed',
      );
    }
    await historical(
      otherConversation.conversationId,
      '其他用户问题',
      'completed',
    );
    await historical(conversation.conversationId, '失败问题', 'failed');
    await historical(conversation.conversationId, '生成中问题', 'streaming');
    const startedAt = new Date();
    await historical(
      conversation.conversationId,
      '晚完成的旧问题',
      'completed',
      new Date(startedAt.getTime() + 60_000),
    );
    const input = {
      userId,
      conversationId: conversation.conversationId,
      clientRequestId: randomUUID(),
      content: '追问',
      now: startedAt,
    };
    const first = await repository.beginMessage(input);
    if (first.kind !== 'started') throw new Error('No generation');
    expect(first.previousQuestions).toEqual([
      '问题2',
      '问题3',
      '问题4',
      '问题5',
    ]);
    await historical(conversation.conversationId, '后插入的问题', 'completed');
    await repository.failMessage(
      first.assistantMessageId,
      first.generationToken,
    );
    const retry = await repository.beginMessage({ ...input, now: new Date() });
    expect(retry).toMatchObject({
      kind: 'started',
      previousQuestions: first.previousQuestions,
    });
    await expect(
      repository.beginMessage({ ...input, userId: otherUserId }),
    ).rejects.toBeInstanceOf(AiConversationNotFoundError);
  });

  it('fences an expired attempt and prevents completion after deletion', async () => {
    const conversation = await repository.create(userId);
    const input = {
      userId,
      conversationId: conversation.conversationId,
      clientRequestId: randomUUID(),
      content: '雪场',
      now: new Date(),
    };
    const first = await repository.beginMessage(input);
    if (first.kind !== 'started') throw new Error('No first generation');
    await prisma.aiMessage.update({
      where: { MessageId: first.assistantMessageId },
      data: { GenerationExpiresAt: new Date(Date.now() - 1000) },
    });
    const second = await repository.beginMessage({ ...input, now: new Date() });
    if (second.kind !== 'started') throw new Error('No second generation');
    expect(second.generationToken).not.toBe(first.generationToken);
    await repository.failMessage(
      first.assistantMessageId,
      first.generationToken,
    );
    expect(
      await prisma.aiMessage.findUnique({
        where: { MessageId: first.assistantMessageId },
      }),
    ).toMatchObject({
      GenerationStatus: 'streaming',
      GenerationToken: second.generationToken,
    });
    await expect(
      repository.completeMessage({
        ...first,
        content: 'stale',
        citations: [],
        modelName: 'test',
        completedAt: new Date(),
      }),
    ).rejects.toBeInstanceOf(AiMessageInProgressError);
    await repository.softDelete(userId, input.conversationId);
    await expect(
      repository.completeMessage({
        ...second,
        content: 'late',
        citations: [],
        modelName: 'test',
        completedAt: new Date(),
      }),
    ).rejects.toBeInstanceOf(AiConversationNotFoundError);
    expect(
      await prisma.aiMessage.count({
        where: {
          ConversationId: input.conversationId,
          GenerationStatus: 'completed',
        },
      }),
    ).toBe(0);
  });
});
