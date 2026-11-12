export const AI_CONVERSATION_AUDIT_REPOSITORY = Symbol(
  'AI_CONVERSATION_AUDIT_REPOSITORY',
);

export interface AiConversationAuditFilter {
  page: number;
  pageSize: number;
  userId?: number;
  status?: 'active' | 'deleted';
  fromTime?: string;
  toTime?: string;
}

export interface AiConversationAuditSummary {
  conversationId: string;
  userId: number;
  status: 'active' | 'deleted';
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  messageCount: number;
}

export interface AiConversationAuditMessage {
  messageId: string;
  sender: string;
  content: string;
  generationStatus: string | null;
  createdAt: string;
  citations: unknown;
}

export interface AiConversationAuditRepository {
  list(
    actorUserId: number,
    filter: AiConversationAuditFilter,
  ): Promise<{
    items: AiConversationAuditSummary[];
    total: number;
  }>;
  find(
    actorUserId: number,
    conversationId: string,
  ): Promise<AiConversationAuditSummary | null>;
  readContent(
    actorUserId: number,
    conversationId: string,
    audit: {
      reason: string;
      traceId: string;
    },
  ): Promise<{ messages: AiConversationAuditMessage[] }>;
}
