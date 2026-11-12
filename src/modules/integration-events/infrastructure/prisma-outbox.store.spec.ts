import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';
import type { ClaimedOutboxEvent } from '../domain/integration-event.js';
import { PrismaOutboxStore } from './prisma-outbox.store.js';

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

describe('PrismaOutboxStore', () => {
  it('claims events using a transactional SKIP LOCKED lease query', async () => {
    const queryRaw = vi.fn().mockResolvedValue([
      {
        EventId: event.eventId,
        EventType: event.eventType,
        AggregateType: event.aggregateType,
        AggregateId: event.aggregateId,
        Payload: event.payload,
        OccurredAt: event.occurredAt,
        Attempts: event.attempts,
        MaxAttempts: event.maxAttempts,
        LockToken: event.lockToken,
      },
    ]);
    const transaction = { $queryRaw: queryRaw };
    const transactionRunner = vi.fn(
      (work: (tx: typeof transaction) => Promise<unknown>) => work(transaction),
    );
    const prisma = {
      $transaction: transactionRunner,
    } as unknown as PrismaService;
    const store = new PrismaOutboxStore(prisma);

    await expect(store.claimBatch(25, 60_000)).resolves.toEqual([event]);

    expect(transactionRunner).toHaveBeenCalledOnce();
    expect(queryRaw).toHaveBeenCalledOnce();
    const query = queryRaw.mock.calls[0]?.[0] as { sql: string };
    expect(query.sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(query.sql).toContain('"LockToken" = gen_random_uuid()');
  });

  it('rejects a stale lease when updating delivery state', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const prisma = {
      outboxEvent: { updateMany },
    } as unknown as PrismaService;
    const store = new PrismaOutboxStore(prisma);

    await expect(
      store.markPublished(event, new Date('2026-10-27T00:00:05.000Z')),
    ).resolves.toBe(false);
    await expect(
      store.scheduleRetry(
        event,
        new Date('2026-10-27T00:00:06.000Z'),
        'temporary failure',
      ),
    ).resolves.toBe(false);
    await expect(store.markFailed(event, 'permanent failure')).resolves.toBe(
      false,
    );

    expect(updateMany).toHaveBeenCalledTimes(3);
    for (const [argument] of updateMany.mock.calls) {
      expect(argument).toMatchObject({
        where: {
          EventId: event.eventId,
          Status: 'processing',
          LockToken: event.lockToken,
        },
      });
    }
  });
});
