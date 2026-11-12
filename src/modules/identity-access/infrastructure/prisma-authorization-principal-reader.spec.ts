import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';
import { PrismaAuthorizationPrincipalReader } from './prisma-authorization-principal-reader.js';

describe('PrismaAuthorizationPrincipalReader', () => {
  it('loads user, merchant profile, roles and permission records in one query', async () => {
    const findUnique = vi.fn().mockResolvedValue({
      UserId: 41,
      Status: 'active',
      MerchantProfile: { MerchantId: 12, Status: 'active' },
      UserRoles: [
        {
          Role: {
            RoleKey: 'merchant',
            Status: 'active',
            DataScope: 'merchant',
            DataScopes: [
              {
                ResourceKey: 'resort',
                ScopeType: 'selected',
                ScopeConfig: { selectedIds: [12, 13] },
              },
            ],
            RolePermissions: [
              {
                Permission: {
                  PermissionKey: 'resort:merchant:list',
                  Status: 'active',
                },
              },
            ],
          },
        },
      ],
    });
    const prisma = { user: { findUnique } } as unknown as PrismaService;
    const reader = new PrismaAuthorizationPrincipalReader(prisma);

    await expect(reader.findByUserId(41)).resolves.toEqual({
      userId: 41,
      status: 'active',
      merchant: { id: 12, status: 'active' },
      roles: [
        {
          key: 'merchant',
          status: 'active',
          dataScope: 'merchant',
          dataScopes: [
            {
              resourceKey: 'resort',
              scopeType: 'selected',
              scopeConfig: { selectedIds: [12, 13] },
            },
          ],
          permissions: [{ key: 'resort:merchant:list', status: 'active' }],
        },
      ],
    });
    expect(findUnique).toHaveBeenCalledOnce();
    expect(findUnique.mock.calls[0]?.[0]).toMatchObject({
      where: { UserId: 41 },
      select: {
        UserId: true,
        Status: true,
        MerchantProfile: { select: { MerchantId: true, Status: true } },
        UserRoles: {
          select: {
            Role: {
              select: {
                RoleKey: true,
                Status: true,
                DataScope: true,
                DataScopes: {
                  select: {
                    ResourceKey: true,
                    ScopeType: true,
                    ScopeConfig: true,
                  },
                },
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
      },
    });
  });

  it('returns null when the user does not exist', async () => {
    const prisma = {
      user: { findUnique: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const reader = new PrismaAuthorizationPrincipalReader(prisma);

    await expect(reader.findByUserId(999)).resolves.toBeNull();
  });
});
