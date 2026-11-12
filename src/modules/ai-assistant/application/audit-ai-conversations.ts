import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AI_CONVERSATION_AUDIT_REPOSITORY,
  type AiConversationAuditFilter,
  type AiConversationAuditRepository,
} from './ports/ai-conversation-audit.repository.js';

@Injectable()
export class AuditAiConversations {
  constructor(
    @Inject(AI_CONVERSATION_AUDIT_REPOSITORY)
    private readonly conversations: AiConversationAuditRepository,
  ) {}

  async list(actorUserId: number, filter: AiConversationAuditFilter) {
    const offset = (filter.page - 1) * filter.pageSize;
    if (
      !Number.isSafeInteger(filter.page) ||
      filter.page < 1 ||
      !Number.isInteger(filter.pageSize) ||
      filter.pageSize < 1 ||
      filter.pageSize > 100 ||
      !Number.isSafeInteger(offset) ||
      offset > 2_147_483_647
    )
      throw new BadRequestException('Invalid conversation pagination');
    for (const value of [filter.fromTime, filter.toTime]) {
      if (
        value !== undefined &&
        (!Number.isFinite(Date.parse(value)) ||
          !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value))
      )
        throw new BadRequestException(
          'ISO timestamp with timezone is required',
        );
    }
    if (
      filter.fromTime &&
      filter.toTime &&
      Date.parse(filter.fromTime) > Date.parse(filter.toTime)
    )
      throw new BadRequestException('fromTime must not be after toTime');
    return {
      ...(await this.conversations.list(actorUserId, filter)),
      page: filter.page,
      pageSize: filter.pageSize,
    };
  }

  async find(actorUserId: number, conversationId: string) {
    const record = await this.conversations.find(actorUserId, conversationId);
    if (!record) throw new NotFoundException('Conversation not found');
    return record;
  }

  readContent(
    actorUserId: number,
    conversationId: string,
    audit: { reason: string; traceId: string },
  ) {
    const reason = audit.reason.trim();
    if (!reason || Array.from(reason).length > 500)
      throw new BadRequestException('Reason must contain 1 to 500 characters');
    return this.conversations.readContent(actorUserId, conversationId, {
      ...audit,
      reason,
    });
  }
}
