import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../../shared/persistence/prisma.service.js';
import { registeredApiPermissions } from '../domain/permission-catalog.js';
import { SYSTEM_PERMISSION_DEFINITIONS } from '../domain/permissions.js';
import { PrismaPermissionCatalogRepository } from './prisma-permission-catalog.repository.js';

const audit = {
  actorUserId: 9,
  traceId: 'trace-permission-sync',
  clientIp: '127.0.0.1',
  userAgent: 'vitest',
};

function activeActor() {
  return {
    UserId: audit.actorUserId,
    Account: 'admin',
    Status: 'active',
    MerchantProfile: null,
    UserRoles: [
      {
        Role: {
          RoleKey: 'system_admin',
          Status: 'active',
          DataScope: 'all',
          DataScopes: [],
          RolePermissions: [
            'management:portal:enter',
            'system:permission:create',
            'system:permission:update',
            'system:permission:delete',
          ].map((PermissionKey) => ({
            Permission: { PermissionKey, Status: 'active' },
          })),
        },
      },
    ],
  };
}

function repositoryFor(tx: Record<string, unknown>) {
  const prisma = {
    $transaction: vi.fn(async (work: (value: unknown) => unknown) => work(tx)),
  };
  return {
    repository: new PrismaPermissionCatalogRepository(
      prisma as unknown as PrismaService,
    ),
    prisma,
  };
}

describe('PrismaPermissionCatalogRepository', () => {
  it('refuses soft-disabling a custom node with children or role references', async () => {
    const tx = {
      permission: {
        findUnique: vi.fn(async () => ({
          PermissionId: 4,
          ParentId: 1,
          PermissionKey: 'custom:menu.reports',
          PermissionName: 'Reports',
          PermissionType: 'menu',
          Route: '/reports',
          Icon: null,
          SortOrder: 0,
          Visible: true,
          Status: 'active',
        })),
        count: vi.fn(async () => 0),
        update: vi.fn(),
      },
      rolePermission: { count: vi.fn(async () => 1) },
      user: { findUnique: vi.fn(async () => activeActor()) },
      operationLog: { create: vi.fn() },
    };
    const { repository } = repositoryFor(tx);

    await expect(repository.disable({ permissionId: 4, audit })).resolves.toBe(
      'in-use',
    );
    expect(tx.permission.update).not.toHaveBeenCalled();
    expect(tx.operationLog.create).not.toHaveBeenCalled();
  });

  it('commits disabled state and OperationLog through the same transaction', async () => {
    const events: string[] = [];
    const tx = {
      permission: {
        findUnique: vi.fn(async () => ({
          PermissionId: 4,
          ParentId: 1,
          PermissionKey: 'custom:button.export',
          PermissionName: 'Export',
          PermissionType: 'button',
          Route: null,
          Icon: null,
          SortOrder: 0,
          Visible: true,
          Status: 'active',
        })),
        count: vi.fn(async () => 0),
        update: vi.fn(async () => {
          events.push('permission');
          return {};
        }),
      },
      rolePermission: { count: vi.fn(async () => 0) },
      user: {
        findUnique: vi.fn(async () => {
          events.push('actor');
          return activeActor();
        }),
      },
      operationLog: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          events.push('audit');
          expect(data).toMatchObject({
            ActionKey: 'system:permission:delete',
            TargetId: '4',
            TraceId: audit.traceId,
          });
          return {};
        }),
      },
    };
    const { repository, prisma } = repositoryFor(tx);

    await expect(repository.disable({ permissionId: 4, audit })).resolves.toBe(
      'disabled',
    );
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(events).toEqual(['actor', 'actor', 'permission', 'audit']);
  });

  it('synchronizes only API definitions and records one transactional audit', async () => {
    const rows = SYSTEM_PERMISSION_DEFINITIONS.map((definition, index) => ({
      PermissionId: index + 1,
      PermissionKey: definition.key,
      PermissionName: definition.name,
      PermissionType: definition.type,
      ParentId: definition.parentKey
        ? SYSTEM_PERMISSION_DEFINITIONS.findIndex(
            (item) => item.key === definition.parentKey,
          ) + 1
        : null,
      Route: definition.route ?? null,
      Icon: null,
      SortOrder: definition.sortOrder,
      Status: 'active',
      Visible: true,
    }));
    const tx = {
      permission: {
        findUnique: vi.fn(async () => ({ PermissionId: 2 })),
        upsert: vi.fn(async () => ({})),
        findMany: vi.fn(async (query: { where?: unknown }) =>
          query.where
            ? [{ PermissionId: 999, PermissionKey: 'retired:api' }]
            : rows,
        ),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      user: { findUnique: vi.fn(async () => activeActor()) },
      operationLog: { create: vi.fn(async () => ({})) },
    };
    const { repository, prisma } = repositoryFor(tx);

    await expect(repository.sync({ audit })).resolves.toMatchObject({
      created: 0,
      updated: registeredApiPermissions().length,
      disabled: 1,
    });
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(tx.permission.upsert).toHaveBeenCalledTimes(
      registeredApiPermissions().length,
    );
    expect(tx.permission.updateMany).toHaveBeenCalledWith({
      where: { PermissionId: { in: [999] } },
      data: { Status: 'disabled' },
    });
    expect(tx.operationLog.create).toHaveBeenCalledOnce();
  });
});
