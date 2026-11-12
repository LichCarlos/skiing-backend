export const AI_CONVERSATION_REPOSITORY = Symbol('AI_CONVERSATION_REPOSITORY');

export interface AiConversationSummaryRecord {
  conversationId: string;
  title: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  messageCount: number;
}

export interface AiPersistedMessageRecord {
  messageId: string;
  senderRole: 'user' | 'assistant';
  content: string;
  citations: unknown;
  createdAt: Date;
}

export interface AiConversationDetailRecord extends AiConversationSummaryRecord {
  messages: AiPersistedMessageRecord[];
}

export type BeginAiMessageResult =
  | {
      kind: 'started';
      conversationId: string;
      userMessageId: bigint;
      assistantMessageId: bigint;
      generationToken: string;
      previousQuestions: string[];
    }
  | {
      kind: 'completed';
      message: AiPersistedMessageRecord;
    };

export interface AiConversationRepository {
  list(
    userId: number,
    page: number,
    pageSize: number,
  ): Promise<{ items: AiConversationSummaryRecord[]; total: number }>;
  create(userId: number): Promise<AiConversationSummaryRecord>;
  findDetail(
    userId: number,
    conversationId: string,
  ): Promise<AiConversationDetailRecord | null>;
  softDelete(userId: number, conversationId: string): Promise<boolean>;
  beginMessage(input: {
    userId: number;
    conversationId: string;
    clientRequestId: string;
    content: string;
    now: Date;
  }): Promise<BeginAiMessageResult>;
  completeMessage(input: {
    conversationId: string;
    assistantMessageId: bigint;
    generationToken: string;
    content: string;
    citations: unknown;
    modelName: string;
    completedAt: Date;
  }): Promise<AiPersistedMessageRecord>;
  failMessage(
    assistantMessageId: bigint,
    generationToken: string,
  ): Promise<void>;
}
