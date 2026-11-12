import { randomUUID } from 'node:crypto';
import { ResolveAuthorizationPrincipal } from '../src/modules/identity-access/application/resolve-authorization-principal.js';
import {
  mayEnterManagementPortal,
  resolveDataScope,
} from '../src/modules/identity-access/domain/authorization.js';
import { PrismaAuthorizationPrincipalReader } from '../src/modules/identity-access/infrastructure/prisma-authorization-principal-reader.js';
import { BcryptPasswordHasher } from '../src/modules/identity-access/infrastructure/bcrypt-password-hasher.js';
import { ManageRoles } from '../src/modules/platform-administration/application/manage-roles.js';
import { ManageRoleAuthorization } from '../src/modules/platform-administration/application/manage-role-authorization.js';
import { PrismaManagedRoleRepository } from '../src/modules/platform-administration/infrastructure/prisma-managed-role.repository.js';
import { PrismaRoleAuthorizationRepository } from '../src/modules/platform-administration/infrastructure/prisma-role-authorization.repository.js';
import { PrismaService } from '../src/shared/persistence/prisma.service.js';

const metadataCommands = [
  ['create', 'system:role:create'],
  ['update', 'system:role:update'],
  ['disable', 'system:role:delete'],
] as const;
type Command = (typeof metadataCommands)[number][0] | 'replace';

