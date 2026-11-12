import { randomUUID } from 'node:crypto';
import { ResolveAuthorizationPrincipal } from '../src/modules/identity-access/application/resolve-authorization-principal.js';
import { ManagePermissionCatalog } from '../src/modules/identity-access/application/manage-permission-catalog.js';
import {
  mayEnterManagementPortal,
  resolveDataScope,
} from '../src/modules/identity-access/domain/authorization.js';
import { PrismaAuthorizationPrincipalReader } from '../src/modules/identity-access/infrastructure/prisma-authorization-principal-reader.js';
import { PrismaPermissionCatalogRepository } from '../src/modules/identity-access/infrastructure/prisma-permission-catalog.repository.js';
import { BcryptPasswordHasher } from '../src/modules/identity-access/infrastructure/bcrypt-password-hasher.js';
import { ManageDictionaries } from '../src/modules/platform-administration/application/manage-dictionaries.js';
import { PrismaManagedDictionaryRepository } from '../src/modules/platform-administration/infrastructure/prisma-managed-dictionary.repository.js';
import { PrismaService } from '../src/shared/persistence/prisma.service.js';

const commands = [
  ['createType', 'system:dict:create'],
  ['updateType', 'system:dict:update'],
  ['disableType', 'system:dict:delete'],
  ['createItem', 'system:dict:create'],
  ['updateItem', 'system:dict:update'],
  ['disableItem', 'system:dict:delete'],
  ['createPermission', 'system:permission:create'],
  ['updatePermission', 'system:permission:update'],
  ['disablePermission', 'system:permission:delete'],
] as const;

