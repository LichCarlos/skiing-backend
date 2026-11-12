import { ListOperationLogs } from './list-operation-logs.js';
import type { OperationLogReader } from './ports/operation-log-reader.js';
import { OperationLogsController } from '../presentation/http/operation-logs.controller.js';
import type { AuthorizationPrincipal } from '../../identity-access/domain/authorization.js';

describe('Operation log read boundary', () => {
  const row = {
    operationLogId: '9007199254740993',
    actorUserId: null,
    actorAccountSnapshot: 'removed-account',
    actionKey: 'test:read',
    resourceKey: 'test',
    targetType: 'test',
    targetId: 'target',
    result: 'success' as const,
    traceId: 'trace',
    createdAt: new Date('2026-10-29T00:00:00Z'),
    metadata: { password: 'must-not-return' },
    reason: 'must-not-return',
    clientIp: 'must-not-return',
    userAgent: 'must-not-return',
  };
  function setup() {
    const findPage = vi.fn().mockResolvedValue({ items: [row], total: 3 });
    return {
      findPage,
      service: new ListOperationLogs({ findPage } as OperationLogReader),
    };
  }
  it('projects a safe response even when an adapter supplies extra sensitive columns', async () => {
    const { service, findPage } = setup();
    const result = await service.execute({
      page: 2,
      pageSize: 1,
      fromTime: '2026-10-29T08:00:00+08:00',
      toTime: '2026-10-29T00:00:00Z',
      result: 'success',
    });
    expect(result).toMatchObject({
      total: 3,
      hasNext: true,
      page: 2,
      pageSize: 1,
    });
    expect(result.items[0]!.operationLogId).toBe(row.operationLogId);
    expect(JSON.stringify(result)).not.toContain('must-not-return');
    expect(findPage).toHaveBeenCalledWith({
      skip: 1,
      take: 1,
      result: 'success',
      fromTime: row.createdAt,
      toTime: row.createdAt,
    });
  });
  it.each([
    { page: 0, pageSize: 20 },
    { page: 1, pageSize: 101 },
    { page: Number.MAX_SAFE_INTEGER, pageSize: 100 },
    { page: 1, pageSize: 20, actorUserId: 2147483648 },
    { page: 1, pageSize: 20, fromTime: 'invalid' },
    { page: 1, pageSize: 20, fromTime: '2026-10-29T10:00:00' },
    {
      page: 1,
      pageSize: 20,
      fromTime: '2026-10-29T00:00:01Z',
      toTime: '2026-10-29T00:00:00Z',
    },
  ])('rejects invalid query %j before database access', async (query) => {
    const { service, findPage } = setup();
    await expect(service.execute(query)).rejects.toMatchObject({ status: 400 });
    expect(findPage).not.toHaveBeenCalled();
  });
  it.each(['custom_operator', 'disabled_admin'])(
    'rejects role %s even with log action grants',
    (key) => {
      const { service, findPage } = setup();
      const principal: AuthorizationPrincipal = {
        userId: 1,
        active: true,
        merchantId: null,
        roles: [
          {
            roleKey: key === 'disabled_admin' ? 'system_admin' : key,
            active: key !== 'disabled_admin',
            dataScope: 'all',
            permissionKeys: ['system:operation-log:list'],
          },
        ],
      };
      expect(() =>
        new OperationLogsController(service).list(
          { page: 1, pageSize: 20 },
          { user: principal },
        ),
      ).toThrow('Only system_admin');
      expect(findPage).not.toHaveBeenCalled();
    },
  );
});
