import type {
  OutboxMetadata,
  OutboxStatus,
} from '../../domain/outbox-management.js';

export const OUTBOX_MANAGEMENT_REPOSITORY = Symbol(
  'OUTBOX_MANAGEMENT_REPOSITORY',
);
export interface OutboxPageFilter {
  skip: number;
  take: number;
  status?: OutboxStatus;
  eventType?: string;
  aggregateType?: string;
  aggregateId?: string;
  fromTime?: Date;
  toTime?: Date;
}
export interface OutboxRetryAudit {
  actorUserId: number;
  traceId: string;
  clientIp?: string;
  userAgent?: string;
}
export interface OutboxManagementRepository {
  findPage(
    input: OutboxPageFilter,
  ): Promise<{ items: OutboxMetadata[]; total: number }>;
  retry(
    eventId: string,
    reason: string,
    audit: OutboxRetryAudit,
  ): Promise<OutboxMetadata | null>;
}