describe('Dictionary and permission catalog transaction authorization / real PostgreSQL', () => {
  const prefix = `cwa_${randomUUID().slice(0, 8)}`;
  const users: number[] = [],
    roles: number[] = [];
  let prisma: PrismaService,
    dictionaries: ManageDictionaries,
    permissions: ManagePermissionCatalog;
  let writerId: number,
    writerRoleId: number,
    conflictRoleId: number,
    adminRoleId: number;
  let grants: { PermissionId: number; PermissionKey: string }[];
  let sequence = 0;
  const audit = (actorUserId: number) => ({
    actorUserId,
    traceId: `${prefix}_write`,
    clientIp: null,
    userAgent: null,
  });

  beforeAll(async () => {
    if (!process.env.DATABASE_URL)
      throw new Error('Dedicated migrated DATABASE_URL required');
    prisma = new PrismaService();
    dictionaries = new ManageDictionaries(
      new PrismaManagedDictionaryRepository(prisma),
    );
    permissions = new ManagePermissionCatalog(
      new PrismaPermissionCatalogRepository(prisma),
    );
    adminRoleId = (
      await prisma.role.findUniqueOrThrow({
        where: { SystemRoleCode: 'system_admin' },
      })
    ).RoleId;
    const keys = [
      ...new Set([
        'management:portal:enter',
        ...commands.map(([, permission]) => permission),
      ]),
    ];
    grants = await prisma.permission.findMany({
      where: { PermissionKey: { in: keys } },
      select: { PermissionId: true, PermissionKey: true },
    });
    expect(grants).toHaveLength(keys.length);
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
      'configuration-authorization-validation-password',
    );
    for (const roleId of [writerRoleId]) {
      const user = await prisma.user.create({
        data: {
          Account: `${prefix}_${users.length}`,
          Nickname: 'Configuration validator',
          PasswordHash: passwordHash,
          UserRoles: { create: { RoleId: roleId } },
        },
      });
      users.push(user.UserId);
    }
    [writerId] = users;
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
        await prisma.outboxEvent.deleteMany({
          where: {
            EventType: 'dictionary.changed.v1',
            AggregateId: { startsWith: prefix },
          },
        });
        // Detach owned parent links before deleting this suite's dictionaries.
        await prisma.dictionaryItem.updateMany({
          where: { DictType: { startsWith: prefix } },
          data: { ParentId: null },
        });
        await prisma.dictionaryItem.deleteMany({
          where: { DictType: { startsWith: prefix } },
        });
        await prisma.dictionaryType.deleteMany({
          where: { DictType: { startsWith: prefix } },
        });
        await prisma.operationLog.deleteMany({
          where: { ActorUserId: { in: users } },
        });
        await prisma.user.deleteMany({ where: { UserId: { in: users } } });
        await prisma.role.deleteMany({ where: { RoleId: { in: roles } } });
        await prisma.permission.deleteMany({
          where: {
            PermissionKey: { startsWith: `custom:${prefix}` },
            PermissionType: 'menu',
          },
        });
        await prisma.permission.deleteMany({
          where: { PermissionKey: { startsWith: `custom:${prefix}` } },
        });
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
    await prisma.rolePermission.delete({
      where: {
        RoleId_PermissionId: {
          RoleId: writerRoleId,
          PermissionId: grants.find(
            (grant) => grant.PermissionKey === permission,
          )!.PermissionId,
        },
      },
    });
  }
  async function snapshot() {
    return {
      types: await prisma.dictionaryType.findMany({
        where: { DictType: { startsWith: prefix } },
        orderBy: { DictType: 'asc' },
      }),
      items: await prisma.dictionaryItem.findMany({
        where: { DictType: { startsWith: prefix } },
        orderBy: { ItemId: 'asc' },
      }),
      // Include the entire registry so a rejected sync cannot mutate code nodes unnoticed.
      permissions: await prisma.permission.findMany({
        orderBy: { PermissionId: 'asc' },
      }),
      logs: await prisma.operationLog.findMany({
        where: { ActorUserId: { in: users } },
        orderBy: { OperationLogId: 'asc' },
      }),
      events: await prisma.outboxEvent.findMany({
        orderBy: { EventId: 'asc' },
      }),
    };
  }
  async function fixture() {
    const dictType = `${prefix}_${sequence++}`;
    const actor = audit(writerId);
    // Seed valid owned rows directly. Each operation under test still uses the
    // production Application/Repository and its real authorization transaction.
    await prisma.dictionaryType.create({
      data: { DictType: dictType, DictName: 'Type', GroupKey: 'test' },
    });
    const item = {
      label: 'Parent',
      value: 'parent',
      parentId: null,
      color: null,
      sortOrder: 0,
      isDefault: false,
    };
    const row = await prisma.dictionaryItem.create({
      data: { DictType: dictType, Label: 'Parent', Value: 'parent' },
    });
    const parent = { itemId: row.ItemId };
    await prisma.dictionaryItem.create({
      data: {
        DictType: dictType,
        Label: 'Child',
        Value: 'child',
        ParentId: parent.itemId,
      },
    });
    const directory = await prisma.permission.create({
      data: {
        PermissionKey: `custom:${dictType}.directory`,
        PermissionName: 'Directory',
        PermissionType: 'directory',
      },
    });
    const menuRow = await prisma.permission.create({
      data: {
        PermissionKey: `custom:${dictType}.menu`,
        PermissionName: 'Menu',
        PermissionType: 'menu',
        ParentId: directory.PermissionId,
        Route: '/reports',
      },
    });
    const menu = { permissionId: menuRow.PermissionId };
    return {
      dictType,
      parent,
      operations: {
        createType: () =>
          dictionaries.createType({
            dictType: `${dictType}_new`,
            dictName: 'New',
            groupKey: 'test',
            audit: actor,
          }),
        updateType: () =>
          dictionaries.updateType({
            dictType,
            patch: { dictName: 'Changed' },
            audit: actor,
          }),
        disableType: () => dictionaries.disableType({ dictType, audit: actor }),
        createItem: () =>
          dictionaries.createItem({
            dictType,
            item: { ...item, value: 'new' },
            audit: actor,
          }),
        updateItem: () =>
          dictionaries.updateItem({
            dictType,
            itemId: parent.itemId,
            patch: { label: 'Changed' },
            audit: actor,
          }),
        disableItem: () =>
          dictionaries.disableItem({
            dictType,
            itemId: parent.itemId,
            audit: actor,
          }),
        createPermission: () =>
          permissions.create({
            body: {
              permissionKey: `custom:${dictType}.new`,
              permissionName: 'New',
              permissionType: 'directory',
            },
            audit: actor,
          }),
        updatePermission: () =>
          permissions.update({
            permissionId: menu.permissionId,
            body: { permissionName: 'Changed' },
            audit: actor,
          }),
        disablePermission: () =>
          permissions.disable({
            permissionId: menu.permissionId,
            audit: actor,
          }),
      },
    };
  }

  it.each(commands)(
    'allows delegated %s and its atomic side effects',
    async (command, permission) => {
      const { operations, dictType } = await fixture();
      const before = await prisma.operationLog.count({
        where: { ActorUserId: writerId },
      });
      const eventsBefore = await prisma.outboxEvent.count({
        where: { AggregateId: { startsWith: dictType } },
      });
      await operations[command]();
      expect(
        await prisma.operationLog.count({ where: { ActorUserId: writerId } }),
      ).toBe(before + 1);
      const log = await prisma.operationLog.findFirstOrThrow({
        where: { ActorUserId: writerId },
        orderBy: { OperationLogId: 'desc' },
      });
      const itemAction = command.endsWith('Item')
        ? permission.replace('system:dict:', 'system:dict:item:')
        : permission;
      expect(log).toMatchObject({ ActionKey: itemAction, Result: 'success' });
      const events = await prisma.outboxEvent.count({
        where: { AggregateId: { startsWith: dictType } },
      });
      const expectedEvents = [
        'updateType',
        'disableType',
        'updateItem',
        'disableItem',
      ].includes(command)
        ? 2
        : command === 'createItem'
          ? 1
          : 0;
      expect(events).toBe(eventsBefore + expectedEvents);
    },
  );

  it.each(commands)(
    'rejects %s after entry succeeds and its action grant is revoked before the transaction',
    async (command, permission) => {
      const { operations } = await fixture();
      const entry = await principal();
      expect(mayEnterManagementPortal(entry)).toBe(true);
      expect(resolveDataScope(entry, permission)).toEqual({ kind: 'all' });
      await revoke(permission);
      expect(resolveDataScope(entry, permission)).toEqual({ kind: 'all' });
      const before = await snapshot();
      await expect(operations[command]()).rejects.toMatchObject({
        status: 403,
      });
      expect(await snapshot()).toEqual(before);
    },
  );

  describe.each(['dictionary', 'permission'] as const)(
    '%s stale authorization',
    (resource) => {
      it.each([
        'portal revoked',
        'account disabled',
        'role disabled',
        'role unassigned',
        'scope conflict',
        'mixed administrator',
      ] as const)(
        'rejects after %s without business, audit or event changes',
        async (condition) => {
          const { operations } = await fixture();
          const action =
            resource === 'dictionary'
              ? 'system:dict:update'
              : 'system:permission:update';
          expect(resolveDataScope(await principal(), action)).toEqual({
            kind: 'all',
          });
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
                    (grant) => grant.PermissionKey === action,
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
          await expect(
            resource === 'dictionary'
              ? operations.updateItem()
              : operations.updatePermission(),
          ).rejects.toMatchObject({ status: 403 });
          expect(await snapshot()).toEqual(before);
        },
      );
    },
  );

  it.each(['delegated', 'admin identity revoked'] as const)(
    'denies registry sync for %s despite current update grants',
    async (condition) => {
      await fixture();
      if (condition === 'admin identity revoked') {
        await prisma.userRole.deleteMany({ where: { UserId: writerId } });
        await prisma.userRole.create({
          data: { UserId: writerId, RoleId: adminRoleId },
        });
        const entry = await principal();
        expect(
          entry?.roles.some(
            (role) => role.active && role.roleKey === 'system_admin',
          ),
        ).toBe(true);
        await prisma.userRole.deleteMany({ where: { UserId: writerId } });
        await prisma.userRole.create({
          data: { UserId: writerId, RoleId: writerRoleId },
        });
      }
      expect(
        resolveDataScope(await principal(), 'system:permission:update'),
      ).toEqual({ kind: 'all' });
      const before = await snapshot();
      await expect(
        permissions.sync({ audit: audit(writerId) }),
      ).rejects.toMatchObject({ status: 403 });
      expect(await snapshot()).toEqual(before);
    },
  );
});
