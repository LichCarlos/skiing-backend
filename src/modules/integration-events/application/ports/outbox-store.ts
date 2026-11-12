import type {
  ClaimedOutboxEvent,
  IntegrationEvent,
} from '../../domain/integration-event.js';

export const OUTBOX_STORE = Symbol('OUTBOX_STORE');

export interface OutboxStore {
  append(
    transaction: TransactionContext,
    event: IntegrationEvent,
  ): Promise<void>;
  claimBatch(
    limit: number,
    leaseMilliseconds: number,
  ): Promise<ClaimedOutboxEvent[]>;
  markPublished(event: ClaimedOutboxEvent, publishedAt: Date): Promise<boolean>;
  scheduleRetry(
    event: ClaimedOutboxEvent,
    availableAt: Date,
    error: string,
  ): Promise<boolean>;
  markFailed(event: ClaimedOutboxEvent, error: string): Promise<boolean>;
}

declare const transactionContextBrand: unique symbol;

export interface TransactionContext {
  readonly [transactionContextBrand]: true;
}
