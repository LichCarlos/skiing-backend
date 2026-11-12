import { Inject, Injectable } from '@nestjs/common';
import {
  avatarAssetSelect,
  resolveAvatarUrl,
} from '../../assets/application/avatar-url.js';
import {
  ASSET_STORAGE,
  type AssetStorage,
} from '../../assets/application/ports/asset-storage.js';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';
import type {
  AuthenticationIdentityRecord,
  AuthenticationRepository,
} from '../application/ports/authentication-repository.js';
import type {
  AuthSessionRepository,
  CreateAuthSessionRecord,
  RefreshRotationResult,
} from '../application/ports/auth-session-repository.js';

const identityProfileSelect = {
  UserId: true,
  Account: true,
  Nickname: true,
  Avatar: true,
  AvatarAsset: avatarAssetSelect,
  Status: true,
  MerchantProfile: {
    select: { MerchantId: true, BusinessName: true, Status: true },
  },
  UserRoles: {
    select: {
      Role: {
        select: {
          RoleKey: true,
          RoleName: true,
          Status: true,
          RolePermissions: {
            select: {
              Permission: {
                select: { PermissionKey: true, Status: true },
              },
            },
          },
        },
      },
    },
  },
} as const;

const identitySelect = {
  ...identityProfileSelect,
  PasswordHash: true,
} as const;

@Injectable()
export class PrismaAuthenticationRepository
  implements AuthenticationRepository, AuthSessionRepository
{
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ASSET_STORAGE) private readonly storage: AssetStorage,
  ) {}

  async findByAccount(
    account: string,
  ): Promise<AuthenticationIdentityRecord | null> {
    const user = await this.prisma.user.findUnique({
      where: { Account: account },
      select: identitySelect,
    });
    return user
      ? mapIdentity(user, await resolveAvatarUrl(this.storage, user))
      : null;
  }

  async findByUserId(
    userId: number,
  ): Promise<AuthenticationIdentityRecord | null> {
    const user = await this.prisma.user.findUnique({
      where: { UserId: userId },
      select: identityProfileSelect,
    });
    return user
      ? mapIdentity(user, await resolveAvatarUrl(this.storage, user))
      : null;
  }

  async create(input: CreateAuthSessionRecord): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      // A conditional no-op UPDATE both locks and versions the user row. A
      // reset with an older serializable snapshot must conflict, not miss a
      // session created after that snapshot. Recheck the verified credential.
      const current = await transaction.user.updateMany({
        where: {
          UserId: input.userId,
          Status: 'active',
          PasswordHash: input.expectedPasswordHash,
        },
        data: { PasswordHash: input.expectedPasswordHash },
      });
      if (current.count !== 1) return false;
      await transaction.authSession.create({
        data: {
          SessionId: input.sessionId,
          UserId: input.userId,
          ExpiresAt: input.expiresAt,
          CreateTime: input.now,
          RefreshTokens: {
            create: {
              TokenHash: input.refreshTokenHash,
              ExpiresAt: input.expiresAt,
              CreateTime: input.now,
            },
          },
        },
      });
      return true;
    });
  }

  async isActive(input: {
    sessionId: string;
    userId: number;
    now: Date;
  }): Promise<boolean> {
    const session = await this.prisma.authSession.findFirst({
      where: {
        SessionId: input.sessionId,
        UserId: input.userId,
        RevokedAt: null,
        ExpiresAt: { gt: input.now },
      },
      select: { SessionId: true },
    });
    return session !== null;
  }

  async rotateRefreshToken(input: {
    currentTokenHash: string;
    replacementTokenHash: string;
    now: Date;
  }): Promise<RefreshRotationResult> {
    return this.prisma.$transaction(async (transaction) => {
      const token = await transaction.authRefreshToken.findUnique({
        where: { TokenHash: input.currentTokenHash },
        select: {
          RefreshTokenId: true,
          ConsumedAt: true,
          ExpiresAt: true,
          SessionId: true,
          Session: {
            select: {
              UserId: true,
              ExpiresAt: true,
              RevokedAt: true,
            },
          },
        },
      });
      if (!token) return { status: 'invalid' };

      if (token.ConsumedAt) {
        await transaction.authSession.updateMany({
          where: { SessionId: token.SessionId, RevokedAt: null },
          data: { RevokedAt: input.now },
        });
        return { status: 'reused' };
      }

      if (
        token.Session.RevokedAt ||
        token.ExpiresAt <= input.now ||
        token.Session.ExpiresAt <= input.now
      ) {
        return { status: 'invalid' };
      }

      const sessionStillActive = await transaction.authSession.updateMany({
        where: {
          SessionId: token.SessionId,
          RevokedAt: null,
          ExpiresAt: { gt: input.now },
        },
        data: { RevokedAt: null },
      });
      if (sessionStillActive.count !== 1) return { status: 'invalid' };

      const consumed = await transaction.authRefreshToken.updateMany({
        where: {
          RefreshTokenId: token.RefreshTokenId,
          ConsumedAt: null,
          ExpiresAt: { gt: input.now },
        },
        data: { ConsumedAt: input.now },
      });
      if (consumed.count !== 1) {
        await transaction.authSession.updateMany({
          where: { SessionId: token.SessionId, RevokedAt: null },
          data: { RevokedAt: input.now },
        });
        return { status: 'reused' };
      }

      await transaction.authRefreshToken.create({
        data: {
          SessionId: token.SessionId,
          TokenHash: input.replacementTokenHash,
          ExpiresAt: token.Session.ExpiresAt,
          CreateTime: input.now,
        },
      });
      return {
        status: 'rotated',
        sessionId: token.SessionId,
        userId: token.Session.UserId,
        expiresAt: token.Session.ExpiresAt,
      };
    });
  }

  async revokeByRefreshTokenHash(tokenHash: string, now: Date): Promise<void> {
    const token = await this.prisma.authRefreshToken.findUnique({
      where: { TokenHash: tokenHash },
      select: { SessionId: true },
    });
    if (!token) return;
    await this.revokeSession(token.SessionId, now);
  }

  async revokeSession(sessionId: string, now: Date): Promise<void> {
    await this.prisma.authSession.updateMany({
      where: { SessionId: sessionId, RevokedAt: null },
      data: { RevokedAt: now },
    });
  }
}

function mapIdentity(
  user: {
    UserId: number;
    Account: string;
    PasswordHash?: string;
    Nickname: string;
    Avatar: string | null;
    Status: string;
    MerchantProfile: {
      MerchantId: number;
      BusinessName: string;
      Status: string;
    } | null;
    UserRoles: Array<{
      Role: {
        RoleKey: string;
        RoleName: string;
        Status: string;
        RolePermissions: Array<{
          Permission: { PermissionKey: string; Status: string };
        }>;
      };
    }>;
  },
  avatarUrl: string | null,
): AuthenticationIdentityRecord {
  return {
    userId: user.UserId,
    account: user.Account,
    nickname: user.Nickname,
    avatarUrl,
    status: user.Status,
    passwordHash: user.PasswordHash ?? null,
    merchant: user.MerchantProfile
      ? {
          id: user.MerchantProfile.MerchantId,
          businessName: user.MerchantProfile.BusinessName,
          status: user.MerchantProfile.Status,
        }
      : null,
    roles: user.UserRoles.map(({ Role }) => ({
      key: Role.RoleKey,
      name: Role.RoleName,
      status: Role.Status,
      permissionKeys: Role.RolePermissions.map(({ Permission }) => ({
        key: Permission.PermissionKey,
        status: Permission.Status,
      })),
    })),
  };
}
