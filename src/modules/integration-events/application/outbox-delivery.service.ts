import type { EventPublisher } from './ports/event-publisher.js';
import type { OutboxStore } from './ports/outbox-store.js';

const BATCH_SIZE = 50;
const LEASE_MILLISECONDS = 60_000;
const RETRY_BASE_MILLISECONDS = 1_000;
const RETRY_MAX_MILLISECONDS = 5 * 60_000;
const MAX_ERROR_LENGTH = 2_000;

export interface OutboxDispatchResult {
  claimed: number;
  published: number;
  scheduled: number;
  failed: number;
}

export class OutboxDeliveryService {
  constructor(
    private readonly store: OutboxStore,
    private readonly publisher: EventPublisher,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async dispatchBatch(): Promise<OutboxDispatchResult> {
    const events = await this.store.claimBatch(BATCH_SIZE, LEASE_MILLISECONDS);
    const result: OutboxDispatchResult = {
      claimed: events.length,
      published: 0,
      scheduled: 0,
      failed: 0,
    };

    for (const event of events) {
      if (event.attempts > event.maxAttempts) {
        const error = 'Lease expired after the maximum delivery attempts';
        if (await this.store.markFailed(event, error)) result.failed += 1;
        continue;
      }

      try {
        await this.publisher.publish(event);
        if (await this.store.markPublished(event, this.clock()))
          result.published += 1;
      } catch (error) {
        const message = toErrorMessage(error);
        if (event.attempts >= event.maxAttempts) {
          if (await this.store.markFailed(event, message)) result.failed += 1;
          continue;
        }

        const retryAt = new Date(
          this.clock().getTime() + retryDelayMilliseconds(event.attempts),
        );
        if (await this.store.scheduleRetry(event, retryAt, message)) {
          result.scheduled += 1;
        }
      }
    }

    return result;
  }
}

export function retryDelayMilliseconds(attempts: number): number {
  const exponent = Math.max(0, attempts - 1);
  return Math.min(
    RETRY_BASE_MILLISECONDS * 2 ** exponent,
    RETRY_MAX_MILLISECONDS,
  );
}

function toErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, MAX_ERROR_LENGTH);
}
