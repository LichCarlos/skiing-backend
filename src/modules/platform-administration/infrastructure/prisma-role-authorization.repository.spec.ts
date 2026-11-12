import { Prisma } from '@prisma/client';
import { ManagementWriteAuthorizationError } from '../../identity-access/domain/management-write-authorization.js';
import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';
import {
  InvalidRoleAuthorizationReferenceError,
  ProtectedSystemRoleError,
} from '../application/role-authorization-errors.js';
import { PrismaRoleAuthorizationRepository } from './prisma-role-authorization.repository.js';

const authorization = {
  permissionIds: [3, 2],
  dataScopes: [
    {
      resourceKey: 'role',
      scopeType: 'selected' as const,
      selectedIds: [9, 4],
    },
    { resourceKey: 'resort', scopeType: 'merchant' as const },
  ],
  fieldPolicies: [
    {
      entityType: 'ski_resort',
      fieldKey: 'lift_count',
      canRead: true,
      canWrite: false,
    },
  ],
};

function roleRecord(roleKey = 'resort_operator') {
  return {
    RoleId: 7,
    RoleKey: roleKey,
    RoleName: '雪场运营',
    SystemRoleCode: roleKey === 'system_admin' ? 'system_admin' : null,
    Status: 'active',
    RolePermissions: [{ PermissionId: 8 }],
    DataScopes: [],
    FieldPolicies: [],
  };
}

function setup(options?: {
  role?: ReturnType<typeof roleRecord>;
  permissionIds?: number[];
  administrator?: boolean;
  actorStatus?: string;
}) {
  const events: string[] = [];
  const roleFind = vi.fn(async () => options?.role ?? roleRecord());
  const transaction = {
    role: { findUnique: roleFind },
    user: {
      findUnique: vi.fn(async (input: { select: { UserId?: boolean } }) =>
        input.select.UserId
          ? {
              UserId: 42,
              Status: options?.actorStatus ?? 'active',
              MerchantProfile: null,
              UserRoles: [
                {
                  Role: {
                    RoleKey:
                      options?.administrator === false
                        ? 'delegated'
                        : 'system_admin',
                    Status: 'active',
                    DataScope: 'all',
                    DataScopes: [],
                    RolePermissions: [
                      'management:portal:enter',
                      'system:role:create',
                      'system:role:update',
                      'system:role:delete',
                      'system:permission:assign',
                    ].map((PermissionKey) => ({
                      Permission: { PermissionKey, Status: 'active' },
                    })),
                  },
                },
              ],
            }
          : {
              Account: 'admin',
              UserRoles:
                options?.administrator === false ? [] : [{ RoleId: 1 }],
            },
      ),
    },
    permission: {
      findMany: vi.fn(async () =>
        (options?.permissionIds ?? authorization.permissionIds).map(
          (PermissionId) => ({ PermissionId }),
        ),
      ),
    },
    customFieldDefinition: {
      findMany: vi.fn(async () => [
        { EntityType: 'ski_resort', FieldKey: 'lift_count' },
      ]),
    },
    rolePermission: {
      deleteMany: vi.fn(async () => {
        events.push('delete-permissions');
        return { count: 1 };
      }),
      createMany: vi.fn(async () => {
        events.push('create-permissions');
        return { count: 2 };
      }),
    },
    roleDataScope: {
      deleteMany: vi.fn(async () => {
        events.push('delete-scopes');
        return { count: 1 };
      }),
      createMany: vi.fn(async () => {
        events.push('create-scopes');
        return { count: 2 };
      }),
    },
    roleFieldPermission: {
      deleteMany: vi.fn(async () => {
        events.push('delete-fields');
        return { count: 1 };
      }),
      createMany: vi.fn(async () => {
        events.push('create-fields');
        return { count: 1 };
      }),
    },
    operationLog: {
      create: vi.fn(async () => {
        events.push('audit');
        return {};
      }),
    },
  };
  const transactionCall = vi.fn(
    async (
      callback: (tx: typeof transaction) => Promise<unknown>,
      _options?: unknown,
    ) => callback(transaction),
  );
  const prisma = { $transaction: transactionCall } as unknown as PrismaService;
  return {
    repository: new PrismaRoleAuthorizationRepository(prisma),
    transaction,
    transactionCall,
    events,
  };
}

