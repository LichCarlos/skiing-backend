import { Prisma } from '@prisma/client';
import { ManagementWriteAuthorizationError } from '../../identity-access/domain/management-write-authorization.js';
import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';
import {
  ProtectedManagedRoleError,
  RegistrationRoleRequiredError,
} from '../application/role-management-errors.js';
import { PrismaManagedRoleRepository } from './prisma-managed-role.repository.js';

function roleRow(overrides: Record<string, unknown> = {}) {
  return {
    RoleId: 7,
    RoleKey: 'resort_operator',
    RoleName: '雪场运营',
    RoleDescription: null,
    SystemRoleCode: null,
    DataScope: 'merchant',
    Status: 'active',
    _count: { UserRoles: 2, RolePermissions: 3, FieldPolicies: 1 },
    DataScopes: [{ ResourceKey: 'resort', ScopeType: 'merchant' }],
    ...overrides,
  };
}

function setup(options?: {
  role?: ReturnType<typeof roleRow> | null;
  actorStatus?: string;
  administrator?: boolean;
}) {
  const events: string[] = [];
  const current = options?.role === undefined ? roleRow() : options.role;
  const transaction = {
    role: {
      findUnique: vi.fn(async () => current),
      create: vi.fn(async () => roleRow({ RoleId: 8 })),
      update: vi.fn(async (input: { data: Record<string, unknown> }) =>
        roleRow(input.data),
      ),
    },
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
    operationLog: {
      create: vi.fn(async () => {
        events.push('audit');
        return {};
      }),
    },
  };
  const prismaMock = {
    role: {
      findMany: vi.fn(async () => [roleRow()]),
      count: vi.fn(async () => 1),
    },
    $transaction: vi.fn(async (input: unknown) => {
      if (typeof input === 'function') {
        return input(transaction);
      }
      return Promise.all(input as Promise<unknown>[]);
    }),
  };
  const prisma = prismaMock as unknown as PrismaService;
  return {
    repository: new PrismaManagedRoleRepository(prisma),
    transaction,
    events,
    prisma: prismaMock,
  };
}

const audit = {
  actorUserId: 42,
  traceId: 'trace-42',
  clientIp: '127.0.0.1',
  userAgent: 'test-client',
};

