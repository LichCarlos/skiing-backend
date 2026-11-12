import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';
import { PrismaInboxExecutor } from './prisma-inbox.executor.js';

function createExecutor(insertedCount: number) {
  const transaction = {
    consumedEvent: {
      createMany: vi.fn().mockResolvedValue({ count: insertedCount }),
    },
  };
  const transactionRunner = vi.fn(
    (work: (tx: typeof transaction) => Promise<unknown>) => work(transaction),
  );
  const prisma = {
    $transaction: transactionRunner,
  } as unknown as PrismaService;
  return {
    executor: new PrismaInboxExecutor(prisma),
    transactionRunner,
    transaction,
  };
}

describe('PrismaInboxExecutor', () => {
  const identity = {
    consumerKey: 'rag-indexer.v1',
    eventId: 'c9a5b5d0-6ba3-4fe0-8f4e-7d8478b2bacc',
    eventType: 'knowledge.published.v1',
  };

  it('records the event and runs its effect inside the same transaction', async () => {
    const { executor, transactionRunner, transaction } = createExecutor(1);
    const effect = vi.fn().mockResolvedValue(undefined);

    await expect(executor.executeOnce(identity, effect)).resolves.toBe(true);
    expect(transactionRunner).toHaveBeenCalledOnce();
    expect(transaction.consumedEvent.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ConsumerKey: identity.consumerKey,
          EventId: identity.eventId,
          EventType: identity.eventType,
          Status: 'completed',
          ProcessedAt: expect.any(Date),
        }),
        skipDuplicates: true,
      }),
    );
    expect(effect).toHaveBeenCalledWith(transaction);
  });

  it('skips the effect when the unique inbox key already exists', async () => {
    const { executor } = createExecutor(0);
    const effect = vi.fn();

    await expect(executor.executeOnce(identity, effect)).resolves.toBe(false);
    expect(effect).not.toHaveBeenCalled();
  });

  it('propagates effect failure to the transaction boundary', async () => {
    const { executor } = createExecutor(1);
    const effect = vi.fn().mockRejectedValue(new Error('handler failed'));

    await expect(executor.executeOnce(identity, effect)).rejects.toThrow(
      'handler failed',
    );
  });

  it('claims a non-transactional effect with a lease and skips an active duplicate', async () => {
    const queryRaw = vi.fn().mockResolvedValue([]);
    const transaction = {
      consumedEvent: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      $queryRaw: queryRaw,
    };
    const prisma = {
      $transaction: vi.fn(
        (work: (tx: typeof transaction) => Promise<unknown>) =>
          work(transaction),
      ),
    } as unknown as PrismaService;
    const executor = new PrismaInboxExecutor(prisma);

    const claim = await executor.claim(identity);

    expect(claim?.lockToken).toEqual(expect.any(String));
    expect(transaction.consumedEvent.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          Status: 'processing',
          ProcessedAt: null,
          LockToken: expect.any(String),
        }),
        skipDuplicates: true,
      }),
    );

    transaction.consumedEvent.createMany.mockResolvedValueOnce({ count: 0 });
    await expect(executor.claim(identity)).resolves.toBeNull();
    expect(queryRaw).toHaveBeenCalledOnce();
  });
});
