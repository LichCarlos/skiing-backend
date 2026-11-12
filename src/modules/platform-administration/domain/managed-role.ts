import type { DataScope } from '../../identity-access/domain/data-scope.js';

export const ROLE_STATUSES = ['active', 'disabled'] as const;

export type ManagedRoleStatus = (typeof ROLE_STATUSES)[number];

export interface CreateManagedRoleInput {
  roleKey: string;
  roleName: string;
  description: string | null;
  dataScope: DataScope;
}

export interface UpdateManagedRoleInput {
  roleKey?: string;
  roleName?: string;
  description?: string | null;
  dataScope?: DataScope;
  status?: ManagedRoleStatus;
}

export interface ManagedRoleScopeSummary {
  resourceKey: string;
  scopeType: string;
}

export interface ManagedRole {
  roleId: number;
  roleKey: string;
  roleName: string;
  description: string | null;
  dataScope: DataScope;
  status: ManagedRoleStatus;
  userCount: number;
  permissionCount: number;
  fieldPolicyCount: number;
  dataScopes: readonly ManagedRoleScopeSummary[];
}

export interface ManagedRoleFilter {
  keyword?: string;
  status?: ManagedRoleStatus;
  roleIds?: readonly number[];
  skip: number;
  take: number;
}

export interface ManagedRolePage {
  items: readonly ManagedRole[];
  total: number;
}

export interface RoleAuditContext {
  actorUserId: number;
  traceId: string;
  clientIp: string | null;
  userAgent: string | null;
}

export function validateCreateManagedRole(
  input: CreateManagedRoleInput,
): string[] {
  const issues = validateRoleKey(input.roleKey);
  if (!input.roleName.trim() || input.roleName.trim().length > 50) {
    issues.push('invalid_role_name');
  }
  if (input.description !== null && input.description.trim().length > 300) {
    issues.push('invalid_role_description');
  }
  if (!isDataScope(input.dataScope)) issues.push('invalid_role_data_scope');
  return issues;
}

export function validateUpdateManagedRole(
  input: UpdateManagedRoleInput,
): string[] {
  const issues: string[] = [];
  if (Object.values(input).every((value) => value === undefined))
    issues.push('empty_role_patch');
  if (input.roleKey !== undefined)
    issues.push(...validateRoleKey(input.roleKey));
  if (
    input.roleName !== undefined &&
    (!input.roleName.trim() || input.roleName.trim().length > 50)
  ) {
    issues.push('invalid_role_name');
  }
  if (
    input.description !== undefined &&
    input.description !== null &&
    input.description.trim().length > 300
  ) {
    issues.push('invalid_role_description');
  }
  if (input.dataScope !== undefined && !isDataScope(input.dataScope)) {
    issues.push('invalid_role_data_scope');
  }
  if (input.status !== undefined && !ROLE_STATUSES.includes(input.status)) {
    issues.push('invalid_role_status');
  }
  return [...new Set(issues)];
}

function validateRoleKey(roleKey: string): string[] {
  if (!/^[a-z][a-z0-9._-]{0,49}$/.test(roleKey)) {
    return ['invalid_role_key'];
  }
  if (roleKey === 'system_admin') return ['reserved_role_key'];
  return [];
}

function isDataScope(value: string): value is DataScope {
  return value === 'self' || value === 'merchant' || value === 'all';
}
