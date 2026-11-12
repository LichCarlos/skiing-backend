import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RagAccessPrincipal } from '../domain/rag-access.js';
import {
  assertAiConversationPage,
  normalizeAiMessageContent,
} from '../domain/ai-message-rules.js';
import {
  AI_CONVERSATION_REPOSITORY,
  type AiConversationRepository,
  type AiPersistedMessageRecord,
} from './ports/ai-conversation.repository.js';
import { RagAnswerService } from './rag-answer.service.js';
import {
  AI_STREAM_AUTHORIZATION,
  type AiStreamAuthorization,
} from './ports/ai-stream-authorization.js';

export interface AiConversationMessageVO {
  messageId: string;
  role: 'user' | 'assistant';
  status: 'complete';
  content: string;
  citations: unknown;
  createdAt: string;
}

export interface AiConversationSummaryVO {
  conversationId: string;
  title: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface AiConversationDetailVO extends AiConversationSummaryVO {
  messages: AiConversationMessageVO[];
}

export type AiMessageStreamEvent =
  | { event: 'delta'; data: { text: string } }
  | { event: 'completed'; data: AiConversationMessageVO };

export class AiConversationNotFoundError extends Error {
  constructor() {
    super('Conversation not found');
    this.name = 'AiConversationNotFoundError';
  }
}

export class AiMessageRateLimitError extends Error {
  constructor() {
    super('AI message rate limit exceeded');
    this.name = 'AiMessageRateLimitError';
  }
}

export class AiMessageRequestConflictError extends Error {
  constructor() {
    super('Client request id was already used with different content');
    this.name = 'AiMessageRequestConflictError';
  }
}

export class AiMessageInProgressError extends Error {
  constructor() {
    super('This AI message request is already in progress');
    this.name = 'AiMessageInProgressError';
  }
}

@Injectable()
export class AiConversationService {
  private readonly logger = new Logger(AiConversationService.name);

  constructor(
    @Inject(AI_CONVERSATION_REPOSITORY)
    private readonly conversations: AiConversationRepository,
    private readonly answers: RagAnswerService,
    private readonly config: ConfigService,
    @Inject(AI_STREAM_AUTHORIZATION)
    private readonly authorization: AiStreamAuthorization,
  ) {}

  async list(userId: number, page: number, pageSize: number) {
    assertAiConversationPage(page, pageSize);
    const result = await this.conversations.list(userId, page, pageSize);
    return {
      ...result,
      page,
      pageSize,
      items: result.items.map(toSummaryVO),
    };
  }

  async create(userId: number): Promise<AiConversationSummaryVO> {
    return toSummaryVO(await this.conversations.create(userId));
  }

  async detail(
    userId: number,
    conversationId: string,
  ): Promise<AiConversationDetailVO> {
    const record = await this.conversations.findDetail(userId, conversationId);
    if (!record) throw new AiConversationNotFoundError();
    return {
      ...toSummaryVO(record),
      messages: record.messages.map(toMessageVO),
    };
  }

  async remove(userId: number, conversationId: string): Promise<void> {
    if (!(await this.conversations.softDelete(userId, conversationId))) {
      throw new AiConversationNotFoundError();
    }
  }

  async *sendMessage(input: {
    userId: number;
    sessionId: string;
    principal: RagAccessPrincipal;
    conversationId: string;
    clientRequestId: string;
    content: string;
    signal?: AbortSignal;
  }): AsyncGenerator<AiMessageStreamEvent> {
    if (!input.principal.active || input.principal.userId !== input.userId) {
      throw new AiConversationNotFoundError();
    }
    input.signal?.throwIfAborted();
    const content = normalizeAiMessageContent(input.content);
    await this.authorization.assert(input);
    input.signal?.throwIfAborted();
    const begun = await this.conversations.beginMessage({
      userId: input.userId,
      conversationId: input.conversationId,
      clientRequestId: input.clientRequestId,
      content,
      now: new Date(),
    });

    if (begun.kind === 'completed') {
      await this.authorization.assert(input);
      input.signal?.throwIfAborted();
      yield { event: 'completed', data: toMessageVO(begun.message) };
      return;
    }

    let fullAnswer = '';
    let persisted = false;
    const generation = new AbortController();
    const signal = AbortSignal.any([
      generation.signal,
      AbortSignal.timeout(240_000),
      ...(input.signal ? [input.signal] : []),
    ]);
    try {
      await this.authorization.assert(input);
      signal.throwIfAborted();
      const prepared = await this.answers.prepare({
        question: content,
        previousQuestions: begun.previousQuestions,
        principal: input.principal,
        signal,
      });
      for await (const text of prepared.stream) {
        signal.throwIfAborted();
        if (!text) continue;
        await this.authorization.assert(input);
        signal.throwIfAborted();
        fullAnswer += text;
        if (fullAnswer.length > 100_000)
          throw new Error('AI response exceeded output limit');
        yield { event: 'delta', data: { text } };
      }
      if (!fullAnswer.trim())
        throw new Error('AI model returned an empty answer');
      signal.throwIfAborted();

      await this.authorization.assert(input);
      signal.throwIfAborted();

      await prepared.assertEvidenceCurrent();
      signal.throwIfAborted();
      const completed = await this.conversations.completeMessage({
        conversationId: input.conversationId,
        assistantMessageId: begun.assistantMessageId,
        generationToken: begun.generationToken,
        content: fullAnswer,
        citations: prepared.citations,
        modelName:
          this.config.get<string>('CHAT_MODEL_NAME')?.trim() ||
          'deepseek-flash',
        completedAt: new Date(),
      });
      persisted = true;
      await this.authorization.assert(input);
      signal.throwIfAborted();
      await prepared.assertEvidenceCurrent();
      signal.throwIfAborted();
      yield { event: 'completed', data: toMessageVO(completed) };
    } finally {
      generation.abort();
      if (!persisted) {
        try {
          await this.conversations.failMessage(
            begun.assistantMessageId,
            begun.generationToken,
          );
        } catch {
          // A database outage must not replace the original error or break
          // generator cancellation. The fenced lease allows a later retry.
          this.logger.warn(
            'AI attempt cleanup failed; lease expiry permits retry',
          );
        }
      }
    }
  }
}

function toSummaryVO(record: {
  conversationId: string;
  title: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  messageCount: number;
}): AiConversationSummaryVO {
  return {
    conversationId: record.conversationId,
    title: record.title,
    status: record.status,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    messageCount: record.messageCount,
  };
}

function toMessageVO(
  record: AiPersistedMessageRecord,
): AiConversationMessageVO {
  return {
    messageId: record.messageId,
    role: record.senderRole,
    status: 'complete',
    content: record.content,
    citations: Array.isArray(record.citations) ? record.citations : [],
    createdAt: record.createdAt.toISOString(),
  };
}