describe('PrismaManagedRoleRepository', () => {
  it('applies keyword, status, role-scope, and offset filters to the database query', async () => {
    const { repository, prisma } = setup();
    const result = await repository.list({
      keyword: 'operator',
      status: 'active',
      roleIds: [7],
      skip: 20,
      take: 10,
    });

    expect(result).toMatchObject({
      total: 1,
      items: [
        {
          roleId: 7,
          userCount: 2,
          permissionCount: 3,
          fieldPolicyCount: 1,
          dataScopes: [{ resourceKey: 'resort', scopeType: 'merchant' }],
        },
      ],
    });
    expect(prisma.role.findMany).toHaveBeenCalledWith({
      where: {
        RoleId: { in: [7] },
        Status: 'active',
        OR: [
          { RoleKey: { contains: 'operator', mode: 'insensitive' } },
          { RoleName: { contains: 'operator', mode: 'insensitive' } },
        ],
      },
      include: expect.any(Object),
      orderBy: [{ RoleId: 'asc' }],
      skip: 20,
      take: 10,
    });
    expect(prisma.role.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ RoleId: { in: [7] } }),
    });
  });

  it('creates role metadata and audit in one serializable transaction', async () => {
    const { repository, transaction, prisma, events } = setup();
    const result = await repository.create({
      role: {
        roleKey: 'resort_reviewer',
        roleName: ' 雪场审核员 ',
        description: ' 资料审核 ',
        dataScope: 'merchant',
      },
      audit,
    });

    expect(result).toMatchObject({
      roleId: 8,
      userCount: 2,
      permissionCount: 3,
    });
    expect(transaction.role.create).toHaveBeenCalledWith({
      data: {
        RoleKey: 'resort_reviewer',
        RoleName: '雪场审核员',
        RoleDescription: '资料审核',
        DataScope: 'merchant',
        Status: 'active',
      },
      include: expect.any(Object),
    });
    expect(transaction.operationLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ActionKey: 'system:role:create',
        ActorAccountSnapshot: 'admin',
        TargetId: '8',
        TraceId: 'trace-42',
      }),
    });
    expect(
      (prisma.$transaction as ReturnType<typeof vi.fn>).mock.calls[0]?.[1],
    ).toEqual({
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(events).toEqual(['audit']);
  });

  it('protects system_admin and the registered-user role from deactivation', async () => {
    const protectedRole = setup({
      role: roleRow({
        SystemRoleCode: 'system_admin',
        RoleKey: 'system_admin',
      }),
    });
    await expect(
      protectedRole.repository.update({
        roleId: 7,
        patch: { roleName: 'Changed' },
        audit,
      }),
    ).rejects.toBeInstanceOf(ProtectedManagedRoleError);
    expect(protectedRole.transaction.role.update).not.toHaveBeenCalled();

    const registrationRole = setup({
      role: roleRow({
        SystemRoleCode: 'registered_user',
        RoleKey: 'member_base',
      }),
    });
    await expect(
      registrationRole.repository.disable({ roleId: 7, audit }),
    ).rejects.toBeInstanceOf(RegistrationRoleRequiredError);
    expect(registrationRole.transaction.role.update).not.toHaveBeenCalled();
  });

  it('returns null for a missing role instead of writing an audit entry', async () => {
    const { repository, transaction } = setup({ role: null });
    await expect(
      repository.update({ roleId: 99, patch: { roleName: 'missing' }, audit }),
    ).resolves.toBeNull();
    expect(transaction.user.findUnique).toHaveBeenCalled();
    expect(transaction.operationLog.create).not.toHaveBeenCalled();
  });

  it.each(['self', 'merchant', 'all'] as const)(
    'rejects explicit %s scope patches by non-administrators before any write',
    async (dataScope) => {
      const { repository, transaction } = setup({ administrator: false });
      await expect(
        repository.update({ roleId: 7, patch: { dataScope }, audit }),
      ).rejects.toBeInstanceOf(ManagementWriteAuthorizationError);
      expect(transaction.role.update).not.toHaveBeenCalled();
      expect(transaction.operationLog.create).not.toHaveBeenCalled();
      expect(transaction.user.findUnique).toHaveBeenCalledWith({
        where: { UserId: 42 },
        select: {
          Account: true,
          UserRoles: {
            where: {
              Role: {
                Status: 'active',
                RoleKey: 'system_admin',
                SystemRoleCode: 'system_admin',
              },
            },
            select: { RoleId: true },
          },
        },
      });
    },
  );

  it('allows delegated metadata edits and self-scope creation but rejects broader creation', async () => {
    const { repository, transaction } = setup({ administrator: false });
    await repository.update({
      roleId: 7,
      patch: { description: '允许编辑' },
      audit,
    });
    expect(transaction.role.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { RoleDescription: '允许编辑' } }),
    );
    const role = { roleKey: 'reviewer', roleName: '审核员', description: null };
    await repository.create({ role: { ...role, dataScope: 'self' }, audit });
    transaction.role.create.mockClear();
    transaction.operationLog.create.mockClear();
    for (const dataScope of ['merchant', 'all'] as const) {
      await expect(
        repository.create({ role: { ...role, dataScope }, audit }),
      ).rejects.toBeInstanceOf(ManagementWriteAuthorizationError);
    }
    expect(transaction.role.create).not.toHaveBeenCalled();
    expect(transaction.operationLog.create).not.toHaveBeenCalled();
  });

  it('allows active administrators to change scope and audits the before/after snapshot', async () => {
    const { repository, transaction } = setup();
    await repository.update({ roleId: 7, patch: { dataScope: 'all' }, audit });
    expect(transaction.role.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { DataScope: 'all' } }),
    );
    expect(transaction.operationLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ActionKey: 'system:role:update',
        Metadata: {
          before: expect.objectContaining({ dataScope: 'merchant' }),
          after: expect.objectContaining({ dataScope: 'all' }),
        },
      }),
    });
  });

  it('rejects a disabled actor even when the transaction still finds an administrator role', async () => {
    const { repository, transaction } = setup({ actorStatus: 'disabled' });
    await expect(
      repository.update({ roleId: 7, patch: { dataScope: 'all' }, audit }),
    ).rejects.toBeInstanceOf(ManagementWriteAuthorizationError);
    expect(transaction.role.update).not.toHaveBeenCalled();
    expect(transaction.operationLog.create).not.toHaveBeenCalled();
  });
});
