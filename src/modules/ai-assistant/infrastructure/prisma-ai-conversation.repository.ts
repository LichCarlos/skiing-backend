import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma, type AiMessage } from '@prisma/client';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';
import {
  AI_MESSAGE_LIMIT_PER_USER,
  AI_MESSAGE_RATE_WINDOW_MS,
  assertAiConversationPage,
} from '../domain/ai-message-rules.js';
import { MAX_CONTEXT_QUESTIONS } from '../domain/conversation-context.js';
import {
  AiConversationNotFoundError,
  AiMessageInProgressError,
  AiMessageRateLimitError,
  AiMessageRequestConflictError,
} from '../application/ai-conversation.service.js';
import type {
  AiConversationDetailRecord,
  AiConversationRepository,
  AiConversationSummaryRecord,
  AiPersistedMessageRecord,
  BeginAiMessageResult,
} from '../application/ports/ai-conversation.repository.js';

@Injectable()
export class PrismaAiConversationRepository implements AiConversationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    userId: number,
    page: number,
    pageSize: number,
  ): Promise<{ items: AiConversationSummaryRecord[]; total: number }> {
    assertAiConversationPage(page, pageSize);
    const where = { UserId: userId, DeletedAt: null };
    const [items, total] = await this.prisma.$transaction(
      [
        this.prisma.aiConversation.findMany({
          where,
          orderBy: [{ UpdateTime: 'desc' }, { ConversationId: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: {
            _count: { select: { Messages: { where: visibleMessageWhere } } },
          },
        }),
        this.prisma.aiConversation.count({ where }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return {
      items: items.map((item) => ({
        conversationId: item.ConversationId,
        title: item.Title,
        status: item.Status,
        createdAt: item.CreateTime,
        updatedAt: item.UpdateTime,
        messageCount: item._count.Messages,
      })),
      total,
    };
  }

  async create(userId: number): Promise<AiConversationSummaryRecord> {
    const conversation = await this.prisma.aiConversation.create({
      data: { UserId: userId, Status: 'active' },
    });
    return {
      conversationId: conversation.ConversationId,
      title: conversation.Title,
      status: conversation.Status,
      createdAt: conversation.CreateTime,
      updatedAt: conversation.UpdateTime,
      messageCount: 0,
    };
  }

  async findDetail(
    userId: number,
    conversationId: string,
  ): Promise<AiConversationDetailRecord | null> {
    const conversation = await this.prisma.aiConversation.findFirst({
      where: {
        ConversationId: conversationId,
        UserId: userId,
        DeletedAt: null,
      },
      include: {
        Messages: {
          where: visibleMessageWhere,
          orderBy: [{ CreateTime: 'asc' }, { MessageId: 'asc' }],
        },
      },
    });
    if (!conversation) return null;
    return {
      conversationId: conversation.ConversationId,
      title: conversation.Title,
      status: conversation.Status,
      createdAt: conversation.CreateTime,
      updatedAt: conversation.UpdateTime,
      messageCount: conversation.Messages.length,
      messages: conversation.Messages.map(toMessageRecord),
    };
  }

  async softDelete(userId: number, conversationId: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      await lockConversation(tx, conversationId);
      const existing = await tx.aiConversation.findFirst({
        where: { ConversationId: conversationId, UserId: userId },
      });
      if (!existing) return false;
      if (existing.DeletedAt) return true;
      await tx.aiConversation.update({
        where: { ConversationId: conversationId },
        data: { DeletedAt: new Date() },
      });
      return true;
    });
  }

  beginMessage(input: {
    userId: number;
    conversationId: string;
    clientRequestId: string;
    content: string;
    now: Date;
  }): Promise<BeginAiMessageResult> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(1262769231, ${input.userId}::integer)::text`;
      await lockConversation(tx, input.conversationId);
      const conversation = await tx.aiConversation.findFirst({
        where: {
          ConversationId: input.conversationId,
          UserId: input.userId,
          DeletedAt: null,
        },
        select: { ConversationId: true },
      });
      if (!conversation) throw new AiConversationNotFoundError();

      const existingPrompt = await tx.aiMessage.findUnique({
        where: {
          ConversationId_ClientRequestId: {
            ConversationId: input.conversationId,
            ClientRequestId: input.clientRequestId,
          },
        },
      });
      if (existingPrompt) {
        if (existingPrompt.Content !== input.content) {
          throw new AiMessageRequestConflictError();
        }
        return this.resumeExistingRequest(
          tx,
          input.conversationId,
          existingPrompt,
          input.now,
          input.userId,
        );
      }

      const cutoff = new Date(input.now.getTime() - AI_MESSAGE_RATE_WINDOW_MS);
      const counts = await tx.$queryRaw<
        Array<{ Count: bigint }>
      >`SELECT COUNT(*)::bigint AS "Count"
        FROM "AiMessage" AS message
        INNER JOIN "AiConversation" AS conversation
          ON conversation."ConversationId" = message."ConversationId"
        WHERE conversation."UserId" = ${input.userId}
          AND message."SenderRole" = 'user'
          AND message."CreateTime" > ${cutoff}`;
      const recentMessages = counts[0]?.Count;
      if (recentMessages === undefined)
        throw new Error('AI message count unavailable');
      if (recentMessages >= BigInt(AI_MESSAGE_LIMIT_PER_USER)) {
        throw new AiMessageRateLimitError();
      }

      const prompt = await tx.aiMessage.create({
        data: {
          ConversationId: input.conversationId,
          SenderRole: 'user',
          Content: input.content,
          ClientRequestId: input.clientRequestId,
          CreateTime: input.now,
        },
      });
      const generationToken = randomUUID();
      const assistant = await tx.aiMessage.create({
        data: {
          ConversationId: input.conversationId,
          SenderRole: 'assistant',
          Content: '',
          ParentMessageId: prompt.MessageId,
          GenerationStatus: 'streaming',
          GenerationToken: generationToken,
          GenerationExpiresAt: new Date(
            input.now.getTime() + GENERATION_LEASE_MS,
          ),
        },
      });
      await tx.aiConversation.update({
        where: { ConversationId: input.conversationId },
        data: { UpdateTime: input.now },
      });
      return {
        kind: 'started',
        conversationId: input.conversationId,
        userMessageId: prompt.MessageId,
        assistantMessageId: assistant.MessageId,
        generationToken,
        previousQuestions: await previousQuestions(tx, input.userId, prompt),
      };
    });
  }

  async completeMessage(input: {
    conversationId: string;
    assistantMessageId: bigint;
    generationToken: string;
    content: string;
    citations: unknown;
    modelName: string;
    completedAt: Date;
  }): Promise<AiPersistedMessageRecord> {
    return this.prisma.$transaction(async (tx) => {
      await lockConversation(tx, input.conversationId);
      const conversation = await tx.aiConversation.findFirst({
        where: { ConversationId: input.conversationId, DeletedAt: null },
        select: { ConversationId: true },
      });
      if (!conversation) throw new AiConversationNotFoundError();
      const result = await tx.aiMessage.updateMany({
        where: {
          MessageId: input.assistantMessageId,
          ConversationId: input.conversationId,
          GenerationStatus: 'streaming',
          GenerationToken: input.generationToken,
          GenerationExpiresAt: { gt: input.completedAt },
        },
        data: {
          Content: input.content,
          Citations: input.citations as Prisma.InputJsonValue,
          ModelName: input.modelName,
          GenerationStatus: 'completed',
          GenerationToken: null,
          GenerationExpiresAt: null,
          CreateTime: input.completedAt,
        },
      });
      if (result.count !== 1) throw new AiMessageInProgressError();
      await tx.aiConversation.update({
        where: { ConversationId: input.conversationId },
        data: { UpdateTime: input.completedAt },
      });
      const message = await tx.aiMessage.findUniqueOrThrow({
        where: { MessageId: input.assistantMessageId },
      });
      return toMessageRecord(message);
    });
  }

  async failMessage(
    assistantMessageId: bigint,
    generationToken: string,
  ): Promise<void> {
    await this.prisma.aiMessage.updateMany({
      where: {
        MessageId: assistantMessageId,
        GenerationStatus: 'streaming',
        GenerationToken: generationToken,
      },
      data: {
        GenerationStatus: 'failed',
        Content: '',
        GenerationToken: null,
        GenerationExpiresAt: null,
      },
    });
  }

  private async resumeExistingRequest(
    tx: Prisma.TransactionClient,
    conversationId: string,
    prompt: AiMessage,
    now: Date,
    userId: number,
  ): Promise<BeginAiMessageResult> {
    const assistant = await tx.aiMessage.findUnique({
      where: { ParentMessageId: prompt.MessageId },
    });
    if (!assistant) throw new Error('AI request state is missing');
    if (assistant.GenerationStatus === 'completed') {
      return { kind: 'completed', message: toMessageRecord(assistant) };
    }
    if (
      assistant.GenerationStatus === 'streaming' &&
      assistant.GenerationExpiresAt &&
      assistant.GenerationExpiresAt > now
    ) {
      throw new AiMessageInProgressError();
    }
    const generationToken = randomUUID();
    const reset = await tx.aiMessage.update({
      where: { MessageId: assistant.MessageId },
      data: {
        Content: '',
        Citations: Prisma.DbNull,
        GenerationStatus: 'streaming',
        GenerationToken: generationToken,
        GenerationExpiresAt: new Date(now.getTime() + GENERATION_LEASE_MS),
      },
    });
    return {
      kind: 'started',
      conversationId,
      userMessageId: prompt.MessageId,
      assistantMessageId: reset.MessageId,
      generationToken,
      previousQuestions: await previousQuestions(tx, userId, prompt),
    };
  }
}

const GENERATION_LEASE_MS = 5 * 60_000;

async function previousQuestions(
  tx: Prisma.TransactionClient,
  userId: number,
  prompt: AiMessage,
): Promise<string[]> {
  const questions = await tx.aiMessage.findMany({
    where: {
      ConversationId: prompt.ConversationId,
      Conversation: { UserId: userId, DeletedAt: null },
      SenderRole: 'user',
      MessageId: { lt: prompt.MessageId },
      Replies: {
        some: {
          ConversationId: prompt.ConversationId,
          SenderRole: 'assistant',
          GenerationStatus: 'completed',
          CreateTime: { lte: prompt.CreateTime },
        },
      },
    },
    orderBy: { MessageId: 'desc' },
    take: MAX_CONTEXT_QUESTIONS,
    select: { Content: true },
  });
  return questions.reverse().map(({ Content }) => Content);
}
const visibleMessageWhere: Prisma.AiMessageWhereInput = {
  OR: [
    { SenderRole: 'user' },
    { SenderRole: 'assistant', GenerationStatus: 'completed' },
  ],
};

async function lockConversation(
  tx: Prisma.TransactionClient,
  conversationId: string,
) {
  await tx.$queryRaw`SELECT "ConversationId" FROM "AiConversation"
    WHERE "ConversationId" = ${conversationId}::uuid FOR UPDATE`;
}

function toMessageRecord(message: AiMessage): AiPersistedMessageRecord {
  return {
    messageId: message.MessageId.toString(),
    senderRole: message.SenderRole as 'user' | 'assistant',
    content: message.Content,
    citations: message.Citations,
    createdAt: message.CreateTime,
  };
}
