import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  OPERATION_LOG_READER,
  type OperationLogReader,
} from './ports/operation-log-reader.js';
import type { OperationLogFilter } from '../domain/operation-log.js';

@Injectable()
export class ListOperationLogs {
  constructor(
    @Inject(OPERATION_LOG_READER) private readonly logs: OperationLogReader,
  ) {}

  async execute(input: OperationLogFilter) {
    const skip = (input.page - 1) * input.pageSize;
    if (
      !Number.isSafeInteger(input.page) ||
      input.page < 1 ||
      !Number.isInteger(input.pageSize) ||
      input.pageSize < 1 ||
      input.pageSize > 100 ||
      !Number.isSafeInteger(skip) ||
      skip > 2_147_483_647 ||
      (input.actorUserId !== undefined &&
        (!Number.isInteger(input.actorUserId) ||
          input.actorUserId < 1 ||
          input.actorUserId > 2_147_483_647))
    )
      throw new BadRequestException(
        'Invalid operation log pagination or actor',
      );
    const fromTime = parseTime(input.fromTime);
    const toTime = parseTime(input.toTime);
    if (fromTime && toTime && fromTime > toTime)
      throw new BadRequestException('fromTime must not be after toTime');
    const result = await this.logs.findPage({
      skip,
      take: input.pageSize,
      ...(input.actorUserId !== undefined
        ? { actorUserId: input.actorUserId }
        : {}),
      ...(input.actionKey ? { actionKey: input.actionKey } : {}),
      ...(input.resourceKey ? { resourceKey: input.resourceKey } : {}),
      ...(input.result ? { result: input.result } : {}),
      ...(input.traceId ? { traceId: input.traceId } : {}),
      ...(fromTime ? { fromTime } : {}),
      ...(toTime ? { toTime } : {}),
    });
    return {
      // Whitelist again at the application boundary, even if an adapter regresses.
      items: result.items.map((row) => ({
        operationLogId: row.operationLogId,
        actorUserId: row.actorUserId,
        actorAccountSnapshot: row.actorAccountSnapshot,
        actionKey: row.actionKey,
        resourceKey: row.resourceKey,
        targetType: row.targetType,
        targetId: row.targetId,
        result: row.result,
        traceId: row.traceId,
        createdAt: row.createdAt.toISOString(),
      })),
      total: result.total,
      page: input.page,
      pageSize: input.pageSize,
      hasNext: skip + result.items.length < result.total,
    };
  }
}

function parseTime(value: string | undefined): Date | undefined {
  if (value === undefined) return undefined;
  const date = new Date(value);
  if (
    !Number.isFinite(date.getTime()) ||
    !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
  )
    throw new BadRequestException(
      'A valid ISO timestamp with timezone is required',
    );
  return date;
}