describe('Role writes reauthorize inside real PostgreSQL transactions', () => {
  const prefix = `rwa_${randomUUID().slice(0, 8)}`;
  const users: number[] = [],
    roles: number[] = [];
  let prisma: PrismaService,
    service: ManageRoles,
    authorization: ManageRoleAuthorization;
  let writerId: number,
    administratorId: number,
    writerRole: number,
    conflictRole: number,
    adminRole: number;
  let sequence = 0;
  let grants: { PermissionId: number; PermissionKey: string }[];
  const audit = (actorUserId: number, traceId = `${prefix}_write`) => ({
    actorUserId,
    traceId,
    clientIp: null,
    userAgent: null,
  });

  beforeAll(async () => {
    if (!process.env.DATABASE_URL)
      throw new Error('Dedicated migrated DATABASE_URL required');
    prisma = new PrismaService();
    service = new ManageRoles(new PrismaManagedRoleRepository(prisma));
    authorization = new ManageRoleAuthorization(
      new PrismaRoleAuthorizationRepository(prisma),
    );
    adminRole = (
      await prisma.role.findUniqueOrThrow({
        where: { SystemRoleCode: 'system_admin' },
      })
    ).RoleId;
    grants = await prisma.permission.findMany({
      where: {
        PermissionKey: {
          in: [
            'management:portal:enter',
            'system:role:list',
            'system:role:create',
            'system:role:update',
            'system:role:delete',
            'system:permission:assign',
          ],
        },
      },
      select: { PermissionId: true, PermissionKey: true },
    });
    expect(grants).toHaveLength(6);
    for (const suffix of ['writer', 'conflict']) {
      const role = await prisma.role.create({
        data: {
          RoleKey: `${prefix}_${suffix}`,
          RoleName: suffix,
          DataScope: 'all',
        },
      });
      roles.push(role.RoleId);
    }
    [writerRole, conflictRole] = roles;
    const password = await new BcryptPasswordHasher().hash(
      'role-write-validation-password',
    );
    for (const roleId of [writerRole, adminRole]) {
      const user = await prisma.user.create({
        data: {
          Account: `${prefix}_${users.length}`,
          Nickname: 'Role write validator',
          PasswordHash: password,
          UserRoles: { create: { RoleId: roleId } },
        },
      });
      users.push(user.UserId);
    }
    [writerId, administratorId] = users;
    await prisma.merchantProfile.create({
      data: { UserId: writerId, BusinessName: prefix },
    });
    await prisma.customFieldGroup.create({
      data: { EntityType: 'ski_resort', GroupKey: prefix, Label: prefix },
    });
    await prisma.customFieldDefinition.create({
      data: {
        EntityType: 'ski_resort',
        GroupKey: prefix,
        FieldKey: prefix,
        Label: prefix,
        DataType: 'text',
      },
    });
  });

  beforeEach(async () => {
    await prisma.user.updateMany({
      where: { UserId: { in: users } },
      data: { Status: 'active' },
    });
    await prisma.role.updateMany({
      where: { RoleId: { in: [writerRole, conflictRole] } },
      data: { Status: 'active', DataScope: 'all' },
    });
    await prisma.userRole.deleteMany({ where: { UserId: { in: users } } });
    await prisma.userRole.createMany({
      data: [
        { UserId: writerId, RoleId: writerRole },
        { UserId: administratorId, RoleId: adminRole },
      ],
    });
    await prisma.rolePermission.deleteMany({
      where: { RoleId: { in: [writerRole, conflictRole] } },
    });
    await prisma.rolePermission.createMany({
      data: grants.map(({ PermissionId }) => ({
        RoleId: writerRole,
        PermissionId,
      })),
    });
    await prisma.roleDataScope.deleteMany({
      where: { RoleId: { in: [writerRole, conflictRole] } },
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
        await prisma.user.deleteMany({ where: { UserId: { in: users } } });
        await prisma.role.deleteMany({
          where: { RoleKey: { startsWith: prefix } },
        });
        await prisma.customFieldDefinition.deleteMany({
          where: { GroupKey: prefix },
        });
        await prisma.customFieldGroup.deleteMany({
          where: { GroupKey: prefix },
        });
      }
    } finally {
      await prisma?.$disconnect();
    }
  });

  async function target() {
    const role = await prisma.role.create({
      data: {
        RoleKey: `${prefix}_${sequence++}`,
        RoleName: 'Target',
        DataScope: 'self',
        RolePermissions: { create: { PermissionId: grants[0]!.PermissionId } },
        DataScopes: { create: { ResourceKey: 'asset', ScopeType: 'self' } },
        FieldPolicies: {
          create: {
            EntityType: 'ski_resort',
            FieldKey: prefix,
            CanRead: true,
            CanWrite: false,
          },
        },
      },
    });
    return role.RoleId;
  }
  async function snapshot() {
    const where = { RoleKey: { startsWith: prefix } };
    return {
      roles: await prisma.role.findMany({
        where,
        orderBy: { RoleId: 'asc' },
        include: {
          RolePermissions: { orderBy: { PermissionId: 'asc' } },
          DataScopes: { orderBy: { ResourceKey: 'asc' } },
          FieldPolicies: { orderBy: { FieldKey: 'asc' } },
        },
      }),
      logs: await prisma.operationLog.findMany({
        where: { ActorUserId: { in: users } },
        orderBy: { OperationLogId: 'asc' },
      }),
    };
  }
  async function principal(userId = writerId) {
    return new ResolveAuthorizationPrincipal(
      new PrismaAuthorizationPrincipalReader(prisma),
    ).execute(userId);
  }
  async function entry(permission: string, userId = writerId) {
    const current = await principal(userId);
    expect(mayEnterManagementPortal(current)).toBe(true);
    expect(resolveDataScope(current, permission, 'role')?.kind).toBe('all');
  }
  async function revoke(permission: string) {
    await prisma.rolePermission.delete({
      where: {
        RoleId_PermissionId: {
          RoleId: writerRole,
          PermissionId: grants.find((g) => g.PermissionKey === permission)!
            .PermissionId,
        },
      },
    });
  }
  async function scope(
    scopeType: 'self' | 'merchant' | 'selected',
    roleId: number,
    role = writerRole,
  ) {
    await prisma.roleDataScope.create({
      data: {
        RoleId: role,
        ResourceKey: 'role',
        ScopeType: scopeType,
        ...(scopeType === 'selected'
          ? { ScopeConfig: { selectedIds: [roleId] } }
          : {}),
      },
    });
  }
  function run(
    command: Command,
    roleId: number,
    actorUserId = writerId,
    traceId?: string,
  ) {
    const context = audit(actorUserId, traceId);
    if (command === 'create')
      return service.create({
        role: {
          roleKey: `${prefix}_${sequence++}`,
          roleName: 'Created',
          description: null,
          dataScope: 'self',
        },
        audit: context,
      });
    if (command === 'update')
      return service.update({
        roleId,
        patch: { roleName: 'Updated', description: 'Changed' },
        audit: context,
      });
    if (command === 'disable')
      return service.disable({ roleId, audit: context });
    return authorization.replace({
      roleId,
      authorization: {
        permissionIds: [
          grants.find((g) => g.PermissionKey === 'system:role:list')!
            .PermissionId,
        ],
        dataScopes: [{ resourceKey: 'resort', scopeType: 'merchant' }],
        fieldPolicies: [
          {
            entityType: 'ski_resort',
            fieldKey: prefix,
            canRead: false,
            canWrite: true,
          },
        ],
      },
      audit: context,
    });
  }
  async function denied(command: Command, roleId: number, userId = writerId) {
    const before = await snapshot();
    await expect(run(command, roleId, userId)).rejects.toMatchObject({
      status: 403,
    });
    expect(await snapshot()).toEqual(before);
  }

  it.each(metadataCommands)(
    'allows delegated %s and commits the matching audit',
    async (command, action) => {
      const id = await target(),
        before = await snapshot();
      await run(command, id);
      const after = await snapshot();
      expect(after.logs).toHaveLength(before.logs.length + 1);
      expect(after.logs.at(-1)).toMatchObject({
        ActorUserId: writerId,
        ActionKey: action,
        Result: 'success',
      });
      const changed = after.roles.find((r) => r.RoleId === id)!;
      if (command === 'update') expect(changed.RoleName).toBe('Updated');
      if (command === 'disable') expect(changed.Status).toBe('disabled');
      if (command === 'create')
        expect(after.roles).toHaveLength(before.roles.length + 1);
    },
  );

  it.each(metadataCommands)(
    'rejects %s after an action grant was revoked following the entry read',
    async (command, permission) => {
      const id = await target();
      await entry(permission);
      await revoke(permission);
      await denied(command, id);
    },
  );

  it.each(metadataCommands)(
    'rejects %s after management entry was revoked',
    async (command, permission) => {
      const id = await target();
      await entry(permission);
      await revoke('management:portal:enter');
      await denied(command, id);
    },
  );

  it.each(
    metadataCommands.flatMap(([command]) =>
      ['account', 'role', 'binding', 'conflict'].map((reason) => ({
        command,
        reason,
      })),
    ),
  )(
    'rejects stale metadata authorization: $command / $reason',
    async ({ command, reason }) => {
      const id = await target();
      await entry(metadataCommands.find(([name]) => name === command)![1]);
      if (reason === 'account')
        await prisma.user.update({
          where: { UserId: writerId },
          data: { Status: 'disabled' },
        });
      if (reason === 'role')
        await prisma.role.update({
          where: { RoleId: writerRole },
          data: { Status: 'disabled' },
        });
      if (reason === 'binding')
        await prisma.userRole.deleteMany({ where: { UserId: writerId } });
      if (reason === 'conflict') {
        await prisma.rolePermission.createMany({
          data: grants.map(({ PermissionId }) => ({
            RoleId: conflictRole,
            PermissionId,
          })),
        });
        await scope('selected', id, conflictRole);
        await prisma.userRole.create({
          data: { UserId: writerId, RoleId: conflictRole },
        });
      }
      await denied(command, id);
    },
  );

  it.each(['update', 'disable'] as const)(
    'permits %s only inside current selected-role scope',
    async (command) => {
      const visible = await target(),
        hidden = await target();
      await scope('selected', visible);
      await denied(command, hidden);
      await run(command, visible);
    },
  );
  it('forbids create after all scope changed to selected', async () => {
    const id = await target();
    await entry('system:role:create');
    await scope('selected', id);
    await denied('create', id);
  });
  it.each(
    metadataCommands.flatMap(([command]) =>
      (['self', 'merchant'] as const).map((kind) => ({ command, kind })),
    ),
  )(
    'rejects unsupported role resource scope: $command / $kind',
    async ({ command, kind }) => {
      const id = await target();
      await scope(kind, id);
      expect(
        resolveDataScope(
          await principal(),
          metadataCommands.find(([name]) => name === command)![1],
          'role',
        )?.kind,
      ).toBe(kind);
      await denied(command, id);
    },
  );

  it('requires protected administrator identity for broader creation and explicit default-scope updates', async () => {
    const id = await target(),
      before = await snapshot();
    await expect(
      service.create({
        role: {
          roleKey: `${prefix}_broad`,
          roleName: 'Broad',
          description: null,
          dataScope: 'all',
        },
        audit: audit(writerId),
      }),
    ).rejects.toMatchObject({ status: 403 });
    for (const dataScope of ['self', 'merchant', 'all'] as const)
      await expect(
        service.update({
          roleId: id,
          patch: { dataScope },
          audit: audit(writerId),
        }),
      ).rejects.toMatchObject({ status: 403 });
    expect(await snapshot()).toEqual(before);
    await service.update({
      roleId: id,
      patch: { dataScope: 'all' },
      audit: audit(administratorId),
    });
    expect((await service.get(id)).dataScope).toBe('all');
  });

  it('replaces permissions, scopes, fields and audit with current protected administrator authority', async () => {
    const id = await target(),
      before = await snapshot();
    await run('replace', id, administratorId);
    const after = await snapshot();
    expect(after.logs).toHaveLength(before.logs.length + 1);
    expect(after.logs.at(-1)).toMatchObject({
      ActorUserId: administratorId,
      ActionKey: 'system:permission:assign',
    });
    expect(await authorization.get(id)).toMatchObject({
      permissionIds: [
        grants.find((g) => g.PermissionKey === 'system:role:list')!
          .PermissionId,
      ],
      dataScopes: [{ resourceKey: 'resort', scopeType: 'merchant' }],
      fieldPolicies: [
        {
          entityType: 'ski_resort',
          fieldKey: prefix,
          canRead: false,
          canWrite: true,
        },
      ],
    });
  });
  it('denies replacement by a delegated actor holding every action grant', async () => {
    const id = await target();
    await entry('system:permission:assign');
    await denied('replace', id);
  });
  it.each(['disabled', 'unbound', 'downgraded', 'mixed'] as const)(
    'denies replacement after administrator authority becomes %s',
    async (reason) => {
      const id = await target();
      await entry('system:permission:assign', administratorId);
      if (reason === 'disabled')
        await prisma.user.update({
          where: { UserId: administratorId },
          data: { Status: 'disabled' },
        });
      if (reason === 'unbound' || reason === 'downgraded')
        await prisma.userRole.deleteMany({
          where: { UserId: administratorId },
        });
      if (reason === 'downgraded' || reason === 'mixed')
        await prisma.userRole.create({
          data: { UserId: administratorId, RoleId: writerRole },
        });
      await denied('replace', id, administratorId);
    },
  );

  it.each(['create', 'update', 'disable', 'replace'] as const)(
    'rolls back %s and its audit on an actual audit INSERT failure',
    async (command) => {
      const id = await target(),
        before = await snapshot();
      await expect(
        run(
          command,
          id,
          command === 'replace' ? administratorId : writerId,
          'x'.repeat(101),
        ),
      ).rejects.toMatchObject({ code: 'P2000' });
      expect(await snapshot()).toEqual(before);
    },
  );
});
