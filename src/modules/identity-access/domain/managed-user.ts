export const MANAGED_USER_STATUSES = ['active', 'disabled'] as const;

export type ManagedUserStatus = (typeof MANAGED_USER_STATUSES)[number];

export interface AssignableRole {
  roleId: number;
  status: string;
  systemRoleCode: string | null;
}

export interface UserRoleAssignmentIssue {
  code:
    | 'invalid_role_ids'
    | 'inactive_role'
    | 'system_admin_grant_forbidden'
    | 'system_admin_must_be_exclusive'
    | 'last_system_admin_protected';
}

export function areValidManagedUserRoleIds(
  roleIds: readonly number[],
): boolean {
  return (
    new Set(roleIds).size === roleIds.length &&
    roleIds.every(
      (id) => Number.isSafeInteger(id) && id >= 1 && id <= 2147483647,
    )
  );
}

export function validateUserRoleAssignment(input: {
  requestedRoleIds: readonly number[];
  currentRoleCodes?: readonly string[];
  roles: readonly AssignableRole[];
  actorIsSystemAdmin: boolean;
  targetIsActiveSystemAdmin?: boolean;
  activeSystemAdminCount?: number;
}): UserRoleAssignmentIssue[] {
  const issues: UserRoleAssignmentIssue[] = [];
  if (!areValidManagedUserRoleIds(input.requestedRoleIds)) {
    issues.push({ code: 'invalid_role_ids' });
    return issues;
  }

  const selected = input.requestedRoleIds.map((roleId) =>
    input.roles.find((role) => role.roleId === roleId),
  );
  if (selected.some((role) => !role || role.status !== 'active')) {
    issues.push({ code: 'inactive_role' });
    return issues;
  }

  const grantsSystemAdmin = selected.some(
    (role) => role?.systemRoleCode === 'system_admin',
  );
  const currentlySystemAdmin =
    input.targetIsActiveSystemAdmin ??
    input.currentRoleCodes?.includes('system_admin') ??
    false;

  if (grantsSystemAdmin && !input.actorIsSystemAdmin) {
    issues.push({ code: 'system_admin_grant_forbidden' });
  }
  if (grantsSystemAdmin && input.requestedRoleIds.length !== 1) {
    issues.push({ code: 'system_admin_must_be_exclusive' });
  }
  if (
    currentlySystemAdmin &&
    !grantsSystemAdmin &&
    input.activeSystemAdminCount !== undefined &&
    input.activeSystemAdminCount <= 1
  ) {
    issues.push({ code: 'last_system_admin_protected' });
  }

  return issues;
}

export function mayDeactivateUser(input: {
  targetIsActiveSystemAdmin: boolean;
  activeSystemAdminCount: number;
}): boolean {
  return !(
    input.targetIsActiveSystemAdmin && input.activeSystemAdminCount <= 1
  );
}
