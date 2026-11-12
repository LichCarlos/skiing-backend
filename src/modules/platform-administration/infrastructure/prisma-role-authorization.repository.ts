import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';
import type {
  ReplaceRoleAuthorizationInput,
  RoleAuthorizationRepository,
  RoleAuthorizationSnapshot,
} from '../application/ports/role-authorization-repository.js';
import {
  InvalidRoleAuthorizationReferenceError,
  ProtectedSystemRoleError,
} from '../application/role-authorization-errors.js';
import {
  invalidResourceScopeChanges,
  type RoleAuthorizationDataScope,
  type RoleAuthorizationInput,
} from '../domain/role-authorization.js';
import { authorizeRoleWrite } from './role-write-authorization.js';

@Injectable()
export class PrismaRoleAuthorizationRepository implements RoleAuthorizationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findSnapshot(
    roleId: number,
  ): Promise<RoleAuthorizationSnapshot | null> {
    const role = await this.prisma.role.findUnique({
      where: { RoleId: roleId },
      include: authorizationInclude,
    });
    return role ? mapSnapshot(role) : null;
  }

  async replaceAuthorization(
    input: ReplaceRoleAuthorizationInput,
  ): Promise<RoleAuthorizationSnapshot | null> {
    return this.prisma.$transaction(
      async (transaction) => {
        const account = await authorizeRoleWrite(
          transaction,
          input.audit.actorUserId,
          ['system:role:update', 'system:permission:assign'],
          input.roleId,
          true,
        );
        const role = await transaction.role.findUnique({
          where: { RoleId: input.roleId },
          include: authorizationInclude,
        });
        if (!role) return null;
        if (
          role.SystemRoleCode === 'system_admin' ||
          role.RoleKey === 'system_admin'
        ) {
          throw new ProtectedSystemRoleError();
        }

        const before = mapSnapshot(role);
        if (
          invalidResourceScopeChanges(
            input.authorization.dataScopes,
            before.dataScopes,
          ).length
        ) {
          throw new InvalidRoleAuthorizationReferenceError(
            'Unknown resource scopes may only be retained unchanged or removed',
          );
        }
        await this.assertReferencesExist(transaction, input.authorization);
        await transaction.rolePermission.deleteMany({
          where: { RoleId: input.roleId },
        });
        await transaction.roleDataScope.deleteMany({
          where: { RoleId: input.roleId },
        });
        await transaction.roleFieldPermission.deleteMany({
          where: { RoleId: input.roleId },
        });

        if (input.authorization.permissionIds.length > 0) {
          await transaction.rolePermission.createMany({
            data: input.authorization.permissionIds.map((permissionId) => ({
              RoleId: input.roleId,
              PermissionId: permissionId,
            })),
          });
        }
        if (input.authorization.dataScopes.length > 0) {
          await transaction.roleDataScope.createMany({
            data: input.authorization.dataScopes.map((scope) => ({
              RoleId: input.roleId,
              ResourceKey: scope.resourceKey,
              ScopeType: scope.scopeType,
              ScopeConfig:
                scope.scopeType === 'selected'
                  ? ({
                      selectedIds: scope.selectedIds,
                    } satisfies Prisma.InputJsonValue)
                  : Prisma.DbNull,
            })),
          });
        }
        if (input.authorization.fieldPolicies.length > 0) {
          await transaction.roleFieldPermission.createMany({
            data: input.authorization.fieldPolicies.map((policy) => ({
              RoleId: input.roleId,
              EntityType: policy.entityType,
              FieldKey: policy.fieldKey,
              CanRead: policy.canRead,
              CanWrite: policy.canWrite,
            })),
          });
        }

        const after: RoleAuthorizationSnapshot = {
          roleId: input.roleId,
          roleKey: role.RoleKey,
          roleName: role.RoleName,
          status: role.Status,
          permissionIds: [...input.authorization.permissionIds].sort(
            (a, b) => a - b,
          ),
          dataScopes: input.authorization.dataScopes
            .map(normalizeScope)
            .sort((a, b) => a.resourceKey.localeCompare(b.resourceKey)),
          fieldPolicies: [...input.authorization.fieldPolicies].sort(
            compareFieldPolicy,
          ),
        };
        await transaction.operationLog.create({
          data: {
            ActorUserId: input.audit.actorUserId,
            ActorAccountSnapshot: account,
            ActionKey: 'system:permission:assign',
            ResourceKey: 'system:role',
            TargetType: 'Role',
            TargetId: String(input.roleId),
            Result: 'success',
            TraceId: input.audit.traceId,
            ClientIp: input.audit.clientIp,
            UserAgent: input.audit.userAgent,
            Metadata: { before, after } as unknown as Prisma.InputJsonValue,
          },
        });
        return after;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async assertReferencesExist(
    transaction: Prisma.TransactionClient,
    authorization: RoleAuthorizationInput,
  ): Promise<void> {
    if (authorization.permissionIds.length > 0) {
      const activePermissions = await transaction.permission.findMany({
        where: {
          PermissionId: { in: [...authorization.permissionIds] },
          Status: 'active',
        },
        select: { PermissionId: true },
      });
      if (activePermissions.length !== authorization.permissionIds.length) {
        throw new InvalidRoleAuthorizationReferenceError(
          'Every permission must exist and be active',
        );
      }
    }
    if (authorization.fieldPolicies.length > 0) {
      const definitions = await transaction.customFieldDefinition.findMany({
        where: {
          OR: authorization.fieldPolicies.map(({ entityType, fieldKey }) => ({
            EntityType: entityType,
            FieldKey: fieldKey,
          })),
        },
        select: { EntityType: true, FieldKey: true },
      });
      if (definitions.length !== authorization.fieldPolicies.length) {
        throw new InvalidRoleAuthorizationReferenceError(
          'Every field policy must reference an existing field',
        );
      }
    }
  }
}

const authorizationInclude = {
  RolePermissions: { select: { PermissionId: true } },
  DataScopes: {
    select: { ResourceKey: true, ScopeType: true, ScopeConfig: true },
  },
  FieldPolicies: {
    select: {
      EntityType: true,
      FieldKey: true,
      CanRead: true,
      CanWrite: true,
    },
  },
} satisfies Prisma.RoleInclude;

function mapSnapshot(
  role: Prisma.RoleGetPayload<{ include: typeof authorizationInclude }>,
): RoleAuthorizationSnapshot {
  return {
    roleId: role.RoleId,
    roleKey: role.RoleKey,
    roleName: role.RoleName,
    status: role.Status,
    permissionIds: role.RolePermissions.map(
      ({ PermissionId }) => PermissionId,
    ).sort((a, b) => a - b),
    dataScopes: role.DataScopes.map((scope) => ({
      resourceKey: scope.ResourceKey,
      scopeType: scope.ScopeType as RoleAuthorizationDataScope['scopeType'],
      ...(scope.ScopeType === 'selected'
        ? { selectedIds: readSelectedIds(scope.ScopeConfig) }
        : {}),
    })).sort((a, b) => a.resourceKey.localeCompare(b.resourceKey)),
    fieldPolicies: role.FieldPolicies.map((policy) => ({
      entityType: policy.EntityType,
      fieldKey: policy.FieldKey,
      canRead: policy.CanRead,
      canWrite: policy.CanWrite,
    })).sort(compareFieldPolicy),
  };
}

function readSelectedIds(config: Prisma.JsonValue | null): number[] {
  if (
    !config ||
    typeof config !== 'object' ||
    Array.isArray(config) ||
    !('selectedIds' in config) ||
    !Array.isArray(config.selectedIds) ||
    !config.selectedIds.every(
      (id) => Number.isSafeInteger(id) && typeof id === 'number' && id > 0,
    )
  ) {
    throw new Error('Stored selected data scope configuration is invalid');
  }
  const selectedIds = config.selectedIds;
  if (
    !selectedIds.every(
      (id): id is number =>
        typeof id === 'number' && Number.isSafeInteger(id) && id > 0,
    )
  ) {
    throw new Error('Stored selected data scope configuration is invalid');
  }
  return [...selectedIds].sort((a, b) => a - b);
}

function normalizeScope(
  scope: RoleAuthorizationDataScope,
): RoleAuthorizationDataScope {
  return {
    resourceKey: scope.resourceKey,
    scopeType: scope.scopeType,
    ...(scope.scopeType === 'selected'
      ? { selectedIds: [...(scope.selectedIds ?? [])].sort((a, b) => a - b) }
      : {}),
  };
}

function compareFieldPolicy(
  left: { entityType: string; fieldKey: string },
  right: { entityType: string; fieldKey: string },
): number {
  return (
    left.entityType.localeCompare(right.entityType) ||
    left.fieldKey.localeCompare(right.fieldKey)
  );
}
