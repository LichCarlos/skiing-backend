import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  OUTBOX_MANAGEMENT_REPOSITORY,
  type OutboxManagementRepository,
  type OutboxRetryAudit,
} from './ports/outbox-management-repository.js';
import {
  OUTBOX_STATUSES,
  OutboxAdministratorRequiredError,
  OutboxRetryConflictError,
  outboxMetadataVO,
  type OutboxStatus,
} from '../domain/outbox-management.js';

export interface OutboxListInput {
  page: number;
  pageSize: number;
  status?: OutboxStatus;
  eventType?: string;
  aggregateType?: string;
  aggregateId?: string;
  fromTime?: string;
  toTime?: string;
}

@Injectable()
export class ManageOutboxEvents {
  constructor(
    @Inject(OUTBOX_MANAGEMENT_REPOSITORY)
    private readonly repository: OutboxManagementRepository,
  ) {}

  async list(input: OutboxListInput) {
    const skip = (input.page - 1) * input.pageSize;
    if (
      !Number.isSafeInteger(input.page) ||
      input.page < 1 ||
      !Number.isInteger(input.pageSize) ||
      input.pageSize < 1 ||
      input.pageSize > 100 ||
      !Number.isSafeInteger(skip) ||
      skip > 2_147_483_647 ||
      (input.status !== undefined && !OUTBOX_STATUSES.includes(input.status))
    )
      throw new BadRequestException('Invalid event pagination or status');
    for (const [key, max] of [
      ['eventType', 200],
      ['aggregateType', 100],
      ['aggregateId', 100],
    ] as const) {
      const value = input[key];
      if (
        value !== undefined &&
        (typeof value !== 'string' || value.length > max)
      )
        throw new BadRequestException('Invalid event filter');
    }
    const fromTime = parseTime(input.fromTime);
    const toTime = parseTime(input.toTime);
    if (fromTime && toTime && fromTime > toTime)
      throw new BadRequestException('fromTime must not be after toTime');
    const result = await this.repository.findPage({
      skip,
      take: input.pageSize,
      status: input.status,
      eventType: input.eventType,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      fromTime,
      toTime,
    });
    return {
      items: result.items.map(outboxMetadataVO),
      total: result.total,
      page: input.page,
      pageSize: input.pageSize,
      hasNext: skip + result.items.length < result.total,
    };
  }

  async retry(eventId: string, reason: string, audit: OutboxRetryAudit) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        eventId,
      ) ||
      typeof reason !== 'string' ||
      !reason.trim() ||
      Array.from(reason.trim()).length > 500
    )
      throw new BadRequestException(
        'A UUID and trimmed reason of 1–500 characters are required',
      );
    try {
      const result = await this.repository.retry(eventId, reason.trim(), audit);
      if (!result) throw new NotFoundException('Event not found');
      return outboxMetadataVO(result);
    } catch (error) {
      if (error instanceof OutboxRetryConflictError)
        throw new ConflictException(error.message);
      if (error instanceof OutboxAdministratorRequiredError)
        throw new ForbiddenException(
          'Active system_admin and event retry grants required',
        );
      throw error;
    }
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
