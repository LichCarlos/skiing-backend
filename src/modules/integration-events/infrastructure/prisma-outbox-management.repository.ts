import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';
import type {
  OutboxManagementRepository,
  OutboxRetryAudit,
} from '../application/ports/outbox-management-repository.js';
import {
  nextRetryBudget,
  OutboxAdministratorRequiredError,
  OutboxRetryConflictError,
  type OutboxStatus,
} from '../domain/outbox-management.js';

const metadataSelect = {
  EventId: true,
  EventType: true,
  AggregateType: true,
  AggregateId: true,
  Status: true,
  Attempts: true,
  MaxAttempts: true,
  AvailableAt: true,
  LockedAt: true,
  OccurredAt: true,
  PublishedAt: true,
  CreatedAt: true,
} satisfies Prisma.OutboxEventSelect;
type MetadataRow = Prisma.OutboxEventGetPayload<{
  select: typeof metadataSelect;
}>;

@Injectable()
export class PrismaOutboxManagementRepository implements OutboxManagementRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findPage(input: Parameters<OutboxManagementRepository['findPage']>[0]) {
    const where: Prisma.OutboxEventWhereInput = {
      ...(input.status !== undefined ? { Status: input.status } : {}),
      ...(input.eventType !== undefined ? { EventType: input.eventType } : {}),
      ...(input.aggregateType !== undefined
        ? { AggregateType: input.aggregateType }
        : {}),
      ...(input.aggregateId !== undefined
        ? { AggregateId: input.aggregateId }
        : {}),
      ...(input.fromTime || input.toTime
        ? {
            CreatedAt: {
              ...(input.fromTime ? { gte: input.fromTime } : {}),
              ...(input.toTime ? { lte: input.toTime } : {}),
            },
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction(
      [
        this.prisma.outboxEvent.findMany({
          where,
          skip: input.skip,
          take: input.take,
          orderBy: [{ CreatedAt: 'desc' }, { EventId: 'desc' }],
          select: metadataSelect,
        }),
        this.prisma.outboxEvent.count({ where }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return { items: rows.map(toMetadata), total };
  }

  async retry(eventId: string, reason: string, audit: OutboxRetryAudit) {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const actor = await tx.user.findUnique({
            where: { UserId: audit.actorUserId },
            select: {
              Account: true,
              Status: true,
              UserRoles: {
                where: { Role: { Status: 'active' } },
                select: {
                  Role: {
                    select: {
                      RoleKey: true,
                      SystemRoleCode: true,
                      RolePermissions: {
                        where: { Permission: { Status: 'active' } },
                        select: {
                          Permission: { select: { PermissionKey: true } },
                        },
                      },
                    },
                  },
                },
              },
            },
          });
          const roles = actor?.UserRoles.map(({ Role }) => Role) ?? [];
          const grants = new Set(
            roles.flatMap((role) =>
              role.RolePermissions.map(
                ({ Permission }) => Permission.PermissionKey,
              ),
            ),
          );
          if (
            !actor ||
            actor.Status !== 'active' ||
            roles.length !== 1 ||
            roles[0]?.RoleKey !== 'system_admin' ||
            roles[0]?.SystemRoleCode !== 'system_admin' ||
            !grants.has('management:portal:enter') ||
            !grants.has('system:event:retry')
          )
            throw new OutboxAdministratorRequiredError();
          const before = await tx.outboxEvent.findUnique({
            where: { EventId: eventId },
            select: metadataSelect,
          });
          if (!before) return null;
          const maxAttempts = nextRetryBudget(
            before.Status,
            before.MaxAttempts,
          );
          const result = await tx.outboxEvent.updateMany({
            where: {
              EventId: eventId,
              Status: 'failed',
              MaxAttempts: before.MaxAttempts,
            },
            data: {
              Status: 'pending',
              MaxAttempts: maxAttempts,
              AvailableAt: new Date(),
              LockedAt: null,
              LockToken: null,
            },
          });
          if (result.count !== 1)
            throw new OutboxRetryConflictError(
              'Event changed; reload before retrying',
            );
          const after = await tx.outboxEvent.findUniqueOrThrow({
            where: { EventId: eventId },
            select: metadataSelect,
          });
          await tx.operationLog.create({
            data: {
              ActorUserId: audit.actorUserId,
              ActorAccountSnapshot: actor.Account,
              ActionKey: 'system:event:retry',
              ResourceKey: 'outbox-event',
              TargetType: 'OutboxEvent',
              TargetId: eventId,
              Result: 'success',
              Reason: reason,
              TraceId: audit.traceId,
              ClientIp: audit.clientIp,
              UserAgent: audit.userAgent,
              Metadata: {
                before: {
                  status: before.Status,
                  attempts: before.Attempts,
                  maxAttempts: before.MaxAttempts,
                },
                after: {
                  status: after.Status,
                  attempts: after.Attempts,
                  maxAttempts: after.MaxAttempts,
                  availableAt: after.AvailableAt.toISOString(),
                },
              },
            },
          });
          return toMetadata(after);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034'
      )
        throw new OutboxRetryConflictError(
          'Concurrent event retry; reload before retrying',
        );
      throw error;
    }
  }
}

function toMetadata(row: MetadataRow) {
  return {
    eventId: row.EventId,
    eventType: row.EventType,
    aggregateType: row.AggregateType,
    aggregateId: row.AggregateId,
    status: row.Status as OutboxStatus,
    attempts: row.Attempts,
    maxAttempts: row.MaxAttempts,
    availableAt: row.AvailableAt,
    lockedAt: row.LockedAt,
    occurredAt: row.OccurredAt,
    publishedAt: row.PublishedAt,
    createdAt: row.CreatedAt,
  };
}
