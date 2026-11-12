import { ManageUsers } from './manage-users.js';
import type { ManagedUserRepository } from './ports/managed-user-repository.js';
import { ManagementWriteAuthorizationError } from '../domain/management-write-authorization.js';

describe('Managed user application write boundaries', () => {
  const audit = {
    actorUserId: 1,
    traceId: 'trace',
    clientIp: null,
    userAgent: null,
  };
  const create = {
    account: ' Account ',
    nickname: ' Name ',
    password: 'initial-password',
    roleIds: [2],
    audit,
  };
  const result = { userId: 3 };
  const repository = {
    list: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    replaceRoles: vi.fn(),
    setStatus: vi.fn(),
  };
  const hasher = { hash: vi.fn(), verify: vi.fn() };
  const service = new ManageUsers(
    repository as unknown as ManagedUserRepository,
    hasher,
  );
  beforeEach(() => {
    vi.resetAllMocks();
    hasher.hash.mockResolvedValue('hash');
    repository.create.mockResolvedValue(result);
    repository.replaceRoles.mockResolvedValue(result);
    repository.setStatus.mockResolvedValue(result);
  });
  it('normalizes identity and sends only credentials hash and trusted actor to the repository', async () => {
    const input = {
      ...create,
      actorIsSystemAdmin: true,
      scope: { kind: 'all' },
    };
    expect(await service.create(input)).toEqual(result);
    expect(repository.create).toHaveBeenCalledExactlyOnceWith({
      account: 'account',
      nickname: 'Name',
      passwordHash: 'hash',
      roleIds: [2],
      audit,
    });
  });
  it.each(
    [[0], [-1], [1.5], [2147483648], [1, 1]].map((roleIds) => ({ roleIds })),
  )(
    'rejects invalid role IDs before hashing or persistence: $roleIds',
    async ({ roleIds }) => {
      await expect(
        service.create({ ...create, roleIds }),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        service.replaceRoles({ userId: 3, roleIds, audit }),
      ).rejects.toMatchObject({ status: 400 });
      expect(hasher.hash).not.toHaveBeenCalled();
      expect(repository.create).not.toHaveBeenCalled();
      expect(repository.replaceRoles).not.toHaveBeenCalled();
    },
  );
  it.each([0, -1, 1.5, 2147483648, Number.MAX_SAFE_INTEGER])(
    'rejects invalid user ID %s before every target query',
    async (userId) => {
      await expect(service.get(userId, { kind: 'all' })).rejects.toMatchObject({
        status: 400,
      });
      await expect(
        service.replaceRoles({ userId, roleIds: [], audit }),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        service.setStatus({ userId, status: 'disabled', audit }),
      ).rejects.toMatchObject({ status: 400 });
      expect(repository.findById).not.toHaveBeenCalled();
      expect(repository.replaceRoles).not.toHaveBeenCalled();
      expect(repository.setStatus).not.toHaveBeenCalled();
    },
  );
  it('preserves empty role replacement and explicit status commands', async () => {
    await service.replaceRoles({ userId: 3, roleIds: [], audit });
    expect(repository.replaceRoles).toHaveBeenCalledExactlyOnceWith({
      userId: 3,
      roleIds: [],
      audit,
    });
    await service.setStatus({ userId: 3, status: 'disabled', audit });
    expect(repository.setStatus).toHaveBeenCalledExactlyOnceWith({
      userId: 3,
      status: 'disabled',
      audit,
    });
  });
  it.each(['create', 'replaceRoles', 'setStatus'] as const)(
    'maps revoked %s authority to 403 and serialization conflicts to 409 without retries',
    async (command) => {
      const run = () =>
        command === 'create'
          ? service.create(create)
          : command === 'replaceRoles'
            ? service.replaceRoles({ userId: 3, roleIds: [], audit })
            : service.setStatus({ userId: 3, status: 'disabled', audit });
      repository[command].mockRejectedValueOnce(
        new ManagementWriteAuthorizationError('Revoked'),
      );
      await expect(run()).rejects.toMatchObject({ status: 403 });
      repository[command].mockRejectedValueOnce({ code: 'P2034' });
      await expect(run()).rejects.toMatchObject({ status: 409 });
      expect(repository[command]).toHaveBeenCalledTimes(2);
    },
  );
  it.each(['replaceRoles', 'setStatus'] as const)(
    'returns 404 for an invisible %s target',
    async (command) => {
      repository[command].mockResolvedValueOnce(null);
      const operation =
        command === 'replaceRoles'
          ? service.replaceRoles({ userId: 3, roleIds: [], audit })
          : service.setStatus({ userId: 3, status: 'disabled', audit });
      await expect(operation).rejects.toMatchObject({ status: 404 });
    },
  );
  it('rejects unsafe/int4-overflow pagination before repository access', async () => {
    for (const page of [2147483647, Number.MAX_SAFE_INTEGER])
      await expect(
        service.list({ page, pageSize: 100, scope: { kind: 'all' } }),
      ).rejects.toMatchObject({ status: 400 });
    expect(repository.list).not.toHaveBeenCalled();
  });
});
