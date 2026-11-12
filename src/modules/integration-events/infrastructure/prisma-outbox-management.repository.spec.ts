import { PrismaOutboxManagementRepository } from './prisma-outbox-management.repository.js';
import type { PrismaService } from '../../../shared/persistence/prisma.service.js';

it('selects only metadata and uses the same filtered snapshot for event rows and count', async () => {
  const findMany = vi.fn().mockResolvedValue([]);
  const count = vi.fn().mockResolvedValue(0);
  const transaction = vi.fn(
    async (queries: Promise<unknown>[], _options: unknown) =>
      Promise.all(queries),
  );
  const repository = new PrismaOutboxManagementRepository({
    outboxEvent: { findMany, count },
    $transaction: transaction,
  } as unknown as PrismaService);
  const timestamp = new Date(0);
  await repository.findPage({
    skip: 20,
    take: 20,
    status: 'failed',
    aggregateType: 'resort',
    aggregateId: '42',
    eventType: 'resort.changed',
    fromTime: timestamp,
    toTime: timestamp,
  });
  const options = findMany.mock.calls[0]![0];
  expect(count.mock.calls[0]![0]).toEqual({ where: options.where });
  expect(options.orderBy).toEqual([{ CreatedAt: 'desc' }, { EventId: 'desc' }]);
  expect(Object.keys(options.select).sort()).toEqual(
    [
      'EventId',
      'EventType',
      'AggregateType',
      'AggregateId',
      'Status',
      'Attempts',
      'MaxAttempts',
      'AvailableAt',
      'LockedAt',
      'OccurredAt',
      'PublishedAt',
      'CreatedAt',
    ].sort(),
  );
  expect(transaction.mock.calls[0]![1]).toEqual({
    isolationLevel: 'RepeatableRead',
  });
});
