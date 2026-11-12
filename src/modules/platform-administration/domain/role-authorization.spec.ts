import { describe, expect, it } from 'vitest';
import {
  validateRoleAuthorization,
  invalidResourceScopeChanges,
  type RoleAuthorizationInput,
} from './role-authorization.js';

const validAuthorization: RoleAuthorizationInput = {
  permissionIds: [2, 3],
  dataScopes: [
    { resourceKey: 'resort', scopeType: 'merchant' },
    { resourceKey: 'role', scopeType: 'selected', selectedIds: [4, 9] },
  ],
  fieldPolicies: [
    {
      entityType: 'ski_resort',
      fieldKey: 'lift_count',
      canRead: true,
      canWrite: false,
    },
  ],
};

describe('validateRoleAuthorization', () => {
  it('accepts a complete authorization snapshot', () => {
    expect(validateRoleAuthorization(validAuthorization)).toEqual([]);
  });

  it('rejects duplicates, malformed resource keys and invalid selected IDs', () => {
    expect(
      validateRoleAuthorization({
        permissionIds: [2, 2],
        dataScopes: [
          {
            resourceKey: 'bad key',
            scopeType: 'selected',
            selectedIds: [0, 4, 4],
          },
          { resourceKey: 'bad key', scopeType: 'all' },
        ],
        fieldPolicies: [
          {
            entityType: 'ski_resort',
            fieldKey: 'lift_count',
            canRead: true,
            canWrite: true,
          },
          {
            entityType: 'ski_resort',
            fieldKey: 'lift_count',
            canRead: false,
            canWrite: false,
          },
        ],
      }),
    ).toEqual(
      expect.arrayContaining([
        'invalid_permission_ids',
        'invalid_resource_key',
        'duplicate_resource_scope',
        'invalid_selected_scope',
        'duplicate_field_policy',
      ]),
    );
  });

  it('rejects selected IDs on scopes that do not use an ID selection', () => {
    expect(
      validateRoleAuthorization({
        permissionIds: [],
        dataScopes: [
          { resourceKey: 'resort', scopeType: 'all', selectedIds: [4] },
        ],
        fieldPolicies: [],
      }),
    ).toContain('unexpected_selected_ids');
  });
});

describe('resource catalog compatibility', () => {
  it('allows all registered resource keys and removal of historical unknown keys', () => {
    expect(
      invalidResourceScopeChanges(
        ['article', 'asset', 'resort', 'role', 'user'].map((resourceKey) => ({
          resourceKey,
          scopeType: 'all',
        })),
        [{ resourceKey: 'legacy', scopeType: 'all' }],
      ),
    ).toEqual([]);
  });

  it('preserves a historical unknown selected scope regardless of ID order', () => {
    expect(
      invalidResourceScopeChanges(
        [{ resourceKey: 'legacy', scopeType: 'selected', selectedIds: [4, 2] }],
        [{ resourceKey: 'legacy', scopeType: 'selected', selectedIds: [2, 4] }],
      ),
    ).toEqual([]);
  });

  it.each([
    [{ resourceKey: 'unknown', scopeType: 'all' as const }],
    [{ resourceKey: 'legacy', scopeType: 'all' as const }],
    [
      {
        resourceKey: 'legacy',
        scopeType: 'selected' as const,
        selectedIds: [2, 4, 8],
      },
    ],
    [
      {
        resourceKey: 'legacy.renamed',
        scopeType: 'selected' as const,
        selectedIds: [2, 4],
      },
    ],
  ])('refuses unknown resource additions or changes: %j', (current) => {
    expect(
      invalidResourceScopeChanges(
        [current],
        [{ resourceKey: 'legacy', scopeType: 'selected', selectedIds: [2, 4] }],
      ),
    ).toHaveLength(1);
  });

  it('rejects unsupported scope types at the domain boundary', () => {
    expect(
      validateRoleAuthorization({
        permissionIds: [],
        dataScopes: [{ resourceKey: 'role', scopeType: 'invalid' as 'all' }],
        fieldPolicies: [],
      }),
    ).toContain('invalid_scope_type');
  });
});