describe('PrismaRoleAuthorizationRepository', () => {
  it.each([{ administrator: false }, { actorStatus: 'disabled' }])(
    'rejects unavailable administrator authority before replacing any grants: %j',
    async (options) => {
      const { repository, transaction, events } = setup(options);
      await expect(
        repository.replaceAuthorization({
          roleId: 7,
          authorization,
          audit: {
            actorUserId: 42,
            traceId: 'denied',
            clientIp: null,
            userAgent: null,
          },
        }),
      ).rejects.toBeInstanceOf(ManagementWriteAuthorizationError);
      expect(events).toEqual([]);
      expect(transaction.permission.findMany).not.toHaveBeenCalled();
    },
  );
  it('replaces all grant sets and audit metadata in one serializable transaction', async () => {
    const { repository, transaction, transactionCall, events } = setup();
    const result = await repository.replaceAuthorization({
      roleId: 7,
      authorization,
      audit: {
        actorUserId: 42,
        traceId: 'trace-42',
        clientIp: '127.0.0.1',
        userAgent: 'test-client',
      },
    });

    expect(result).toEqual({
      roleId: 7,
      roleKey: 'resort_operator',
      roleName: '雪场运营',
      status: 'active',
      permissionIds: [2, 3],
      dataScopes: [
        { resourceKey: 'resort', scopeType: 'merchant' },
        { resourceKey: 'role', scopeType: 'selected', selectedIds: [4, 9] },
      ],
      fieldPolicies: authorization.fieldPolicies,
    });
    expect(transactionCall.mock.calls[0]?.[1]).toEqual({
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(transaction.rolePermission.createMany).toHaveBeenCalledWith({
      data: [
        { RoleId: 7, PermissionId: 3 },
        { RoleId: 7, PermissionId: 2 },
      ],
    });
    expect(transaction.roleDataScope.createMany).toHaveBeenCalledWith({
      data: [
        {
          RoleId: 7,
          ResourceKey: 'role',
          ScopeType: 'selected',
          ScopeConfig: { selectedIds: [9, 4] },
        },
        {
          RoleId: 7,
          ResourceKey: 'resort',
          ScopeType: 'merchant',
          ScopeConfig: Prisma.DbNull,
        },
      ],
    });
    expect(transaction.operationLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ActorUserId: 42,
        ActorAccountSnapshot: 'admin',
        ActionKey: 'system:permission:assign',
        ResourceKey: 'system:role',
        TargetId: '7',
        TraceId: 'trace-42',
        Metadata: expect.objectContaining({
          before: expect.objectContaining({ permissionIds: [8] }),
          after: expect.objectContaining({ permissionIds: [2, 3] }),
        }),
      }),
    });
    expect(events).toEqual([
      'delete-permissions',
      'delete-scopes',
      'delete-fields',
      'create-permissions',
      'create-scopes',
      'create-fields',
      'audit',
    ]);
  });

  it('protects system_admin and rejects missing permission references before deleting grants', async () => {
    const protectedSetup = setup({ role: roleRecord('system_admin') });
    await expect(
      protectedSetup.repository.replaceAuthorization({
        roleId: 7,
        authorization,
        audit: {
          actorUserId: 42,
          traceId: 'trace-42',
          clientIp: null,
          userAgent: null,
        },
      }),
    ).rejects.toBeInstanceOf(ProtectedSystemRoleError);
    expect(
      protectedSetup.transaction.rolePermission.deleteMany,
    ).not.toHaveBeenCalled();

    const invalidSetup = setup({ permissionIds: [] });
    await expect(
      invalidSetup.repository.replaceAuthorization({
        roleId: 7,
        authorization,
        audit: {
          actorUserId: 42,
          traceId: 'trace-42',
          clientIp: null,
          userAgent: null,
        },
      }),
    ).rejects.toBeInstanceOf(InvalidRoleAuthorizationReferenceError);
    expect(
      invalidSetup.transaction.rolePermission.deleteMany,
    ).not.toHaveBeenCalled();
  });
});
