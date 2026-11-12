import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { DataScope } from '../../identity-access/domain/data-scope.js';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';
import type {
  ManagedRole,
  ManagedRoleFilter,
  ManagedRolePage,
  RoleAuditContext,
} from '../domain/managed-role.js';
import type {
  CreateManagedRoleInput,
  UpdateManagedRoleInput,
} from '../domain/managed-role.js';
import type { ManagedRoleRepository } from '../application/ports/managed-role-repository.js';
import {
  ProtectedManagedRoleError,
  RegistrationRoleRequiredError,
} from '../application/role-management-errors.js';
import { authorizeRoleWrite } from './role-write-authorization.js';

@Injectable()
export class PrismaManagedRoleRepository implements ManagedRoleRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(filter: ManagedRoleFilter): Promise<ManagedRolePage> {
    const where: Prisma.RoleWhereInput = {
      ...(filter.roleIds ? { RoleId: { in: [...filter.roleIds] } } : {}),
      ...(filter.status ? { Status: filter.status } : {}),
      ...(filter.keyword
        ? {
            OR: [
              { RoleKey: { contains: filter.keyword, mode: 'insensitive' } },
              { RoleName: { contains: filter.keyword, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [roles, total] = await this.prisma.$transaction([
      this.prisma.role.findMany({
        where,
        include: managedRoleInclude,
        orderBy: [{ RoleId: 'asc' }],
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.role.count({ where }),
    ]);
    return { items: roles.map(mapManagedRole), total };
  }

  async findById(roleId: number): Promise<ManagedRole | null> {
    const role = await this.prisma.role.findUnique({
      where: { RoleId: roleId },
      include: managedRoleInclude,
    });
    return role ? mapManagedRole(role) : null;
  }

  async create(input: {
    role: CreateManagedRoleInput;
    audit: RoleAuditContext;
  }): Promise<ManagedRole> {
    return this.prisma.$transaction(
      async (transaction) => {
        const account = await authorizeRoleWrite(
          transaction,
          input.audit.actorUserId,
          ['system:role:create'],
          undefined,
          input.role.dataScope !== 'self',
        );
        const role = await transaction.role.create({
          data: {
            RoleKey: input.role.roleKey,
            RoleName: input.role.roleName.trim(),
            RoleDescription: normalizeDescription(input.role.description),
            DataScope: input.role.dataScope,
            Status: 'active',
          },
          include: managedRoleInclude,
        });
        const result = mapManagedRole(role);
        await writeRoleAudit(transaction, account, input.audit, {
          actionKey: 'system:role:create',
          targetId: role.RoleId,
          after: result,
        });
        return result;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async update(input: {
    roleId: number;
    patch: UpdateManagedRoleInput;
    audit: RoleAuditContext;
  }): Promise<ManagedRole | null> {
    return this.prisma.$transaction(
      async (transaction) => {
        const account = await authorizeRoleWrite(
          transaction,
          input.audit.actorUserId,
          ['system:role:update'],
          input.roleId,
          input.patch.dataScope !== undefined,
        );
        const current = await transaction.role.findUnique({
          where: { RoleId: input.roleId },
          include: managedRoleInclude,
        });
        if (!current) return null;
        assertMutable(current.SystemRoleCode, current.RoleKey);
        if (
          current.SystemRoleCode === 'registered_user' &&
          input.patch.status === 'disabled'
        ) {
          throw new RegistrationRoleRequiredError();
        }

        const data: Prisma.RoleUpdateInput = {
          ...(input.patch.roleKey !== undefined
            ? { RoleKey: input.patch.roleKey }
            : {}),
          ...(input.patch.roleName !== undefined
            ? { RoleName: input.patch.roleName.trim() }
            : {}),
          ...(input.patch.description !== undefined
            ? { RoleDescription: normalizeDescription(input.patch.description) }
            : {}),
          ...(input.patch.dataScope !== undefined
            ? { DataScope: input.patch.dataScope }
            : {}),
          ...(input.patch.status !== undefined
            ? { Status: input.patch.status }
            : {}),
        };
        const updated = await transaction.role.update({
          where: { RoleId: input.roleId },
          data,
          include: managedRoleInclude,
        });
        const before = mapManagedRole(current);
        const after = mapManagedRole(updated);
        await writeRoleAudit(transaction, account, input.audit, {
          actionKey: 'system:role:update',
          targetId: input.roleId,
          before,
          after,
        });
        return after;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async disable(input: {
    roleId: number;
    audit: RoleAuditContext;
  }): Promise<boolean> {
    return this.prisma.$transaction(
      async (transaction) => {
        const account = await authorizeRoleWrite(
          transaction,
          input.audit.actorUserId,
          ['system:role:delete'],
          input.roleId,
        );
        const current = await transaction.role.findUnique({
          where: { RoleId: input.roleId },
          include: managedRoleInclude,
        });
        if (!current) return false;
        assertMutable(current.SystemRoleCode, current.RoleKey);
        if (current.SystemRoleCode === 'registered_user') {
          throw new RegistrationRoleRequiredError();
        }

        const updated = await transaction.role.update({
          where: { RoleId: input.roleId },
          data: { Status: 'disabled' },
          include: managedRoleInclude,
        });
        await writeRoleAudit(transaction, account, input.audit, {
          actionKey: 'system:role:delete',
          targetId: input.roleId,
          before: mapManagedRole(current),
          after: mapManagedRole(updated),
        });
        return true;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}

const managedRoleInclude = {
  _count: {
    select: {
      UserRoles: true,
      RolePermissions: true,
      FieldPolicies: true,
    },
  },
  DataScopes: { select: { ResourceKey: true, ScopeType: true } },
} satisfies Prisma.RoleInclude;

type ManagedRoleRow = Prisma.RoleGetPayload<{
  include: typeof managedRoleInclude;
}>;

function mapManagedRole(role: ManagedRoleRow): ManagedRole {
  return {
    roleId: role.RoleId,
    roleKey: role.RoleKey,
    roleName: role.RoleName,
    description: role.RoleDescription,
    dataScope: role.DataScope as DataScope,
    status: role.Status as ManagedRole['status'],
    userCount: role._count.UserRoles,
    permissionCount: role._count.RolePermissions,
    fieldPolicyCount: role._count.FieldPolicies,
    dataScopes: role.DataScopes.map(({ ResourceKey, ScopeType }) => ({
      resourceKey: ResourceKey,
      scopeType: ScopeType,
    })).sort((left, right) =>
      left.resourceKey.localeCompare(right.resourceKey),
    ),
  };
}

function assertMutable(systemRoleCode: string | null, roleKey: string): void {
  if (systemRoleCode === 'system_admin' || roleKey === 'system_admin') {
    throw new ProtectedManagedRoleError();
  }
}

function normalizeDescription(description: string | null): string | null {
  const normalized = description?.trim() ?? '';
  return normalized.length > 0 ? normalized : null;
}

async function writeRoleAudit(
  transaction: Prisma.TransactionClient,
  actorAccount: string,
  audit: RoleAuditContext,
  input: {
    actionKey: string;
    targetId: number;
    before?: ManagedRole;
    after: ManagedRole;
  },
): Promise<void> {
  const metadata: Prisma.InputJsonObject = {
    ...(input.before ? { before: input.before } : {}),
    after: input.after,
  } as unknown as Prisma.InputJsonObject;
  await transaction.operationLog.create({
    data: {
      ActorUserId: audit.actorUserId,
      ActorAccountSnapshot: actorAccount,
      ActionKey: input.actionKey,
      ResourceKey: 'system:role',
      TargetType: 'Role',
      TargetId: String(input.targetId),
      Result: 'success',
      TraceId: audit.traceId,
      ClientIp: audit.clientIp,
      UserAgent: audit.userAgent,
      Metadata: metadata,
    },
  });
}
