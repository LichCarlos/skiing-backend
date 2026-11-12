import { Inject, Injectable } from '@nestjs/common';
import {
  AUTHORIZATION_PRINCIPAL_READER,
  type AuthorizationPrincipalReader,
  type AuthorizationPrincipalRecord,
} from './ports/authorization-principal-reader.js';
import type {
  AuthorizationPrincipal,
  AuthorizationResourceScopeGrant,
  AuthorizationRoleGrant,
} from '../domain/authorization.js';
import { isDataScope, isResourceDataScope } from '../domain/data-scope.js';

@Injectable()
export class ResolveAuthorizationPrincipal {
  constructor(
    @Inject(AUTHORIZATION_PRINCIPAL_READER)
    private readonly principals: AuthorizationPrincipalReader,
  ) {}

  async execute(userId: number): Promise<AuthorizationPrincipal | null> {
    if (!Number.isSafeInteger(userId) || userId < 1) return null;

    const record = await this.principals.findByUserId(userId);
    if (!record) return null;

    const parsedResourceScopes = record.roles.map((role) =>
      role.dataScopes?.map(parseResourceScope),
    );
    const roles: AuthorizationRoleGrant[] = record.roles.map((role, index) => ({
      roleKey: role.key,
      active: role.status === 'active',
      dataScope: isDataScope(role.dataScope) ? role.dataScope : 'self',
      permissionKeys: role.permissions
        .filter(({ status }) => status === 'active')
        .map(({ key }) => key),
      resourceScopes: (parsedResourceScopes[index] ?? []).filter(
        (scope): scope is AuthorizationResourceScopeGrant => scope !== null,
      ),
    }));
    const activeRoles = roles.filter(({ active }) => active);
    const hasInvalidActiveDataScope = record.roles.some(
      (role, index) =>
        role.status === 'active' &&
        (!isDataScope(role.dataScope) ||
          (parsedResourceScopes[index] ?? []).some((scope) => scope === null)),
    );
    const hasSystemAdmin = activeRoles.some(
      ({ roleKey }) => roleKey === 'system_admin',
    );
    const merchantId =
      record.merchant?.status === 'active' &&
      Number.isSafeInteger(record.merchant.id) &&
      record.merchant.id > 0
        ? record.merchant.id
        : null;

    return {
      userId: record.userId,
      active:
        record.status === 'active' &&
        !hasInvalidActiveDataScope &&
        (!hasSystemAdmin || activeRoles.length === 1),
      merchantId,
      roles,
    };
  }
}

function parseResourceScope(
  scope: NonNullable<
    AuthorizationPrincipalRecord['roles'][number]['dataScopes']
  >[number],
): AuthorizationResourceScopeGrant | null {
  if (
    !/^[a-z][a-z0-9._:-]{0,99}$/.test(scope.resourceKey) ||
    !isResourceDataScope(scope.scopeType)
  ) {
    return null;
  }
  if (scope.scopeType !== 'selected') {
    return scope.scopeConfig === null || scope.scopeConfig === undefined
      ? { resourceKey: scope.resourceKey, scopeType: scope.scopeType }
      : null;
  }
  if (
    !scope.scopeConfig ||
    typeof scope.scopeConfig !== 'object' ||
    Array.isArray(scope.scopeConfig)
  ) {
    return null;
  }
  const config = scope.scopeConfig as Record<string, unknown>;
  if (
    Object.keys(config).some((key) => key !== 'selectedIds') ||
    !Array.isArray(config.selectedIds) ||
    config.selectedIds.length === 0 ||
    !config.selectedIds.every(
      (id) => Number.isSafeInteger(id) && typeof id === 'number' && id > 0,
    ) ||
    new Set(config.selectedIds).size !== config.selectedIds.length
  ) {
    return null;
  }
  return {
    resourceKey: scope.resourceKey,
    scopeType: 'selected',
    selectedIds: config.selectedIds as number[],
  };
}
