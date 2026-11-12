import type { Prisma } from '@prisma/client';
import {
  authorizeAdminAssetDeletion,
  authorizeAdminAssetRead,
} from './admin-asset-authorization.js';
import type { AdminAssetAccess } from '../domain/admin-asset-access.js';

function setup() {
  const role = {
    RoleKey: 'asset_manager',
    Status: 'active',
    DataScope: 'all',
    DataScopes: [] as Array<{
      ResourceKey: string;
      ScopeType: string;
      ScopeConfig: unknown;
    }>,
    RolePermissions: ['management:portal:enter', 'content:asset:delete'].map(
      (PermissionKey) => ({ Permission: { PermissionKey, Status: 'active' } }),
    ),
  };
  const user = {
    UserId: 8,
    Status: 'active',
    MerchantProfile: null,
    UserRoles: [{ Role: role }],
  };
  const findUnique = vi.fn().mockResolvedValue(user);
  return {
    role,
    user,
    findUnique,
    tx: { user: { findUnique } } as unknown as Prisma.TransactionClient,
  };
}
describe('Admin asset transactional deletion authorization', () => {
  it('requires a read grant independently of deletion', async () => {
    const s = setup();
    await expect(
      authorizeAdminAssetRead(s.tx, 8, { kind: 'all' }),
    ).rejects.toMatchObject({ status: 403 });
    s.role.RolePermissions[1]!.Permission.PermissionKey = 'content:asset:list';
    await expect(
      authorizeAdminAssetRead(s.tx, 8, { kind: 'all' }),
    ).resolves.toEqual({ kind: 'all' });
    await expect(
      authorizeAdminAssetDeletion(s.tx, 8, { kind: 'all' }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it.each([
    'account',
    'role',
    'portal',
    'binding',
    'scope',
    'permission',
  ] as const)('read rejects stale %s', async (kind) => {
    const s = setup();
    s.role.RolePermissions[1]!.Permission.PermissionKey = 'content:asset:list';
    if (kind === 'account') s.user.Status = 'disabled';
    if (kind === 'role') s.role.Status = 'disabled';
    if (kind === 'portal') s.role.RolePermissions.shift();
    if (kind === 'binding') s.user.UserRoles = [];
    if (kind === 'scope') s.role.DataScope = 'self';
    if (kind === 'permission')
      s.role.RolePermissions[1]!.Permission.Status = 'disabled';
    await expect(
      authorizeAdminAssetRead(s.tx, 8, { kind: 'all' }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('permits configured custom roles with current action, portal and all scope', async () => {
    const s = setup();
    await expect(
      authorizeAdminAssetDeletion(s.tx, 8, { kind: 'all' }),
    ).resolves.toEqual({ kind: 'all' });
  });
  it.each([
    'account',
    'role',
    'portal',
    'action',
    'permission status',
    'binding',
    'conflict',
    'merchant',
  ] as const)('fails closed for %s', async (kind) => {
    const s = setup();
    if (kind === 'account') s.user.Status = 'disabled';
    if (kind === 'role') s.role.Status = 'disabled';
    if (kind === 'portal' || kind === 'action')
      s.role.RolePermissions = s.role.RolePermissions.filter(
        (p) =>
          p.Permission.PermissionKey !==
          (kind === 'portal'
            ? 'management:portal:enter'
            : 'content:asset:delete'),
      );
    if (kind === 'permission status')
      s.role.RolePermissions[1]!.Permission.Status = 'disabled';
    if (kind === 'binding') s.user.UserRoles = [];
    if (kind === 'conflict')
      s.user.UserRoles.push({
        Role: { ...s.role, RoleKey: 'extra', DataScope: 'self' },
      });
    if (kind === 'merchant') s.role.DataScope = 'merchant';
    await expect(
      authorizeAdminAssetDeletion(s.tx, 8, { kind: 'all' }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it.each([0, -1, 1.5, NaN, 2147483648])(
    'rejects invalid actor %s before querying authorization',
    async (id) => {
      const s = setup();
      await expect(
        authorizeAdminAssetDeletion(s.tx, id, { kind: 'all' }),
      ).rejects.toMatchObject({ status: 403 });
      expect(s.findUnique).not.toHaveBeenCalled();
    },
  );
  it('rejects a disappeared account', async () => {
    const s = setup();
    s.findUnique.mockResolvedValue(null);
    await expect(
      authorizeAdminAssetDeletion(s.tx, 8, { kind: 'all' }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('accepts self only for the effective actor', async () => {
    const s = setup();
    s.role.DataScope = 'self';
    await expect(
      authorizeAdminAssetDeletion(s.tx, 8, { kind: 'self', userId: 8 }),
    ).resolves.toEqual({ kind: 'self', userId: 8 });
    await expect(
      authorizeAdminAssetDeletion(s.tx, 8, { kind: 'self', userId: 9 }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('compares selected IDs as sets without accepting altered scope snapshots', async () => {
    const s = setup();
    s.role.DataScopes = [
      {
        ResourceKey: 'asset',
        ScopeType: 'selected',
        ScopeConfig: { selectedIds: [9, 7] },
      },
    ];
    await expect(
      authorizeAdminAssetDeletion(s.tx, 8, { kind: 'selected', ids: [7, 9] }),
    ).resolves.toEqual({ kind: 'selected', ids: [7, 9] });
    for (const requested of [
      { kind: 'all' },
      { kind: 'selected', ids: [7] },
      { kind: 'selected', ids: [10] },
    ] as AdminAssetAccess[])
      await expect(
        authorizeAdminAssetDeletion(s.tx, 8, requested),
      ).rejects.toMatchObject({ status: 403 });
  });
  it('refuses scope widening since Guard as well as narrowing', async () => {
    const s = setup();
    await expect(
      authorizeAdminAssetDeletion(s.tx, 8, { kind: 'self', userId: 8 }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('ignores an inactive extra role and non-action scope grants', async () => {
    const s = setup();
    s.user.UserRoles.push({
      Role: {
        ...s.role,
        RoleKey: 'inactive',
        Status: 'disabled',
        DataScope: 'self',
      },
    });
    s.user.UserRoles.push({
      Role: {
        ...s.role,
        RoleKey: 'unrelated',
        DataScope: 'self',
        RolePermissions: [],
      },
    });
    await expect(
      authorizeAdminAssetDeletion(s.tx, 8, { kind: 'all' }),
    ).resolves.toEqual({ kind: 'all' });
  });
});
