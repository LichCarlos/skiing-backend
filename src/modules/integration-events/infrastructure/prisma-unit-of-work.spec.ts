import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';
import type { IntegrationEvent } from '../domain/integration-event.js';
import type { TransactionContext } from '../application/ports/outbox-store.js';
import { PrismaOutboxStore } from './prisma-outbox.store.js';
import { PrismaUnitOfWork } from './prisma-unit-of-work.js';

describe('PrismaUnitOfWork with PrismaOutboxStore', () => {
  it('writes the business change and outbox event through one transaction client', async () => {
    const event: IntegrationEvent = {
      eventId: 'c9a5b5d0-6ba3-4fe0-8f4e-7d8478b2bacc',
      eventType: 'resort.updated.v1',
      aggregateType: 'ski_resort',
      aggregateId: '42',
      occurredAt: new Date('2026-10-27T00:00:00.000Z'),
      payload: { resortId: 42 },
    };
    const outboxCreate = vi.fn().mockResolvedValue(undefined);
    const transaction = {
      outboxEvent: { create: outboxCreate },
    } as unknown as TransactionContext;
    const transactionRunner = vi.fn(
      (work: (tx: TransactionContext) => Promise<unknown>) => work(transaction),
    );
    const prisma = {
      $transaction: transactionRunner,
    } as unknown as PrismaService;
    const unitOfWork = new PrismaUnitOfWork(prisma);
    const outbox = new PrismaOutboxStore(prisma);
    const businessWrite = vi.fn(async (_tx: TransactionContext) => undefined);

    await expect(
      unitOfWork.execute(async (tx) => {
        await businessWrite(tx);
        await outbox.append(tx, event);
        return 'committed';
      }),
    ).resolves.toBe('committed');

    expect(transactionRunner).toHaveBeenCalledOnce();
    expect(businessWrite).toHaveBeenCalledWith(transaction);
    expect(outboxCreate).toHaveBeenCalledWith({
      data: {
        EventId: event.eventId,
        EventType: event.eventType,
        AggregateType: event.aggregateType,
        AggregateId: event.aggregateId,
        Payload: event.payload,
        OccurredAt: event.occurredAt,
      },
    });
  });
});
