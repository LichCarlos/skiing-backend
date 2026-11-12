import { appendOutboxEvent } from '../../integration-events/infrastructure/append-outbox-event.js';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';
import {
  hasPermission,
  type AuthorizationPrincipal,
} from '../domain/authorization.js';
import { avatarAssetSelect } from '../../assets/application/avatar-url.js';
import {
  InvalidAvatarAssetError,
  ProfileAccessDeniedError,
  ProfileConflictError,
  type UserProfileRepository,
} from '../application/ports/user-profile-repository.js';

@Injectable()
export class PrismaUserProfileRepository implements UserProfileRepository {
  constructor(private readonly prisma: PrismaService) {}
  async updateOwn(
    userId: number,
    patch: Parameters<UserProfileRepository['updateOwn']>[1],
    audit: Parameters<UserProfileRepository['updateOwn']>[2],
  ) {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const before = await tx.user.findUnique({
            where: { UserId: userId },
            select: {
              UserId: true,
              Account: true,
              Nickname: true,
              AvatarAssetId: true,
              Status: true,
              UserRoles: {
                select: {
                  Role: {
                    select: {
                      RoleKey: true,
                      Status: true,
                      RolePermissions: {
                        where: { Permission: { Status: 'active' } },
                        select: {
                          Permission: { select: { PermissionKey: true } },
                        },
                      },
                    },
                  },
                },
              },
            },
          });
          const principal: AuthorizationPrincipal | null = before
            ? {
                userId,
                active: before.Status === 'active',
                merchantId: null,
                roles: before.UserRoles.map(({ Role }) => ({
                  roleKey: Role.RoleKey,
                  active: Role.Status === 'active',
                  dataScope: 'self',
                  permissionKeys: Role.RolePermissions.map(
                    ({ Permission }) => Permission.PermissionKey,
                  ),
                })),
              }
            : null;
          if (!hasPermission(principal, 'account:profile:update'))
            throw new ProfileAccessDeniedError();
          if (
            patch.avatarAssetId !== undefined &&
            patch.avatarAssetId !== null
          ) {
            // A row lock serializes avatar assignment against both soft and physical asset deletion.
            const rows = await tx.$queryRaw<
              { OwnerUserId: number; Status: string; MimeType: string }[]
            >`SELECT "OwnerUserId", "Status", "MimeType" FROM "Asset" WHERE "AssetId" = ${BigInt(patch.avatarAssetId)} FOR UPDATE`;
            const asset = rows[0];
            if (
              !asset ||
              asset.OwnerUserId !== userId ||
              asset.Status !== 'ready' ||
              !['image/jpeg', 'image/png', 'image/webp'].includes(
                asset.MimeType,
              )
            )
              throw new InvalidAvatarAssetError();
          }
          const result = await tx.user.update({
            where: { UserId: userId },
            data: {
              ...(patch.nickname !== undefined
                ? { Nickname: patch.nickname }
                : {}),
              ...(patch.avatarAssetId !== undefined
                ? {
                    AvatarAssetId:
                      patch.avatarAssetId === null
                        ? null
                        : BigInt(patch.avatarAssetId),
                    Avatar: null,
                  }
                : {}),
            },
            select: {
              UserId: true,
              Account: true,
              Nickname: true,
              Avatar: true,
              AvatarAssetId: true,
              AvatarAsset: avatarAssetSelect,
            },
          });
          await tx.operationLog.create({
            data: {
              ActorUserId: userId,
              ActorAccountSnapshot: result.Account,
              ActionKey: 'account:profile:update',
              ResourceKey: 'user',
              TargetType: 'User',
              TargetId: String(userId),
              Result: 'success',
              TraceId: audit.traceId,
              ClientIp: audit.clientIp,
              UserAgent: audit.userAgent,
              Metadata: {
                fields: Object.keys(patch).filter(
                  (key) => patch[key as keyof typeof patch] !== undefined,
                ),
              },
            },
          });
          if (
            patch.nickname !== undefined &&
            result.Nickname !== before?.Nickname
          )
            await appendOutboxEvent(tx, {
              eventType: 'rag.dependencies.changed.v1',
              aggregateType: 'UserDependents',
              aggregateId: String(userId),
              payload: { entityType: 'dynamic', authorId: userId, afterId: 0 },
            });
          const asset = result.AvatarAsset;
          return {
            userId: result.UserId,
            account: result.Account,
            nickname: result.Nickname,
            avatarAssetId: result.AvatarAssetId?.toString() ?? null,
            legacyAvatar: result.Avatar,
            avatarStorageKey:
              asset?.Status === 'ready' &&
              asset.OwnerUserId === userId &&
              ['image/jpeg', 'image/png', 'image/webp'].includes(asset.MimeType)
                ? asset.StorageKey
                : null,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (['P2034', 'P2003'].includes(error.code) ||
          (error.code === 'P2010' &&
            ['40001', '40P01'].includes(String(error.meta?.code))))
      )
        throw new ProfileConflictError();
      throw error;
    }
  }
}
