export const OUTBOX_STATUSES = [
  'pending',
  'processing',
  'published',
  'failed',
] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

export interface OutboxMetadata {
  eventId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  status: OutboxStatus;
  attempts: number;
  maxAttempts: number;
  availableAt: Date;
  lockedAt: Date | null;
  occurredAt: Date;
  publishedAt: Date | null;
  createdAt: Date;
}

export class OutboxRetryConflictError extends Error {}
export class OutboxAdministratorRequiredError extends Error {}

export function nextRetryBudget(status: string, maxAttempts: number): number {
  if (
    status !== 'failed' ||
    !Number.isInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > 2_147_483_639
  )
    throw new OutboxRetryConflictError(
      'Only failed events with available retry budget may be retried',
    );
  return maxAttempts + 8;
}

// Explicit projection is also used after the persistence adapter returns.
export function outboxMetadataVO(row: OutboxMetadata) {
  return {
    eventId: row.eventId,
    eventType: row.eventType,
    aggregateType: row.aggregateType,
    aggregateId: row.aggregateId,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    availableAt: row.availableAt.toISOString(),
    lockedAt: row.lockedAt?.toISOString() ?? null,
    occurredAt: row.occurredAt.toISOString(),
    publishedAt: row.publishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
