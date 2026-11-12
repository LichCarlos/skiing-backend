import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClaimedOutboxEvent } from '../domain/integration-event.js';
import {
  OutboxDeliveryService,
  retryDelayMilliseconds,
} from './outbox-delivery.service.js';
import type { OutboxStore } from './ports/outbox-store.js';

const event: ClaimedOutboxEvent = {
  eventId: 'c9a5b5d0-6ba3-4fe0-8f4e-7d8478b2bacc',
  eventType: 'resort.updated.v1',
  aggregateType: 'ski_resort',
  aggregateId: '42',
  occurredAt: new Date('2026-10-27T00:00:00.000Z'),
  payload: { resortId: 42 },
  attempts: 1,
  maxAttempts: 8,
  lockToken: 'd2d050db-62f6-427a-9342-8308a5732b1c',
};

function createStore() {
  return {
    append: vi.fn(),
    claimBatch: vi.fn().mockResolvedValue([event]),
    markPublished: vi.fn().mockResolvedValue(true),
    scheduleRetry: vi.fn().mockResolvedValue(true),
    markFailed: vi.fn().mockResolvedValue(true),
  } satisfies OutboxStore;
}

describe('OutboxDeliveryService', () => {
  afterEach(() => vi.useRealTimers());

  it('starts backoff after a slow broker failure rather than before the wait', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-02T00:00:00.000Z'));
    const store = createStore();
    const publisher = {
      publish: vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 15_000));
        throw new Error('broker unavailable');
      }),
    };
    const dispatch = new OutboxDeliveryService(
      store,
      publisher,
    ).dispatchBatch();
    await vi.advanceTimersByTimeAsync(15_000);
    await dispatch;
    expect(store.scheduleRetry).toHaveBeenCalledWith(
      event,
      new Date('2026-11-02T00:00:16.000Z'),
      'broker unavailable',
    );
  });

  it('records each broker acknowledgement at its completion time', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-02T00:00:00.000Z'));
    const store = createStore();
    const second = {
      ...event,
      eventId: '29fe572f-1199-4579-a14e-173a56f516b5',
    };
    store.claimBatch.mockResolvedValue([event, second]);
    const publisher = {
      publish: vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      }),
    };
    const dispatch = new OutboxDeliveryService(
      store,
      publisher,
    ).dispatchBatch();
    await vi.advanceTimersByTimeAsync(10_000);
    await dispatch;
    expect(store.markPublished).toHaveBeenNthCalledWith(
      1,
      event,
      new Date('2026-11-02T00:00:05.000Z'),
    );
    expect(store.markPublished).toHaveBeenNthCalledWith(
      2,
      second,
      new Date('2026-11-02T00:00:10.000Z'),
    );
  });

  it('publishes and marks the row only after the broker accepts the event', async () => {
    const store = createStore();
    const publisher = { publish: vi.fn().mockResolvedValue(undefined) };
    const publishedAt = new Date('2026-10-27T00:00:05.000Z');
    const service = new OutboxDeliveryService(
      store,
      publisher,
      () => publishedAt,
    );

    await expect(service.dispatchBatch()).resolves.toEqual({
      claimed: 1,
      published: 1,
      scheduled: 0,
      failed: 0,
    });
    expect(publisher.publish).toHaveBeenCalledWith(event);
    expect(store.markPublished).toHaveBeenCalledWith(event, publishedAt);
  });

  it('schedules a bounded exponential retry for a transient publish failure', async () => {
    const store = createStore();
    const publisher = {
      publish: vi.fn().mockRejectedValue(new Error('broker unavailable')),
    };
    const now = new Date('2026-10-27T00:00:05.000Z');
    const service = new OutboxDeliveryService(store, publisher, () => now);

    await expect(service.dispatchBatch()).resolves.toEqual({
      claimed: 1,
      published: 0,
      scheduled: 1,
      failed: 0,
    });
    expect(store.scheduleRetry).toHaveBeenCalledWith(
      event,
      new Date(now.getTime() + 1_000),
      'broker unavailable',
    );
    expect(store.markPublished).not.toHaveBeenCalled();
  });

  it('moves an event to failed after its persisted attempt limit', async () => {
    const store = createStore();
    store.claimBatch.mockResolvedValue([{ ...event, attempts: 8 }]);
    const publisher = {
      publish: vi.fn().mockRejectedValue(new Error('permanent failure')),
    };
    const service = new OutboxDeliveryService(store, publisher);

    await expect(service.dispatchBatch()).resolves.toEqual({
      claimed: 1,
      published: 0,
      scheduled: 0,
      failed: 1,
    });
    expect(store.markFailed).toHaveBeenCalledWith(
      { ...event, attempts: 8 },
      'permanent failure',
    );
    expect(store.scheduleRetry).not.toHaveBeenCalled();
  });

  it('does not exceed the attempt limit after a worker lease expires', async () => {
    const store = createStore();
    store.claimBatch.mockResolvedValue([{ ...event, attempts: 9 }]);
    const publisher = { publish: vi.fn() };
    const service = new OutboxDeliveryService(store, publisher);

    await expect(service.dispatchBatch()).resolves.toEqual({
      claimed: 1,
      published: 0,
      scheduled: 0,
      failed: 1,
    });
    expect(publisher.publish).not.toHaveBeenCalled();
    expect(store.markFailed).toHaveBeenCalledWith(
      { ...event, attempts: 9 },
      'Lease expired after the maximum delivery attempts',
    );
  });

  it('caps retry delay and handles the initial attempt', () => {
    expect(retryDelayMilliseconds(0)).toBe(1_000);
    expect(retryDelayMilliseconds(3)).toBe(4_000);
    expect(retryDelayMilliseconds(50)).toBe(300_000);
  });
});
