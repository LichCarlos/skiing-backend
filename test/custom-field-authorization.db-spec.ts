import { randomUUID } from 'node:crypto';
import { ResolveAuthorizationPrincipal } from '../src/modules/identity-access/application/resolve-authorization-principal.js';
import {
  mayEnterManagementPortal,
  resolveDataScope,
} from '../src/modules/identity-access/domain/authorization.js';
import { PrismaAuthorizationPrincipalReader } from '../src/modules/identity-access/infrastructure/prisma-authorization-principal-reader.js';
import { BcryptPasswordHasher } from '../src/modules/identity-access/infrastructure/bcrypt-password-hasher.js';
import { ManageCustomFields } from '../src/modules/platform-administration/application/manage-custom-fields.js';
import { CustomFieldAuthorizationError } from '../src/modules/platform-administration/domain/custom-field-audit.js';
import { PrismaCustomFieldRepository } from '../src/modules/platform-administration/infrastructure/prisma-custom-field.repository.js';
import { PrismaService } from '../src/shared/persistence/prisma.service.js';

const commands = [
  ['createDefinition', 'system:field:create'],
  ['updateDefinition', 'system:field:update'],
  ['activateDefinition', 'system:field:update'],
  ['disableDefinition', 'system:field:delete'],
  ['createGroup', 'system:field-group:create'],
  ['updateGroup', 'system:field-group:update'],
  ['disableGroup', 'system:field-group:delete'],
] as const;

