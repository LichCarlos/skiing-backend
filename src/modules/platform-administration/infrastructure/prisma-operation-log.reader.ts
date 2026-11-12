import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';
import type { OperationLogReader } from '../application/ports/operation-log-reader.js';

@Injectable()
export class PrismaOperationLogReader implements OperationLogReader {
  constructor(private readonly prisma: PrismaService) {}

  async findPage(input: Parameters<OperationLogReader['findPage']>[0]) {
    const where: Prisma.OperationLogWhereInput = {
      ...(input.actorUserId !== undefined
        ? { ActorUserId: input.actorUserId }
        : {}),
      ...(input.actionKey ? { ActionKey: input.actionKey } : {}),
      ...(input.resourceKey ? { ResourceKey: input.resourceKey } : {}),
      ...(input.result ? { Result: input.result } : {}),
      ...(input.traceId ? { TraceId: input.traceId } : {}),
      ...(input.fromTime || input.toTime
        ? {
            CreateTime: {
              ...(input.fromTime ? { gte: input.fromTime } : {}),
              ...(input.toTime ? { lte: input.toTime } : {}),
            },
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction(
      [
        this.prisma.operationLog.findMany({
          where,
          skip: input.skip,
          take: input.take,
          orderBy: [{ CreateTime: 'desc' }, { OperationLogId: 'desc' }],
          select: {
            OperationLogId: true,
            ActorUserId: true,
            ActorAccountSnapshot: true,
            ActionKey: true,
            ResourceKey: true,
            TargetType: true,
            TargetId: true,
            Result: true,
            TraceId: true,
            CreateTime: true,
          },
        }),
        this.prisma.operationLog.count({ where }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return {
      items: rows.map((row) => ({
        operationLogId: row.OperationLogId.toString(),
        actorUserId: row.ActorUserId,
        actorAccountSnapshot: row.ActorAccountSnapshot,
        actionKey: row.ActionKey,
        resourceKey: row.ResourceKey,
        targetType: row.TargetType,
        targetId: row.TargetId,
        result: row.Result as 'success' | 'failure',
        traceId: row.TraceId,
        createdAt: row.CreateTime,
      })),
      total,
    };
  }
}
