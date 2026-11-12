import { describe, expect, it } from 'vitest';
import {
  mayDeactivateUser,
  validateUserRoleAssignment,
  type AssignableRole,
} from './managed-user.js';

const roles: readonly AssignableRole[] = [
  { roleId: 1, status: 'active', systemRoleCode: 'registered_user' },
  { roleId: 2, status: 'active', systemRoleCode: null },
  { roleId: 3, status: 'active', systemRoleCode: 'system_admin' },
  { roleId: 4, status: 'disabled', systemRoleCode: null },
];

describe('managed user authorization rules', () => {
  it('requires system_admin to grant the exclusive system_admin role', () => {
    expect(
      validateUserRoleAssignment({
        requestedRoleIds: [3],
        roles,
        actorIsSystemAdmin: false,
      }),
    ).toContainEqual({ code: 'system_admin_grant_forbidden' });

    expect(
      validateUserRoleAssignment({
        requestedRoleIds: [1, 3],
        roles,
        actorIsSystemAdmin: true,
      }),
    ).toContainEqual({ code: 'system_admin_must_be_exclusive' });
  });

  it('protects the last active administrator from role removal or deactivation', () => {
    expect(
      validateUserRoleAssignment({
        requestedRoleIds: [1],
        currentRoleCodes: ['system_admin'],
        roles,
        actorIsSystemAdmin: true,
        activeSystemAdminCount: 1,
      }),
    ).toContainEqual({ code: 'last_system_admin_protected' });
    expect(
      mayDeactivateUser({
        targetIsActiveSystemAdmin: true,
        activeSystemAdminCount: 1,
      }),
    ).toBe(false);
  });

  it('rejects duplicate, invalid, and disabled role IDs', () => {
    expect(
      validateUserRoleAssignment({
        requestedRoleIds: [2, 2],
        roles,
        actorIsSystemAdmin: true,
      }),
    ).toContainEqual({ code: 'invalid_role_ids' });
    expect(
      validateUserRoleAssignment({
        requestedRoleIds: [4],
        roles,
        actorIsSystemAdmin: true,
      }),
    ).toContainEqual({ code: 'inactive_role' });
  });
});
