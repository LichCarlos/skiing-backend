import { randomUUID } from 'node:crypto';
import { ManageUsers } from '../src/modules/identity-access/application/manage-users.js';
import { ResolveAuthorizationPrincipal } from '../src/modules/identity-access/application/resolve-authorization-principal.js';
import {
  mayEnterManagementPortal,
  resolveDataScope,
} from '../src/modules/identity-access/domain/authorization.js';
import { PrismaAuthorizationPrincipalReader } from '../src/modules/identity-access/infrastructure/prisma-authorization-principal-reader.js';
import { PrismaManagedUserRepository } from '../src/modules/identity-access/infrastructure/prisma-managed-user.repository.js';
import { BcryptPasswordHasher } from '../src/modules/identity-access/infrastructure/bcrypt-password-hasher.js';
import { PrismaService } from '../src/shared/persistence/prisma.service.js';

const commands = [
  ['create', 'system:user:create'],
  ['roles', 'system:user:assign-role'],
  ['status', 'system:user:update'],
] as const;
type Command = (typeof commands)[number][0];
describe('User writes reauthorize in real PostgreSQL transactions', () => {
  const prefix = `uwa_${randomUUID().slice(0, 8)}`;
  let prisma: PrismaService,
    service: ManageUsers,
    writerId: number,
    adminId: number;
  let writerRole: number,
    conflictRole: number,
    assignableRole: number,
    adminRole: number,
    registeredRole: number;
  let sequence = 0;
  const users: number[] = [],
    roles: number[] = [];
  let grants: { PermissionId: number; PermissionKey: string; Status: string }[];
  const password = 'user-write-validation-password';
  let hash: string;
  const audit = (actorUserId = writerId, traceId = `${prefix}_write`) => ({
    actorUserId,
    traceId,
    clientIp: null,
    userAgent: null,
  });
  beforeAll(async () => {
    if (!process.env.DATABASE_URL)
      throw new Error('Dedicated migrated DATABASE_URL required');
    prisma = new PrismaService();
    service = new ManageUsers(
      new PrismaManagedUserRepository(prisma),
      new BcryptPasswordHasher(),
    );
    adminRole = (
      await prisma.role.findUniqueOrThrow({
        where: { SystemRoleCode: 'system_admin' },
      })
    ).RoleId;
    registeredRole = (
      await prisma.role.findUniqueOrThrow({
        where: { SystemRoleCode: 'registered_user' },
      })
    ).RoleId;
    grants = await prisma.permission.findMany({
      where: {
        PermissionKey: {
          in: [
            'management:portal:enter',
            ...commands.map(([, grant]) => grant),
          ],
        },
      },
      select: { PermissionId: true, PermissionKey: true, Status: true },
    });
    expect(grants).toHaveLength(4);
    for (const name of ['writer', 'conflict', 'assignable']) {
      const role = await prisma.role.create({
        data: {
          RoleKey: `${prefix}_${name}`,
          RoleName: name,
          DataScope: 'all',
        },
      });
      roles.push(role.RoleId);
    }
    [writerRole, conflictRole, assignableRole] = roles;
    hash = await new BcryptPasswordHasher().hash(password);
    writerId = await account(writerRole);
    adminId = await account(adminRole);
    await prisma.merchantProfile.create({
      data: { UserId: writerId, BusinessName: prefix },
    });
  });
  beforeEach(async () => {
    await prisma.user.updateMany({
      where: { UserId: { in: [writerId, adminId] } },
      data: { Status: 'active' },
    });
    await prisma.role.updateMany({
      where: { RoleId: { in: roles } },
      data: { Status: 'active', DataScope: 'all' },
    });
    await prisma.userRole.deleteMany({
      where: { UserId: { in: [writerId, adminId] } },
    });
    await prisma.userRole.createMany({
      data: [
        { UserId: writerId, RoleId: writerRole },
        { UserId: adminId, RoleId: adminRole },
      ],
    });
    await prisma.rolePermission.deleteMany({
      where: { RoleId: { in: roles } },
    });
    await prisma.rolePermission.createMany({
      data: grants.map(({ PermissionId }) => ({
        RoleId: writerRole,
        PermissionId,
      })),
    });
    await prisma.roleDataScope.deleteMany({ where: { RoleId: { in: roles } } });
  });
  afterEach(async () => {
    for (const grant of grants ?? [])
      await prisma.permission.update({
        where: { PermissionId: grant.PermissionId },
        data: { Status: grant.Status },
      });
  });
  afterAll(async () => {
    try {
      if (prisma) {
        await prisma.operationLog.deleteMany({
          where: { ActorUserId: { in: users } },
        });
        await prisma.merchantProfile.deleteMany({
          where: { UserId: { in: users } },
        });
        await prisma.user.deleteMany({
          where: { Account: { startsWith: prefix } },
        });
        await prisma.role.deleteMany({
          where: { RoleKey: { startsWith: prefix } },
        });
      }
    } finally {
      await prisma?.$disconnect();
    }
  });
  async function account(roleId = assignableRole) {
    const user = await prisma.user.create({
      data: {
        Account: `${prefix}_${sequence++}`,
        Nickname: 'Validation account',
        PasswordHash: hash,
        UserRoles: { create: { RoleId: roleId } },
      },
    });
    users.push(user.UserId);
    return user.UserId;
  }
  const grantId = (key: string) =>
    grants.find((g) => g.PermissionKey === key)!.PermissionId;
  async function principal() {
    return new ResolveAuthorizationPrincipal(
      new PrismaAuthorizationPrincipalReader(prisma),
    ).execute(writerId);
  }
  async function entry(command: Command) {
    const actor = await principal();
    expect(mayEnterManagementPortal(actor)).toBe(true);
    expect(
      resolveDataScope(
        actor,
        commands.find(([key]) => key === command)![1],
        'user',
      )?.kind,
    ).toBe('all');
  }
  async function scope(
    type: 'self' | 'merchant' | 'selected',
    selectedId: number,
  ) {
    await prisma.roleDataScope.create({
      data: {
        RoleId: writerRole,
        ResourceKey: 'user',
        ScopeType: type,
        ...(type === 'selected'
          ? { ScopeConfig: { selectedIds: [selectedId] } }
          : {}),
      },
    });
  }
  async function snapshot() {
    return {
      users: await prisma.user.findMany({
        where: { Account: { startsWith: prefix } },
        orderBy: { UserId: 'asc' },
        include: { UserRoles: { orderBy: { RoleId: 'asc' } } },
      }),
      logs: await prisma.operationLog.findMany({
        where: { ActorUserId: { in: [writerId, adminId] } },
        orderBy: { OperationLogId: 'asc' },
      }),
    };
  }
  async function run(
    command: Command,
    target: number,
    actor = writerId,
    traceId = `${prefix}_write`,
  ) {
    // Extra old snapshots intentionally simulate an in-flight caller. They cannot grant authority.
    const stale = {
      actorIsSystemAdmin: true,
      scope: { kind: 'all' as const },
      audit: audit(actor, traceId),
    };
    if (command === 'create')
      return service.create({
        ...stale,
        account: `${prefix}_${sequence++}`,
        nickname: 'New account',
        password,
        roleIds: [assignableRole],
      });
    if (command === 'roles')
      return service.replaceRoles({
        ...stale,
        userId: target,
        roleIds: [registeredRole],
      });
    return service.setStatus({ ...stale, userId: target, status: 'disabled' });
  }
  async function denied(command: Command, target: number, status = 403) {
    const before = await snapshot();
    await expect(run(command, target)).rejects.toMatchObject({ status });
    expect(await snapshot()).toEqual(before);
  }
  it.each(commands)(
    'allows delegated %s and appends only a redacted audit atomically',
    async (command, permission) => {
      const target = await account();
      await entry(command);
      const result = await run(command, target);
      expect(result).toBeDefined();
      const logs = (await snapshot()).logs;
      expect(logs.at(-1)).toMatchObject({
        ActorUserId: writerId,
        ActionKey: permission,
      });
      const serialized = JSON.stringify(logs, (_key, value: unknown) =>
        typeof value === 'bigint' ? String(value) : value,
      );
      expect(serialized).not.toContain(hash);
      expect(serialized).not.toContain(password);
    },
  );
  for (const [command, permission] of commands) {
    it.each([
      'account-disabled',
      'role-disabled',
      'membership-removed',
      'action-removed',
      'action-disabled',
      'portal-removed',
      'portal-disabled',
      'conflicting-scope',
    ] as const)(
      `rejects ${command} after %s committed before transaction entry`,
      async (reason) => {
        const target = await account();
        await entry(command);
        if (reason === 'account-disabled')
          await prisma.user.update({
            where: { UserId: writerId },
            data: { Status: 'disabled' },
          });
        if (reason === 'role-disabled')
          await prisma.role.update({
            where: { RoleId: writerRole },
            data: { Status: 'disabled' },
          });
        if (reason === 'membership-removed')
          await prisma.userRole.deleteMany({ where: { UserId: writerId } });
        const key = reason.startsWith('portal-')
          ? 'management:portal:enter'
          : permission;
        if (reason.endsWith('-removed') && reason !== 'membership-removed')
          await prisma.rolePermission.delete({
            where: {
              RoleId_PermissionId: {
                RoleId: writerRole,
                PermissionId: grantId(key),
              },
            },
          });
        if (reason === 'action-disabled' || reason === 'portal-disabled')
          await prisma.permission.update({
            where: { PermissionId: grantId(key) },
            data: { Status: 'disabled' },
          });
        if (reason === 'conflicting-scope') {
          await prisma.role.update({
            where: { RoleId: conflictRole },
            data: {
              DataScope: 'self',
              RolePermissions: {
                create: { PermissionId: grantId(permission) },
              },
            },
          });
          await prisma.userRole.create({
            data: { UserId: writerId, RoleId: conflictRole },
          });
        }
        await denied(command, target);
      },
    );
    it.each(['self', 'merchant', 'selected'] as const)(
      `narrows ${command} to current %s scope`,
      async (type) => {
        const target = await account();
        await entry(command);
        await scope(type, writerId);
        await denied(command, target, command === 'create' ? 403 : 404);
      },
    );
    it(`rolls back ${command} and its audit on an actual INSERT failure`, async () => {
      const target = await account(),
        before = await snapshot();
      await expect(
        run(command, target, writerId, 'x'.repeat(101)),
      ).rejects.toMatchObject({ code: 'P2000' });
      expect(await snapshot()).toEqual(before);
    });
  }
  it.each(['roles', 'status'] as const)(
    'denies invalid user selected range before a Prisma int4 query for %s',
    async (command) => {
      const target = await account();
      await scope('selected', 2147483648);
      await denied(command, target);
    },
  );
  it.each(['roles', 'status'] as const)(
    'allows current selected %s target',
    async (command) => {
      const target = await account();
      await scope('selected', target);
      expect(await run(command, target)).toMatchObject({ userId: target });
    },
  );
  it.each(['self', 'merchant'] as const)(
    'allows current %s owner without trusting stale all scope',
    async (type) => {
      await scope(type, writerId);
      expect(await run('status', writerId)).toMatchObject({
        userId: writerId,
        status: 'disabled',
      });
    },
  );
  it('uses registered-user fallback for empty creation and verifies the stored initial password', async () => {
    const created = await service.create({
      account: ` ${prefix}_NORMALIZED `,
      nickname: ' New ',
      password,
      roleIds: [],
      audit: audit(),
    });
    users.push(created.userId);
    expect(created).toMatchObject({
      account: `${prefix}_normalized`,
      nickname: 'New',
      roles: [{ roleId: registeredRole }],
    });
    const stored = await prisma.user.findUniqueOrThrow({
      where: { UserId: created.userId },
    });
    expect(
      await new BcryptPasswordHasher().verify(password, stored.PasswordHash),
    ).toBe(true);
  });
  it.each(['create', 'roles'] as const)(
    'rejects forged administrator flag on %s and allows actual protected administrator',
    async (command) => {
      const target = await account();
      const stale = {
        actorIsSystemAdmin: true,
        scope: { kind: 'all' as const },
      };
      const make = (actor: number) =>
        command === 'create'
          ? service.create({
              ...stale,
              account: `${prefix}_${sequence++}`,
              nickname: 'Admin candidate',
              password,
              roleIds: [adminRole],
              audit: audit(actor),
            })
          : service.replaceRoles({
              ...stale,
              userId: target,
              roleIds: [adminRole],
              audit: audit(actor),
            });
      const before = await snapshot();
      await expect(make(writerId)).rejects.toMatchObject({ status: 403 });
      expect(await snapshot()).toEqual(before);
      expect((await make(adminId))!.roles).toMatchObject([
        { roleId: adminRole },
      ]);
    },
  );
  it('denies a mixed protected administrator identity despite holding action grants', async () => {
    const target = await account();
    await prisma.userRole.create({
      data: { UserId: writerId, RoleId: adminRole },
    });
    await denied('roles', target);
  });
  it.each(['self', 'selected'] as const)(
    'intersects the requested detail ID with %s range instead of overwriting it',
    async (kind) => {
      const other = await account();
      const currentScope =
        kind === 'self'
          ? { kind: 'self' as const, userId: writerId }
          : { kind: 'selected' as const, ids: [writerId] };
      expect(await service.get(writerId, currentScope)).toMatchObject({
        userId: writerId,
      });
      await expect(service.get(other, currentScope)).rejects.toMatchObject({
        status: 404,
      });
      const list = await service.list({
        page: 1,
        pageSize: 20,
        scope: currentScope,
      });
      expect(list.items.map((user) => user.userId)).toEqual([writerId]);
      expect(list.total).toBe(1);
    },
  );
});
