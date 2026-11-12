import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';
import { ResolveAuthorizationPrincipal } from '../../identity-access/application/resolve-authorization-principal.js';
import { PrismaAuthorizationPrincipalReader } from '../../identity-access/infrastructure/prisma-authorization-principal-reader.js';
import {
  mayEnterManagementPortal,
  resolveDataScope,
  type ResolvedDataScope,
} from '../../identity-access/domain/authorization.js';
import type {
  AiConversationAuditFilter,
  AiConversationAuditRepository,
  AiConversationAuditSummary,
} from '../application/ports/ai-conversation-audit.repository.js';

const LIST = 'system:ai-conversation:list';
const CONTENT = 'system:ai-conversation:read-content';
const METADATA_SELECT = {
  ConversationId: true,
  UserId: true,
  CreateTime: true,
  UpdateTime: true,
  DeletedAt: true,
  _count: { select: { Messages: true } },
} satisfies Prisma.AiConversationSelect;
type MetadataRow = Prisma.AiConversationGetPayload<{
  select: typeof METADATA_SELECT;
}>;

@Injectable()
export class PrismaAiConversationAuditRepository implements AiConversationAuditRepository {
  constructor(private readonly prisma: PrismaService) {}

  list(actorUserId: number, filter: AiConversationAuditFilter) {
    return this.prisma.$transaction(
      async (tx) => {
        const scopeWhere = await authorizedWhere(tx, actorUserId, false);
        const where: Prisma.AiConversationWhereInput = {
          AND: [
            scopeWhere,
            {
              ...(filter.userId !== undefined ? { UserId: filter.userId } : {}),
              ...(filter.status === 'active' ? { DeletedAt: null } : {}),
              ...(filter.status === 'deleted'
                ? { DeletedAt: { not: null } }
                : {}),
              ...(filter.fromTime || filter.toTime
                ? {
                    UpdateTime: {
                      ...(filter.fromTime
                        ? { gte: new Date(filter.fromTime) }
                        : {}),
                      ...(filter.toTime
                        ? { lte: new Date(filter.toTime) }
                        : {}),
                    },
                  }
                : {}),
            },
          ],
        };
        const [rows, total] = await Promise.all([
          tx.aiConversation.findMany({
            where,
            select: METADATA_SELECT,
            orderBy: [{ UpdateTime: 'desc' }, { ConversationId: 'desc' }],
            skip: (filter.page - 1) * filter.pageSize,
            take: filter.pageSize,
          }),
          tx.aiConversation.count({ where }),
        ]);
        return { items: rows.map(toMetadata), total };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  find(actorUserId: number, conversationId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const where = await authorizedWhere(tx, actorUserId, false);
        const row = await tx.aiConversation.findFirst({
          where: { AND: [where, { ConversationId: conversationId }] },
          select: METADATA_SELECT,
        });
        return row ? toMetadata(row) : null;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  readContent(
    actorUserId: number,
    conversationId: string,
    audit: { reason: string; traceId: string },
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        const where = await authorizedWhere(tx, actorUserId, true);
        const row = await tx.aiConversation.findFirst({
          where: { AND: [where, { ConversationId: conversationId }] },
          select: {
            UserId: true,
            Messages: {
              orderBy: [{ CreateTime: 'asc' }, { MessageId: 'asc' }],
              select: {
                MessageId: true,
                SenderRole: true,
                Content: true,
                GenerationStatus: true,
                CreateTime: true,
                Citations: true,
              },
            },
          },
        });
        if (!row || row.UserId === null)
          throw new NotFoundException('Conversation not found');
        const actor = await tx.user.findUnique({
          where: { UserId: actorUserId },
          select: { Account: true },
        });
        if (!actor) throw new ForbiddenException();
        // Commit the success audit before any message leaves this transaction.
        await tx.operationLog.create({
          data: {
            ActorUserId: actorUserId,
            ActorAccountSnapshot: actor.Account,
            ActionKey: 'ai:conversation:read-content',
            ResourceKey: 'ai:conversation',
            TargetType: 'AiConversation',
            TargetId: conversationId,
            Result: 'success',
            Reason: audit.reason,
            TraceId: audit.traceId,
            Metadata: { userId: row.UserId },
          },
        });
        return {
          messages: row.Messages.map((message) => ({
            messageId: message.MessageId.toString(),
            sender: message.SenderRole,
            content: message.Content,
            generationStatus: message.GenerationStatus,
            createdAt: message.CreateTime.toISOString(),
            citations: message.Citations,
          })),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}

async function authorizedWhere(
  tx: Prisma.TransactionClient,
  userId: number,
  includeContent: boolean,
): Promise<Prisma.AiConversationWhereInput> {
  const principal = await new ResolveAuthorizationPrincipal(
    new PrismaAuthorizationPrincipalReader(tx),
  ).execute(userId);
  if (!mayEnterManagementPortal(principal)) throw new ForbiddenException();
  const listScope = resolveDataScope(principal, LIST, 'user');
  const scopes = [listScope];
  if (includeContent) scopes.push(resolveDataScope(principal, CONTENT, 'user'));
  if (scopes.some((scope) => !scope || scope.kind === 'merchant'))
    throw new ForbiddenException('Conversation audit scope is unavailable');
  // Both grants must cover the owner. Neither grant can widen the other.
  return {
    UserId: { not: null },
    GuestSessionId: null,
    AND: scopes.map((scope) => scopeWhere(scope!)),
  };
}

function scopeWhere(scope: ResolvedDataScope): Prisma.AiConversationWhereInput {
  if (scope.kind === 'all') return {};
  if (scope.kind === 'self') return { UserId: scope.userId };
  if (scope.kind === 'selected') return { UserId: { in: [...scope.ids] } };
  throw new ForbiddenException(
    'Merchant scope is unavailable for conversations',
  );
}

function toMetadata(row: MetadataRow): AiConversationAuditSummary {
  if (row.UserId === null) throw new Error('Guest conversations are excluded');
  return {
    conversationId: row.ConversationId,
    userId: row.UserId,
    status: row.DeletedAt ? 'deleted' : 'active',
    createdAt: row.CreateTime.toISOString(),
    updatedAt: row.UpdateTime.toISOString(),
    deletedAt: row.DeletedAt?.toISOString() ?? null,
    messageCount: row._count.Messages,
  };
}
