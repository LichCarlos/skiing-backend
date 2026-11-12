import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/shared/persistence/prisma.service.js';
import { PrismaManagedRoleRepository } from '../src/modules/platform-administration/infrastructure/prisma-managed-role.repository.js';
import { PrismaRoleAuthorizationRepository } from '../src/modules/platform-administration/infrastructure/prisma-role-authorization.repository.js';
import { ManagementWriteAuthorizationError } from '../src/modules/identity-access/domain/management-write-authorization.js';

describe('Role default scope authorization (dedicated migrated and seeded PostgreSQL)', () => {
  const prisma = new PrismaService();
  const repository = new PrismaManagedRoleRepository(prisma);
  const authorizations = new PrismaRoleAuthorizationRepository(prisma);
  const users: number[] = [];
  const roles: number[] = [];
  let administratorRoleId: number;
  let delegatedRoleId: number;
  let actorUserId: number;
  let targetRoleId: number;
  const audit = () => ({
    actorUserId,
    traceId: randomUUID(),
    clientIp: null,
    userAgent: null,
  });

  beforeAll(async () => {
    if (!process.env.DATABASE_URL)
      throw new Error(
        'DATABASE_URL must explicitly identify a migrated test database',
      );
    await prisma.$connect();
    const administrator = await prisma.role.findUniqueOrThrow({
      where: { RoleKey: 'system_admin' },
    });
    if (administrator.Status !== 'active')
      throw new Error('Seeded system_admin must be active');
    administratorRoleId = administrator.RoleId;
    const permissions = await prisma.permission.findMany({
      where: {
        PermissionKey: {
          in: [
            'management:portal:enter',
            'system:role:create',
            'system:role:update',
          ],
        },
      },
      select: { PermissionId: true },
    });
    expect(permissions).toHaveLength(3);
    const delegated = await prisma.role.create({
      data: {
        RoleKey: `scope-delegated-${randomUUID().slice(0, 16)}`,
        RoleName: 'Delegated role manager',
        DataScope: 'all',
        RolePermissions: { create: permissions },
      },
    });
    delegatedRoleId = delegated.RoleId;
    roles.push(delegatedRoleId);
    const actor = await prisma.user.create({
      data: {
        Account: `rscope-${randomUUID()}`,
        Nickname: 'Role scope DB test',
        PasswordHash: 'test-disabled',
      },
    });
    actorUserId = actor.UserId;
    users.push(actorUserId);
    const target = await prisma.role.create({
      data: {
        RoleKey: `scope-${randomUUID()}`,
        RoleName: 'Scope DB test',
        DataScope: 'self',
      },
    });
    targetRoleId = target.RoleId;
    roles.push(targetRoleId);
  });

  beforeEach(async () => {
    await prisma.userRole.deleteMany({ where: { UserId: actorUserId } });
    await prisma.userRole.create({
      data: { UserId: actorUserId, RoleId: delegatedRoleId },
    });
    await prisma.user.update({
      where: { UserId: actorUserId },
      data: { Status: 'active' },
    });
    await prisma.role.update({
      where: { RoleId: targetRoleId },
      data: { DataScope: 'self' },
    });
  });

  afterAll(async () => {
    try {
      if (users.length) {
        await prisma.operationLog.deleteMany({
          where: { ActorUserId: { in: users } },
        });
        await prisma.user.deleteMany({ where: { UserId: { in: users } } });
      }
      if (roles.length)
        await prisma.role.deleteMany({ where: { RoleId: { in: roles } } });
    } finally {
      await prisma.$disconnect();
    }
  });

  it('rejects scope patches and broad creation without persisting a role or audit, while permitting metadata', async () => {
    const deniedAudit = audit();
    await expect(
      repository.update({
        roleId: targetRoleId,
        patch: { dataScope: 'all' },
        audit: deniedAudit,
      }),
    ).rejects.toBeInstanceOf(ManagementWriteAuthorizationError);
    const roleKey = `scope-${randomUUID()}`;
    await expect(
      repository.create({
        role: {
          roleKey,
          roleName: 'Denied',
          description: null,
          dataScope: 'all',
        },
        audit: deniedAudit,
      }),
    ).rejects.toBeInstanceOf(ManagementWriteAuthorizationError);
    expect(
      await prisma.role.findUnique({ where: { RoleKey: roleKey } }),
    ).toBeNull();
    expect(
      await prisma.operationLog.count({
        where: { TraceId: deniedAudit.traceId },
      }),
    ).toBe(0);
    expect(
      await prisma.role.findUniqueOrThrow({ where: { RoleId: targetRoleId } }),
    ).toMatchObject({ DataScope: 'self' });
    await repository.update({
      roleId: targetRoleId,
      patch: { description: 'Delegated metadata' },
      audit: audit(),
    });
  });

  it('rechecks administrator membership at write time and atomically audits successful scope changes', async () => {
    await prisma.userRole.deleteMany({ where: { UserId: actorUserId } });
    await prisma.userRole.create({
      data: { UserId: actorUserId, RoleId: administratorRoleId },
    });
    const successAudit = audit();
    await repository.update({
      roleId: targetRoleId,
      patch: { dataScope: 'all' },
      audit: successAudit,
    });
    expect(
      await prisma.operationLog.findFirstOrThrow({
        where: { TraceId: successAudit.traceId },
      }),
    ).toMatchObject({
      Metadata: { before: { dataScope: 'self' }, after: { dataScope: 'all' } },
    });
    await prisma.userRole.delete({
      where: {
        UserId_RoleId: { UserId: actorUserId, RoleId: administratorRoleId },
      },
    });
    await expect(
      authorizations.replaceAuthorization({
        roleId: targetRoleId,
        authorization: { permissionIds: [], dataScopes: [], fieldPolicies: [] },
        audit: audit(),
      }),
    ).rejects.toBeInstanceOf(ManagementWriteAuthorizationError);
    await expect(
      repository.update({
        roleId: targetRoleId,
        patch: { dataScope: 'self' },
        audit: audit(),
      }),
    ).rejects.toBeInstanceOf(ManagementWriteAuthorizationError);
    expect(
      await prisma.role.findUniqueOrThrow({ where: { RoleId: targetRoleId } }),
    ).toMatchObject({ DataScope: 'all' });
  });

  it('rejects a disabled actor even with a retained administrator membership', async () => {
    await prisma.userRole.deleteMany({ where: { UserId: actorUserId } });
    await prisma.userRole.create({
      data: { UserId: actorUserId, RoleId: administratorRoleId },
    });
    await prisma.user.update({
      where: { UserId: actorUserId },
      data: { Status: 'disabled' },
    });
    const deniedAudit = audit();
    await expect(
      repository.update({
        roleId: targetRoleId,
        patch: { dataScope: 'merchant' },
        audit: deniedAudit,
      }),
    ).rejects.toBeInstanceOf(ManagementWriteAuthorizationError);
    expect(
      await prisma.operationLog.count({
        where: { TraceId: deniedAudit.traceId },
      }),
    ).toBe(0);
  });
});
