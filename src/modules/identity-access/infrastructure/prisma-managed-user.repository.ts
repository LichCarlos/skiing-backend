import { appendOutboxEvent } from '../../integration-events/infrastructure/append-outbox-event.js';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';
import {
  ManagedUserConflictError,
  ManagedUserInputError,
} from '../application/manage-users.js';
import type {
  ManagedUser,
  ManagedUserRepository,
  UserManagementAudit,
} from '../application/ports/managed-user-repository.js';
import type { ResolvedDataScope } from '../domain/authorization.js';
import {
  mayDeactivateUser,
  validateUserRoleAssignment,
} from '../domain/managed-user.js';
import { authorizeUserWrite } from './user-write-authorization.js';
import { ManagementWriteAuthorizationError } from '../domain/management-write-authorization.js';

@Injectable()
export class PrismaManagedUserRepository implements ManagedUserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(input: {
    page: number;
    pageSize: number;
    keyword?: string;
    status?: 'active' | 'disabled';
    scope: ResolvedDataScope;
  }) {
    const where: Prisma.UserWhereInput = {
      ...scopeWhere(input.scope),
      ...(input.status ? { Status: input.status } : {}),
      ...(input.keyword
        ? {
            OR: [
              { Account: { contains: input.keyword, mode: 'insensitive' } },
              { Nickname: { contains: input.keyword, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [records, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        include: managedUserInclude,
        orderBy: [{ CreateTime: 'desc' }, { UserId: 'desc' }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items: records.map(mapManagedUser), total };
  }

  async findById(
    userId: number,
    scope: ResolvedDataScope,
  ): Promise<ManagedUser | null> {
    const record = await this.prisma.user.findFirst({
      where: { AND: [{ UserId: userId }, scopeWhere(scope)] },
      include: managedUserInclude,
    });
    return record ? mapManagedUser(record) : null;
  }

  async create(input: {
    account: string;
    nickname: string;
    passwordHash: string;
    roleIds: readonly number[];
    audit: UserManagementAudit;
  }): Promise<ManagedUser> {
    try {
      return await this.prisma.$transaction(
        async (transaction) => {
          await lockSystemAdminRole(transaction);
          const actor = await authorizeUserWrite(
            transaction,
            input.audit.actorUserId,
            'system:user:create',
          );
          const roleIds = await resolveCreateRoleIds(
            transaction,
            input.roleIds,
          );
          const roles = await findRoles(transaction, roleIds);
          assertRoleAssignment({
            requestedRoleIds: roleIds,
            roles,
            actorIsSystemAdmin: actor.isSystemAdmin,
          });

          const record = await transaction.user.create({
            data: {
              Account: input.account,
              Nickname: input.nickname,
              PasswordHash: input.passwordHash,
              UserRoles: { create: roleIds.map((RoleId) => ({ RoleId })) },
            },
            include: managedUserInclude,
          });
          const result = mapManagedUser(record);
          await writeAudit(transaction, actor.account, input.audit, {
            actionKey: 'system:user:create',
            targetId: record.UserId,
            after: result,
          });
          return result;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (getPrismaErrorCode(error) === 'P2002') {
        throw new ManagedUserConflictError('Account already exists');
      }
      if (getPrismaErrorCode(error) === 'P2003') {
        throw new ManagedUserInputError('One or more role IDs are invalid');
      }
      throw error;
    }
  }

  async replaceRoles(input: {
    userId: number;
    roleIds: readonly number[];
    audit: UserManagementAudit;
  }): Promise<ManagedUser | null> {
    return this.prisma.$transaction(
      async (transaction) => {
        await lockSystemAdminRole(transaction);
        const actor = await authorizeUserWrite(
          transaction,
          input.audit.actorUserId,
          'system:user:assign-role',
        );
        const current = await transaction.user.findFirst({
          where: { AND: [{ UserId: input.userId }, scopeWhere(actor.scope)] },
          include: managedUserInclude,
        });
        if (!current) return null;

        const roles = await findRoles(transaction, input.roleIds);
        const currentRoles = current.UserRoles.map(({ Role }) => Role);
        const isActiveSystemAdmin =
          current.Status === 'active' &&
          currentRoles.some(
            (role) =>
              role.Status === 'active' &&
              role.SystemRoleCode === 'system_admin',
          );
        const activeAdminCount = isActiveSystemAdmin
          ? await countActiveSystemAdmins(transaction)
          : undefined;
        assertRoleAssignment({
          requestedRoleIds: input.roleIds,
          currentRoleCodes: currentRoles
            .filter(({ Status }) => Status === 'active')
            .map(({ SystemRoleCode }) => SystemRoleCode ?? ''),
          targetIsActiveSystemAdmin: isActiveSystemAdmin,
          activeSystemAdminCount: activeAdminCount,
          roles,
          actorIsSystemAdmin: actor.isSystemAdmin,
        });

        await transaction.userRole.deleteMany({
          where: { UserId: input.userId },
        });
        if (input.roleIds.length > 0) {
          await transaction.userRole.createMany({
            data: input.roleIds.map((RoleId) => ({
              UserId: input.userId,
              RoleId,
            })),
          });
        }
        const updated = await transaction.user.findFirstOrThrow({
          where: { UserId: input.userId },
          include: managedUserInclude,
        });
        const before = mapManagedUser(current);
        const after = mapManagedUser(updated);
        await writeAudit(transaction, actor.account, input.audit, {
          actionKey: 'system:user:assign-role',
          targetId: input.userId,
          before,
          after,
        });
        return after;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async setStatus(input: {
    userId: number;
    status: 'active' | 'disabled';
    audit: UserManagementAudit;
  }): Promise<ManagedUser | null> {
    return this.prisma.$transaction(
      async (transaction) => {
        await lockSystemAdminRole(transaction);
        const actor = await authorizeUserWrite(
          transaction,
          input.audit.actorUserId,
          'system:user:update',
        );
        const current = await transaction.user.findFirst({
          where: { AND: [{ UserId: input.userId }, scopeWhere(actor.scope)] },
          include: managedUserInclude,
        });
        if (!current) return null;

        const isActiveSystemAdmin =
          current.Status === 'active' &&
          current.UserRoles.some(
            ({ Role }) =>
              Role.Status === 'active' &&
              Role.SystemRoleCode === 'system_admin',
          );
        if (
          input.status === 'disabled' &&
          isActiveSystemAdmin &&
          !mayDeactivateUser({
            targetIsActiveSystemAdmin: true,
            activeSystemAdminCount: await countActiveSystemAdmins(transaction),
          })
        ) {
          throw new ManagedUserConflictError(
            'The last active system administrator cannot be disabled',
          );
        }

        const updated = await transaction.user.update({
          where: { UserId: input.userId },
          data: { Status: input.status },
          include: managedUserInclude,
        });
        const before = mapManagedUser(current);
        const after = mapManagedUser(updated);
        if (current.Status !== input.status)
          await appendOutboxEvent(transaction, {
            eventType: 'rag.dependencies.changed.v1',
            aggregateType: 'UserDependents',
            aggregateId: String(input.userId),
            payload: {
              entityType: 'dynamic',
              authorId: input.userId,
              afterId: 0,
            },
          });
        await writeAudit(transaction, actor.account, input.audit, {
          actionKey: 'system:user:update',
          targetId: input.userId,
          before,
          after,
        });
        return after;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}

const managedUserInclude = {
  UserRoles: {
    include: {
      Role: {
        select: {
          RoleId: true,
          RoleKey: true,
          RoleName: true,
          SystemRoleCode: true,
          Status: true,
        },
      },
    },
  },
  MerchantProfile: {
    select: { MerchantId: true, BusinessName: true, Status: true },
  },
} as const;

type ManagedUserRecord = Prisma.UserGetPayload<{
  include: typeof managedUserInclude;
}>;

export function scopeWhere(scope: ResolvedDataScope): Prisma.UserWhereInput {
  if (scope.kind === 'all') return {};
  if (scope.kind === 'self') return { UserId: scope.userId };
  if (scope.kind === 'selected') return { UserId: { in: [...scope.ids] } };
  return { MerchantProfile: { is: { MerchantId: scope.merchantId } } };
}

function mapManagedUser(record: ManagedUserRecord): ManagedUser {
  return {
    userId: record.UserId,
    account: record.Account,
    nickname: record.Nickname,
    status: record.Status === 'disabled' ? 'disabled' : 'active',
    roles: record.UserRoles.map(({ Role }) => ({
      roleId: Role.RoleId,
      roleKey: Role.RoleKey,
      roleName: Role.RoleName,
      systemRoleCode: Role.SystemRoleCode,
      status: Role.Status,
    })),
    merchant: record.MerchantProfile
      ? {
          merchantId: record.MerchantProfile.MerchantId,
          businessName: record.MerchantProfile.BusinessName,
          status: record.MerchantProfile.Status,
        }
      : null,
    createdAt: record.CreateTime,
  };
}

async function resolveCreateRoleIds(
  transaction: Prisma.TransactionClient,
  roleIds: readonly number[],
): Promise<number[]> {
  if (roleIds.length > 0) return [...new Set(roleIds)];
  const role = await transaction.role.findUnique({
    where: { SystemRoleCode: 'registered_user' },
    select: { RoleId: true, Status: true },
  });
  if (!role || role.Status !== 'active') {
    throw new ManagedUserInputError('The registered-user role is unavailable');
  }
  return [role.RoleId];
}

async function findRoles(
  transaction: Prisma.TransactionClient,
  roleIds: readonly number[],
) {
  if (roleIds.length === 0) return [];
  return transaction.role
    .findMany({
      where: { RoleId: { in: [...new Set(roleIds)] } },
      select: {
        RoleId: true,
        Status: true,
        SystemRoleCode: true,
      },
    })
    .then((records) =>
      records.map((role) => ({
        roleId: role.RoleId,
        status: role.Status,
        systemRoleCode: role.SystemRoleCode,
      })),
    );
}

function assertRoleAssignment(input: {
  requestedRoleIds: readonly number[];
  roles: Awaited<ReturnType<typeof findRoles>>;
  actorIsSystemAdmin: boolean;
  currentRoleCodes?: readonly string[];
  targetIsActiveSystemAdmin?: boolean;
  activeSystemAdminCount?: number;
}): void {
  const issues = validateUserRoleAssignment(input);
  if (issues.length > 0) {
    const issue = issues[0]!.code;
    if (issue === 'system_admin_grant_forbidden') {
      throw new ManagementWriteAuthorizationError(
        'Only system_admin may grant system_admin',
      );
    }
    if (issue === 'last_system_admin_protected') {
      throw new ManagedUserConflictError(
        'The last active system administrator cannot lose the role',
      );
    }
    throw new ManagedUserInputError(`Role assignment is invalid: ${issue}`);
  }
}

async function lockSystemAdminRole(
  transaction: Prisma.TransactionClient,
): Promise<void> {
  await transaction.$queryRaw<Array<{ RoleId: number }>>`
    SELECT "RoleId" FROM "Role"
    WHERE "SystemRoleCode" = 'system_admin'
    FOR UPDATE
  `;
}

async function countActiveSystemAdmins(
  transaction: Prisma.TransactionClient,
): Promise<number> {
  return transaction.user.count({
    where: {
      Status: 'active',
      UserRoles: {
        some: {
          Role: { SystemRoleCode: 'system_admin', Status: 'active' },
        },
      },
    },
  });
}

async function writeAudit(
  transaction: Prisma.TransactionClient,
  actorAccount: string,
  audit: UserManagementAudit,
  input: {
    actionKey: string;
    targetId: number;
    before?: ManagedUser;
    after: ManagedUser;
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
      ResourceKey: 'system:user',
      TargetType: 'User',
      TargetId: String(input.targetId),
      Result: 'success',
      TraceId: audit.traceId,
      ClientIp: audit.clientIp,
      UserAgent: audit.userAgent,
      Metadata: metadata,
    },
  });
}

function getPrismaErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}