describe('Custom field transaction authorization / real PostgreSQL', () => {
  const prefix = `cfa_${randomUUID().slice(0, 8)}`;
  const users: number[] = [],
    roles: number[] = [];
  let prisma: PrismaService,
    repository: PrismaCustomFieldRepository,
    service: ManageCustomFields;
  let adminId: number,
    writerId: number,
    writerRoleId: number,
    conflictRoleId: number,
    adminRoleId: number;
  let grants: { PermissionId: number; PermissionKey: string }[];
  let sequence = 0;
  const context = (actorUserId: number) => ({
    actorUserId,
    traceId: `${prefix}_write`,
    clientIp: null,
    userAgent: null,
  });

  beforeAll(async () => {
    if (!process.env.DATABASE_URL)
      throw new Error('Dedicated migrated DATABASE_URL required');
    prisma = new PrismaService();
    repository = new PrismaCustomFieldRepository(prisma);
    service = new ManageCustomFields(repository);
    adminRoleId = (
      await prisma.role.findUniqueOrThrow({
        where: { SystemRoleCode: 'system_admin' },
      })
    ).RoleId;
    const permissionKeys = [
      ...new Set([
        'management:portal:enter',
        ...commands.map(([, permission]) => permission),
      ]),
    ];
    grants = await prisma.permission.findMany({
      where: { PermissionKey: { in: permissionKeys } },
      select: { PermissionId: true, PermissionKey: true },
    });
    expect(grants).toHaveLength(permissionKeys.length);
    for (const [suffix, scope] of [
      ['writer', 'all'],
      ['conflict', 'self'],
    ] as const) {
      const role = await prisma.role.create({
        data: {
          RoleKey: `${prefix}_${suffix}`,
          RoleName: suffix,
          DataScope: scope,
        },
      });
      roles.push(role.RoleId);
    }
    [writerRoleId, conflictRoleId] = roles;
    const passwordHash = await new BcryptPasswordHasher().hash(
      'field-authorization-validation-password',
    );
    for (const roleId of [adminRoleId, writerRoleId]) {
      const user = await prisma.user.create({
        data: {
          Account: `${prefix}_${users.length}`,
          Nickname: 'Field transaction validator',
          PasswordHash: passwordHash,
          UserRoles: { create: { RoleId: roleId } },
        },
      });
      users.push(user.UserId);
    }
    [adminId, writerId] = users;
  });

  beforeEach(async () => {
    await prisma.user.update({
      where: { UserId: writerId },
      data: { Status: 'active' },
    });
    await prisma.role.update({
      where: { RoleId: writerRoleId },
      data: { Status: 'active' },
    });
    await prisma.userRole.deleteMany({ where: { UserId: writerId } });
    await prisma.userRole.create({
      data: { UserId: writerId, RoleId: writerRoleId },
    });
    await prisma.rolePermission.deleteMany({
      where: { RoleId: { in: roles } },
    });
    await prisma.rolePermission.createMany({
      data: grants.map(({ PermissionId }) => ({
        RoleId: writerRoleId,
        PermissionId,
      })),
    });
  });

  afterAll(async () => {
    try {
      if (prisma) {
        await prisma.customFieldDefinition.deleteMany({
          where: { GroupKey: { startsWith: prefix } },
        });
        await prisma.customFieldGroup.deleteMany({
          where: { GroupKey: { startsWith: prefix } },
        });
        await prisma.operationLog.deleteMany({
          where: { ActorUserId: { in: users } },
        });
        await prisma.user.deleteMany({ where: { UserId: { in: users } } });
        await prisma.role.deleteMany({ where: { RoleId: { in: roles } } });
      }
    } finally {
      await prisma?.$disconnect();
    }
  });

  async function principal() {
    return new ResolveAuthorizationPrincipal(
      new PrismaAuthorizationPrincipalReader(prisma),
    ).execute(writerId);
  }
  async function revoke(permission: string) {
    const grant = grants.find(
      ({ PermissionKey }) => PermissionKey === permission,
    )!;
    await prisma.rolePermission.delete({
      where: {
        RoleId_PermissionId: {
          RoleId: writerRoleId,
          PermissionId: grant.PermissionId,
        },
      },
    });
  }
  async function snapshot() {
    return {
      fields: await prisma.customFieldDefinition.findMany({
        where: { GroupKey: { startsWith: prefix } },
        orderBy: { FieldDefinitionId: 'asc' },
      }),
      groups: await prisma.customFieldGroup.findMany({
        where: { GroupKey: { startsWith: prefix } },
        orderBy: { GroupKey: 'asc' },
      }),
      logs: await prisma.operationLog.findMany({
        where: { ActorUserId: { in: users } },
        orderBy: { OperationLogId: 'asc' },
      }),
      outboxCount: await prisma.outboxEvent.count(),
    };
  }
  async function fixture() {
    const group = {
      entityType: 'article',
      groupKey: `${prefix}_${sequence++}`,
      label: 'Group',
      sortOrder: 0,
    };
    await repository.createGroup(group, context(adminId));
    const input = {
      ...group,
      fieldKey: group.groupKey,
      label: 'Field',
      dataType: 'text',
      required: false,
      searchable: false,
      filterable: false,
      sortable: false,
      isPublic: false,
    };
    const definition = await repository.createDefinition(
      input,
      context(adminId),
    );
    const id = {
      fieldDefinitionId: definition.fieldDefinitionId,
      expectedSchemaVersion: 1,
    };
    const actor = context(writerId);
    return {
      group,
      input,
      definition,
      id,
      actor,
      operations: {
        createDefinition: () =>
          service.create(
            { ...input, fieldKey: `${input.fieldKey}_new` },
            actor,
          ),
        updateDefinition: () =>
          service.update({ ...id, patch: { label: 'Changed' } }, actor),
        activateDefinition: () => service.activate(id, actor),
        disableDefinition: () => service.disable(id, actor),
        createGroup: () =>
          service.createGroup(
            { ...group, groupKey: `${group.groupKey}_new` },
            actor,
          ),
        updateGroup: () =>
          service.updateGroup({ ...group, label: 'Changed' }, actor),
        disableGroup: () =>
          service.disableGroup(group.entityType, group.groupKey, actor),
      },
    };
  }

  it.each(commands)(
    'permits delegated %s with active portal and action grants',
    async (command, permission) => {
      const { operations } = await fixture();
      const before = await prisma.operationLog.count({
        where: { ActorUserId: writerId },
      });
      await operations[command]();
      const logs = await prisma.operationLog.findMany({
        where: { ActorUserId: writerId },
        orderBy: { OperationLogId: 'desc' },
      });
      expect(logs).toHaveLength(before + 1);
      expect(logs[0]).toMatchObject({
        ActionKey: permission,
        Result: 'success',
        ActorUserId: writerId,
      });
    },
  );

  it.each(commands)(
    'rejects %s when its grant is revoked after entry authorization and before the transaction',
    async (command, permission) => {
      const { operations } = await fixture();
      const entryPrincipal = await principal();
      expect(mayEnterManagementPortal(entryPrincipal)).toBe(true);
      expect(resolveDataScope(entryPrincipal, permission)).toEqual({
        kind: 'all',
      });
      await revoke(permission);
      // The old principal still grants this action; no Guard or Prisma is mocked.
      expect(resolveDataScope(entryPrincipal, permission)).toEqual({
        kind: 'all',
      });
      const before = await snapshot();
      await expect(operations[command]()).rejects.toMatchObject({
        status: 403,
      });
      expect(await snapshot()).toEqual(before);
    },
  );

  it.each([
    'portal revoked',
    'account disabled',
    'role disabled',
    'role unassigned',
    'scope conflict',
    'mixed administrator',
  ] as const)(
    'rejects a stale writer after %s without configuration or audit changes',
    async (condition) => {
      const { operations } = await fixture();
      expect(
        resolveDataScope(await principal(), 'system:field:update'),
      ).toEqual({ kind: 'all' });
      switch (condition) {
        case 'portal revoked':
          await revoke('management:portal:enter');
          break;
        case 'account disabled':
          await prisma.user.update({
            where: { UserId: writerId },
            data: { Status: 'disabled' },
          });
          break;
        case 'role disabled':
          await prisma.role.update({
            where: { RoleId: writerRoleId },
            data: { Status: 'disabled' },
          });
          break;
        case 'role unassigned':
          await prisma.userRole.deleteMany({ where: { UserId: writerId } });
          break;
        case 'scope conflict':
          await prisma.rolePermission.create({
            data: {
              RoleId: conflictRoleId,
              PermissionId: grants.find(
                (grant) => grant.PermissionKey === 'system:field:update',
              )!.PermissionId,
            },
          });
          await prisma.userRole.create({
            data: { UserId: writerId, RoleId: conflictRoleId },
          });
          break;
        case 'mixed administrator':
          await prisma.userRole.create({
            data: { UserId: writerId, RoleId: adminRoleId },
          });
          break;
      }
      const before = await snapshot();
      await expect(operations.updateDefinition()).rejects.toMatchObject({
        status: 403,
      });
      expect(await snapshot()).toEqual(before);
    },
  );

  it.each(['create', 'update'] as const)(
    'enforces public administration inside the repository on %s',
    async (operation) => {
      const { input, id, actor } = await fixture();
      const before = await snapshot();
      const write =
        operation === 'create'
          ? () =>
              repository.createDefinition(
                {
                  ...input,
                  fieldKey: `${input.fieldKey}_public`,
                  isPublic: true,
                },
                actor,
              )
          : () =>
              repository.updateDefinition(
                { ...id, patch: { isPublic: true } },
                actor,
              );
      await expect(write()).rejects.toBeInstanceOf(
        CustomFieldAuthorizationError,
      );
      expect(await snapshot()).toEqual(before);
    },
  );

  it('permits protected admin public creation and update, and delegated public clearing', async () => {
    const { input, id, actor } = await fixture();
    expect(
      (
        await repository.createDefinition(
          { ...input, fieldKey: `${input.fieldKey}_public`, isPublic: true },
          context(adminId),
        )
      ).isPublic,
    ).toBe(true);
    expect(
      (
        await repository.updateDefinition(
          { ...id, patch: { isPublic: true } },
          context(adminId),
        )
      )?.isPublic,
    ).toBe(true);
    const cleared = await service.update(
      { ...id, expectedSchemaVersion: 2, patch: { isPublic: false } },
      actor,
    );
    expect(cleared).toMatchObject({ isPublic: false, schemaVersion: 3 });
  });

  it('rejects stale admin public permission after its protected identity is removed', async () => {
    const { id } = await fixture();
    // This account held the protected identity at entry and only ordinary grants at write time.
    await prisma.userRole.delete({
      where: { UserId_RoleId: { UserId: writerId, RoleId: writerRoleId } },
    });
    await prisma.userRole.create({
      data: { UserId: writerId, RoleId: adminRoleId },
    });
    expect(mayEnterManagementPortal(await principal())).toBe(true);
    await prisma.userRole.delete({
      where: { UserId_RoleId: { UserId: writerId, RoleId: adminRoleId } },
    });
    await prisma.userRole.create({
      data: { UserId: writerId, RoleId: writerRoleId },
    });
    const before = await snapshot();
    await expect(
      service.update({ ...id, patch: { isPublic: true } }, context(writerId)),
    ).rejects.toMatchObject({ status: 403 });
    expect(await snapshot()).toEqual(before);
  });
});
