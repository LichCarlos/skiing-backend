import { describe, expect, it, vi } from 'vitest';
import type {
  AuthorizationPrincipalReader,
  AuthorizationPrincipalRecord,
} from './ports/authorization-principal-reader.js';
import { ResolveAuthorizationPrincipal } from './resolve-authorization-principal.js';

function principalRecord(
  overrides: Partial<AuthorizationPrincipalRecord> = {},
): AuthorizationPrincipalRecord {
  return {
    userId: 41,
    status: 'active',
    merchant: { id: 12, status: 'active' },
    roles: [
      {
        key: 'resort_operator',
        status: 'active',
        dataScope: 'merchant',
        dataScopes: [
          {
            resourceKey: 'resort',
            scopeType: 'selected',
            scopeConfig: { selectedIds: [12, 13] },
          },
        ],
        permissions: [
          { key: 'resort:merchant:list', status: 'active' },
          { key: 'resort:merchant:update', status: 'disabled' },
        ],
      },
    ],
    ...overrides,
  };
}

function setup(record: AuthorizationPrincipalRecord | null) {
  const findByUserId = vi.fn().mockResolvedValue(record);
  const reader = { findByUserId } satisfies AuthorizationPrincipalReader;
  return {
    resolver: new ResolveAuthorizationPrincipal(reader),
    findByUserId,
  };
}

describe('ResolveAuthorizationPrincipal', () => {
  it('loads active grants and derives merchant identity from the database record', async () => {
    const { resolver, findByUserId } = setup(principalRecord());

    await expect(resolver.execute(41)).resolves.toEqual({
      userId: 41,
      active: true,
      merchantId: 12,
      roles: [
        {
          roleKey: 'resort_operator',
          active: true,
          dataScope: 'merchant',
          permissionKeys: ['resort:merchant:list'],
          resourceScopes: [
            {
              resourceKey: 'resort',
              scopeType: 'selected',
              selectedIds: [12, 13],
            },
          ],
        },
      ],
    });
    expect(findByUserId).toHaveBeenCalledWith(41);
  });

  it('does not assign a disabled merchant profile as the principal scope', async () => {
    const { resolver } = setup(
      principalRecord({ merchant: { id: 12, status: 'disabled' } }),
    );

    await expect(resolver.execute(41)).resolves.toMatchObject({
      merchantId: null,
      active: true,
    });
  });

  it('disables users with an active system-admin role combined with another active role', async () => {
    const { resolver } = setup(
      principalRecord({
        roles: [
          {
            key: 'system_admin',
            status: 'active',
            dataScope: 'all',
            permissions: [],
          },
          { key: 'user', status: 'active', dataScope: 'self', permissions: [] },
        ],
      }),
    );

    await expect(resolver.execute(41)).resolves.toMatchObject({
      active: false,
    });
  });

  it('fails closed when an active role has an unsupported data scope', async () => {
    const { resolver } = setup(
      principalRecord({
        roles: [
          {
            key: 'resort_operator',
            status: 'active',
            dataScope: 'global',
            permissions: [{ key: 'resort:merchant:list', status: 'active' }],
          },
        ],
      }),
    );

    await expect(resolver.execute(41)).resolves.toMatchObject({
      active: false,
      roles: [{ dataScope: 'self' }],
    });
  });

  it('rejects invalid IDs without querying persistence and returns null for missing users', async () => {
    const { resolver, findByUserId } = setup(null);

    await expect(resolver.execute(0)).resolves.toBeNull();
    await expect(resolver.execute(41)).resolves.toBeNull();
    expect(findByUserId).toHaveBeenCalledOnce();
  });
});
