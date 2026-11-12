import { ManageOutboxEvents } from './manage-outbox-events.js';
import type { OutboxManagementRepository } from './ports/outbox-management-repository.js';
import {
  nextRetryBudget,
  OutboxAdministratorRequiredError,
  OutboxRetryConflictError,
} from '../domain/outbox-management.js';

describe('Outbox management boundaries', () => {
  const row = {
    eventId: '7a705486-7ee5-45c0-a3e6-afc0d6e29545',
    eventType: 'test',
    aggregateType: 'test',
    aggregateId: '1',
    status: 'failed' as const,
    attempts: 8,
    maxAttempts: 8,
    availableAt: new Date(0),
    lockedAt: null,
    occurredAt: new Date(0),
    publishedAt: null,
    createdAt: new Date(0),
    payload: 'secret',
    lastError: 'secret',
    lockToken: 'secret',
  };
  let repository: OutboxManagementRepository;
  let service: ManageOutboxEvents;
  beforeEach(() => {
    repository = {
      findPage: vi.fn().mockResolvedValue({ items: [row], total: 1 }),
      retry: vi.fn().mockResolvedValue(row),
    };
    service = new ManageOutboxEvents(repository);
  });
  it('projects the whitelist even when an adapter accidentally returns secrets', async () => {
    const page = await service.list({ page: 1, pageSize: 20 });
    expect(JSON.stringify(page)).not.toContain('secret');
    expect(
      JSON.stringify(
        await service.retry(row.eventId, ' reason ', {
          actorUserId: 1,
          traceId: 'test',
        }),
      ),
    ).not.toContain('secret');
    expect(vi.spyOn(repository, 'retry')).toHaveBeenCalledWith(
      row.eventId,
      'reason',
      {
        actorUserId: 1,
        traceId: 'test',
      },
    );
  });
  it.each([
    { page: 0, pageSize: 20 },
    { page: Number.MAX_SAFE_INTEGER, pageSize: 100 },
    { page: 1, pageSize: 101 },
    { page: 1, pageSize: 20, fromTime: 'invalid' },
    { page: 1, pageSize: 20, toTime: '2026-10-30T00:00:00' },
  ])('rejects invalid input %j before persistence', async (input) => {
    await expect(service.list(input)).rejects.toMatchObject({ status: 400 });
    expect(vi.spyOn(repository, 'findPage')).not.toHaveBeenCalled();
  });
  it('maps missing, conflict and revoked access without exposing internals', async () => {
    vi.spyOn(repository, 'retry')
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new OutboxRetryConflictError('changed'))
      .mockRejectedValueOnce(new OutboxAdministratorRequiredError());
    for (const status of [404, 409, 403])
      await expect(
        service.retry(row.eventId, 'test', { actorUserId: 1, traceId: 'test' }),
      ).rejects.toMatchObject({ status });
  });
  it('adds exactly eight without resetting existing attempts or overflowing int4', () => {
    expect(nextRetryBudget('failed', 8)).toBe(16);
    expect(nextRetryBudget('failed', 2147483639)).toBe(2147483647);
    for (const [status, budget] of [
      ['pending', 8],
      ['processing', 8],
      ['published', 8],
      ['failed', 2147483640],
    ] as const)
      expect(() => nextRetryBudget(status, budget)).toThrow(
        OutboxRetryConflictError,
      );
  });
});
