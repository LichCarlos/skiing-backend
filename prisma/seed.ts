import { PrismaClient } from '@prisma/client';
import { ensureInitialSystemAdmin } from '../src/modules/identity-access/application/ensure-initial-system-admin.js';
import { parseInitialAdminCredentials } from '../src/modules/identity-access/application/initial-admin-credentials.js';
import {
  INITIAL_ROLE_PERMISSION_TEMPLATES,
  SYSTEM_ADMIN_ROLE_PERMISSION_KEYS,
  SYSTEM_PERMISSION_DEFINITIONS,
} from '../src/modules/identity-access/domain/permissions.js';
import { BcryptPasswordHasher } from '../src/modules/identity-access/infrastructure/bcrypt-password-hasher.js';
import type { DataScope } from '../src/modules/identity-access/domain/data-scope.js';

const prisma = new PrismaClient();
const passwordHasher = new BcryptPasswordHasher();
const initialRoleTemplates: readonly {
  key: string;
  systemCode: string;
  name: string;
  dataScope: DataScope;
  permissionKeys: readonly string[];
}[] = [
  {
    key: 'user',
    systemCode: 'registered_user',
    name: '注册用户',
    dataScope: 'self',
    permissionKeys: INITIAL_ROLE_PERMISSION_TEMPLATES.user,
  },
  {
    key: 'merchant',
    systemCode: 'merchant_template',
    name: '商家管理初始模板',
    dataScope: 'merchant',
    permissionKeys: INITIAL_ROLE_PERMISSION_TEMPLATES.merchant,
  },
  {
    key: 'system_admin',
    systemCode: 'system_admin',
    name: '系统管理员',
    dataScope: 'all',
    permissionKeys: SYSTEM_ADMIN_ROLE_PERMISSION_KEYS,
  },
];

async function seed(): Promise<void> {
  const initialAdmin = parseInitialAdminCredentials(
    process.env.INITIAL_ADMIN_ACCOUNT,
    process.env.INITIAL_ADMIN_PASSWORD,
  );

  await prisma.$transaction(async (transaction) => {
    const roles = new Map<string, number>();
    const createdSystemRoleCodes = new Set<string>();
    for (const template of initialRoleTemplates) {
      const existing = await transaction.role.findUnique({
        where: { SystemRoleCode: template.systemCode },
        select: { RoleId: true },
      });
      const role = await transaction.role.upsert({
        where: { SystemRoleCode: template.systemCode },
        create: {
          RoleKey: template.key,
          RoleName: template.name,
          SystemRoleCode: template.systemCode,
          DataScope: template.dataScope,
        },
        update:
          template.key === 'system_admin'
            ? { RoleName: template.name, DataScope: template.dataScope }
            : {},
      });
      if (!existing) createdSystemRoleCodes.add(template.systemCode);
      roles.set(template.key, role.RoleId);
    }

    const permissionIds = new Map<string, number>();
    for (const definition of SYSTEM_PERMISSION_DEFINITIONS) {
      const parentId = definition.parentKey
        ? permissionIds.get(definition.parentKey)
        : undefined;
      if (definition.parentKey && parentId === undefined) {
        throw new Error(`Unknown permission parent: ${definition.parentKey}`);
      }

      const permission = await transaction.permission.upsert({
        where: { PermissionKey: definition.key },
        create: {
          PermissionKey: definition.key,
          PermissionName: definition.name,
          PermissionType: definition.type,
          ParentId: parentId,
          Route: definition.route,
          SortOrder: definition.sortOrder,
        },
        update: {
          PermissionName: definition.name,
          PermissionType: definition.type,
          ParentId: parentId,
          Route: definition.route,
          SortOrder: definition.sortOrder,
        },
      });
      permissionIds.set(definition.key, permission.PermissionId);
    }

    for (const template of initialRoleTemplates) {
      if (
        template.key !== 'system_admin' &&
        !createdSystemRoleCodes.has(template.systemCode)
      ) {
        continue;
      }
      const roleId = roles.get(template.key);
      if (roleId === undefined)
        throw new Error(`Missing initial role template: ${template.key}`);

      for (const permissionKey of template.permissionKeys) {
        const permissionId = permissionIds.get(permissionKey);
        if (permissionId === undefined) {
          throw new Error(`Missing initial permission: ${permissionKey}`);
        }
        await transaction.rolePermission.upsert({
          where: {
            RoleId_PermissionId: { RoleId: roleId, PermissionId: permissionId },
          },
          create: { RoleId: roleId, PermissionId: permissionId },
          update: {},
        });
      }
    }

    if (initialAdmin) {
      const systemAdminRoleId = roles.get('system_admin');
      if (systemAdminRoleId === undefined) {
        throw new Error('Missing built-in system_admin role');
      }

      await ensureInitialSystemAdmin(
        initialAdmin,
        systemAdminRoleId,
        {
          async findByAccount(account) {
            const existing = await transaction.user.findUnique({
              where: { Account: account },
              include: { UserRoles: { include: { Role: true } } },
            });
            if (!existing) return null;
            return {
              status: existing.Status,
              roles: existing.UserRoles.map(({ Role }) => ({
                roleKey: Role.RoleKey,
                status: Role.Status,
              })),
            };
          },
          async createSystemAdmin(input) {
            await transaction.user.create({
              data: {
                Account: input.account,
                PasswordHash: input.passwordHash,
                Nickname: input.nickname,
                UserRoles: { create: { RoleId: input.systemAdminRoleId } },
              },
            });
          },
        },
        passwordHasher,
      );
    }
  });
}

seed()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
