import { describe, expect, it } from 'vitest';
import {
  hasPermission,
  mayEnterManagementPortal,
  resolveDataScope,
  type AuthorizationPrincipal,
} from './authorization.js';
import { MANAGEMENT_PORTAL_ACCESS_PERMISSION } from './permissions.js';

const user: AuthorizationPrincipal = {
  userId: 12,
  active: true,
  merchantId: null,
  roles: [
    {
      roleKey: 'user',
      active: true,
      dataScope: 'self',
      permissionKeys: ['account:profile:read'],
    },
  ],
};

describe('identity access policy', () => {
  it('denies anonymous and disabled principals by default', () => {
    expect(mayEnterManagementPortal(null)).toBe(false);
    expect(hasPermission(null, 'account:profile:read')).toBe(false);
    expect(
      hasPermission({ ...user, active: false }, 'account:profile:read'),
    ).toBe(false);
  });

  it('uses the management-entry grant instead of hard-coded business role keys', () => {
    const merchant: AuthorizationPrincipal = {
      ...user,
      merchantId: 9,
      roles: [
        {
          roleKey: 'resort_operator',
          active: true,
          dataScope: 'merchant',
          permissionKeys: [MANAGEMENT_PORTAL_ACCESS_PERMISSION],
        },
      ],
    };
    const admin: AuthorizationPrincipal = {
      ...user,
      roles: [
        {
          roleKey: 'system_admin',
          active: true,
          dataScope: 'all',
          permissionKeys: [MANAGEMENT_PORTAL_ACCESS_PERMISSION],
        },
      ],
    };

    const configuredBusinessRole: AuthorizationPrincipal = {
      ...user,
      merchantId: null,
      roles: [
        {
          roleKey: 'resort_operator',
          active: true,
          dataScope: 'all',
          permissionKeys: [MANAGEMENT_PORTAL_ACCESS_PERMISSION],
        },
      ],
    };
    const merchantWithoutGrant: AuthorizationPrincipal = {
      ...merchant,
      roles: merchant.roles.map((role) => ({ ...role, permissionKeys: [] })),
    };

    expect(mayEnterManagementPortal(user)).toBe(false);
    expect(mayEnterManagementPortal(merchant)).toBe(true);
    expect(mayEnterManagementPortal(admin)).toBe(true);
    expect(mayEnterManagementPortal(configuredBusinessRole)).toBe(true);
    expect(mayEnterManagementPortal(merchantWithoutGrant)).toBe(false);
  });

  it('unions active role permissions but ignores disabled roles', () => {
    const mixedRoles: AuthorizationPrincipal = {
      ...user,
      roles: [
        {
          roleKey: 'user',
          active: true,
          dataScope: 'self',
          permissionKeys: user.roles[0]!.permissionKeys,
        },
        {
          roleKey: 'resort_operator',
          active: false,
          dataScope: 'merchant',
          permissionKeys: ['resort:merchant:update'],
        },
      ],
    };

    expect(hasPermission(mixedRoles, 'account:profile:read')).toBe(true);
    expect(hasPermission(mixedRoles, 'resort:merchant:update')).toBe(false);
  });

  it('requires explicit permission grants for system administrators', () => {
    const admin: AuthorizationPrincipal = {
      ...user,
      roles: [
        {
          roleKey: 'system_admin',
          active: true,
          dataScope: 'all',
          permissionKeys: ['system:config:update'],
        },
      ],
    };

    expect(hasPermission(admin, 'system:config:update')).toBe(true);
    expect(hasPermission(admin, 'future:permission')).toBe(false);
  });

  it('resolves self, merchant and global scopes only for explicitly granted permissions', () => {
    const merchant: AuthorizationPrincipal = {
      ...user,
      merchantId: 9,
      roles: [
        {
          roleKey: 'resort_operator',
          active: true,
          dataScope: 'merchant',
          permissionKeys: ['resort:merchant:list'],
        },
      ],
    };
    const admin: AuthorizationPrincipal = {
      ...user,
      roles: [
        {
          roleKey: 'system_admin',
          active: true,
          dataScope: 'all',
          permissionKeys: ['system:user:list'],
        },
      ],
    };

    expect(resolveDataScope(user, 'account:profile:read')).toEqual({
      kind: 'self',
      userId: user.userId,
    });
    expect(resolveDataScope(merchant, 'resort:merchant:list')).toEqual({
      kind: 'merchant',
      merchantId: 9,
    });
    expect(resolveDataScope(admin, 'system:user:list')).toEqual({
      kind: 'all',
    });
    expect(resolveDataScope(admin, 'system:role:list')).toBeNull();
  });

  it('denies missing merchant bindings and conflicting active role scopes', () => {
    const unboundMerchant: AuthorizationPrincipal = {
      ...user,
      merchantId: null,
      roles: [
        {
          roleKey: 'resort_operator',
          active: true,
          dataScope: 'merchant',
          permissionKeys: ['resort:merchant:list'],
        },
      ],
    };
    const conflicting: AuthorizationPrincipal = {
      ...user,
      roles: [
        {
          roleKey: 'user',
          active: true,
          dataScope: 'self',
          permissionKeys: ['content:dynamic:list'],
        },
        {
          roleKey: 'resort_operator',
          active: true,
          dataScope: 'merchant',
          permissionKeys: ['content:dynamic:list'],
        },
      ],
    };

    expect(
      resolveDataScope(unboundMerchant, 'resort:merchant:list'),
    ).toBeNull();
    expect(resolveDataScope(conflicting, 'content:dynamic:list')).toBeNull();
    expect(resolveDataScope(null, 'content:dynamic:list')).toBeNull();
  });

  it('applies per-resource scopes and rejects conflicting grants for that resource', () => {
    const scoped: AuthorizationPrincipal = {
      ...user,
      roles: [
        {
          roleKey: 'resort_operator',
          active: true,
          dataScope: 'all',
          permissionKeys: ['resort:merchant:list'],
          resourceScopes: [
            {
              resourceKey: 'resort',
              scopeType: 'selected',
              selectedIds: [9, 4],
            },
          ],
        },
      ],
    };
    expect(resolveDataScope(scoped, 'resort:merchant:list', 'resort')).toEqual({
      kind: 'selected',
      ids: [4, 9],
    });
    expect(resolveDataScope(scoped, 'resort:merchant:list', 'article')).toEqual(
      { kind: 'all' },
    );

    const conflicting: AuthorizationPrincipal = {
      ...scoped,
      roles: [
        ...scoped.roles,
        {
          roleKey: 'resort_auditor',
          active: true,
          dataScope: 'all',
          permissionKeys: ['resort:merchant:list'],
          resourceScopes: [{ resourceKey: 'resort', scopeType: 'merchant' }],
        },
      ],
    };
    expect(
      resolveDataScope(conflicting, 'resort:merchant:list', 'resort'),
    ).toBeNull();
  });

  it('treats selected scopes with the same ID set as compatible across roles', () => {
    const matching: AuthorizationPrincipal = {
      ...user,
      roles: [
        {
          roleKey: 'resort_operator',
          active: true,
          dataScope: 'self',
          permissionKeys: ['resort:merchant:list'],
          resourceScopes: [
            {
              resourceKey: 'resort',
              scopeType: 'selected',
              selectedIds: [4, 9],
            },
          ],
        },
        {
          roleKey: 'resort_auditor',
          active: true,
          dataScope: 'all',
          permissionKeys: ['resort:merchant:list'],
          resourceScopes: [
            {
              resourceKey: 'resort',
              scopeType: 'selected',
              selectedIds: [9, 4],
            },
          ],
        },
      ],
    };
    expect(
      resolveDataScope(matching, 'resort:merchant:list', 'resort'),
    ).toEqual({ kind: 'selected', ids: [4, 9] });
  });

  it('fails closed when a system administrator has another active role', () => {
    const invalidAdmin: AuthorizationPrincipal = {
      ...user,
      active: true,
      roles: [
        {
          roleKey: 'system_admin',
          active: true,
          dataScope: 'all',
          permissionKeys: ['system:config:update'],
        },
        {
          roleKey: 'user',
          active: true,
          dataScope: 'self',
          permissionKeys: [],
        },
      ],
    };

    expect(mayEnterManagementPortal(invalidAdmin)).toBe(false);
    expect(hasPermission(invalidAdmin, 'system:config:update')).toBe(false);
  });

  it('rejects blank permission keys and invalid subject IDs', () => {
    expect(hasPermission(user, '  ')).toBe(false);
    expect(hasPermission({ ...user, userId: 0 }, 'account:profile:read')).toBe(
      false,
    );
  });
});
