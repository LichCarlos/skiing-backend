import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';
import type {
  AuthorizationPrincipalReader,
  AuthorizationPrincipalRecord,
} from '../application/ports/authorization-principal-reader.js';

@Injectable()
export class PrismaAuthorizationPrincipalReader implements AuthorizationPrincipalReader {
  constructor(
    @Inject(PrismaService) private readonly prisma: Pick<PrismaService, 'user'>,
  ) {}

  async findByUserId(
    userId: number,
  ): Promise<AuthorizationPrincipalRecord | null> {
    const user = await this.prisma.user.findUnique({
      where: { UserId: userId },
      select: {
        UserId: true,
        Status: true,
        MerchantProfile: {
          select: { MerchantId: true, Status: true },
        },
        UserRoles: {
          select: {
            Role: {
              select: {
                RoleKey: true,
                Status: true,
                DataScope: true,
                RolePermissions: {
                  select: {
                    Permission: {
                      select: { PermissionKey: true, Status: true },
                    },
                  },
                },
                DataScopes: {
                  select: {
                    ResourceKey: true,
                    ScopeType: true,
                    ScopeConfig: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!user) return null;

    return {
      userId: user.UserId,
      status: user.Status,
      merchant: user.MerchantProfile
        ? {
            id: user.MerchantProfile.MerchantId,
            status: user.MerchantProfile.Status,
          }
        : null,
      roles: user.UserRoles.map(({ Role }) => ({
        key: Role.RoleKey,
        status: Role.Status,
        dataScope: Role.DataScope,
        dataScopes: Role.DataScopes.map((scope) => ({
          resourceKey: scope.ResourceKey,
          scopeType: scope.ScopeType,
          scopeConfig: scope.ScopeConfig,
        })),
        permissions: Role.RolePermissions.map(({ Permission }) => ({
          key: Permission.PermissionKey,
          status: Permission.Status,
        })),
      })),
    };
  }
}
