import type { DataScope, ResourceDataScope } from './data-scope.js';
import { MANAGEMENT_PORTAL_ACCESS_PERMISSION } from './permissions.js';

export interface AuthorizationResourceScopeGrant {
  resourceKey: string;
  scopeType: ResourceDataScope;
  selectedIds?: readonly number[];
}

export interface AuthorizationRoleGrant {
  roleKey: string;
  active: boolean;
  dataScope: DataScope;
  permissionKeys: readonly string[];
  resourceScopes?: readonly AuthorizationResourceScopeGrant[];
}

export interface AuthorizationPrincipal {
  userId: number;
  active: boolean;
  merchantId: number | null;
  roles: readonly AuthorizationRoleGrant[];
}

export type ResolvedDataScope =
  | { kind: 'self'; userId: number }
  | { kind: 'merchant'; merchantId: number }
  | { kind: 'selected'; ids: readonly number[] }
  | { kind: 'all' };

export function mayEnterManagementPortal(
  principal: AuthorizationPrincipal | null,
): boolean {
  return hasPermission(principal, MANAGEMENT_PORTAL_ACCESS_PERMISSION);
}

export function hasPermission(
  principal: AuthorizationPrincipal | null,
  permissionKey: string,
): boolean {
  if (!isActivePrincipal(principal) || permissionKey.trim().length === 0) {
    return false;
  }

  const activeRoles = principal.roles.filter(({ active }) => active);
  return activeRoles.some(({ permissionKeys }) =>
    permissionKeys.includes(permissionKey),
  );
}

export function resolveDataScope(
  principal: AuthorizationPrincipal | null,
  permissionKey: string,
  resourceKey = permissionKey,
): ResolvedDataScope | null {
  if (
    !isActivePrincipal(principal) ||
    permissionKey.trim().length === 0 ||
    resourceKey.trim().length === 0
  ) {
    return null;
  }

  const grants = principal.roles
    .filter(
      ({ active, permissionKeys }) =>
        active && permissionKeys.includes(permissionKey),
    )
    .map((role) => {
      const resourceGrant = role.resourceScopes?.find(
        (scope) => scope.resourceKey === resourceKey,
      );
      return resourceGrant
        ? {
            scopeType: resourceGrant.scopeType,
            selectedIds: resourceGrant.selectedIds,
          }
        : { scopeType: role.dataScope };
    });
  if (grants.length === 0) return null;

  const distinct = new Set(grants.map(scopeIdentity));
  if (distinct.size !== 1) return null;

  const grant = grants[0]!;
  if (grant.scopeType === 'self') {
    return { kind: 'self', userId: principal.userId };
  }
  if (grant.scopeType === 'all') return { kind: 'all' };
  if (grant.scopeType === 'selected') {
    return grant.selectedIds?.length
      ? { kind: 'selected', ids: [...grant.selectedIds].sort((a, b) => a - b) }
      : null;
  }
  if (
    grant.scopeType === 'merchant' &&
    Number.isSafeInteger(principal.merchantId) &&
    principal.merchantId !== null &&
    principal.merchantId > 0
  ) {
    return { kind: 'merchant', merchantId: principal.merchantId };
  }
  return null;
}

function scopeIdentity(scope: {
  scopeType: string;
  selectedIds?: readonly number[];
}): string {
  return scope.scopeType === 'selected'
    ? `selected:${[...(scope.selectedIds ?? [])].sort((a, b) => a - b).join(',')}`
    : scope.scopeType;
}

function isActivePrincipal(
  principal: AuthorizationPrincipal | null,
): principal is AuthorizationPrincipal {
  if (!(
    principal !== null &&
    principal.active &&
    Number.isSafeInteger(principal.userId) &&
    principal.userId > 0
  ))
    return false;

  const activeRoles = principal.roles.filter(({ active }) => active);
  const hasSystemAdmin = activeRoles.some(
    ({ roleKey }) => roleKey === 'system_admin',
  );
  return !hasSystemAdmin || activeRoles.length === 1;
}
