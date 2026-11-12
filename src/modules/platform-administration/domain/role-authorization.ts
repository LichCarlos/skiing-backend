import {
  isResourceDataScope,
  type ResourceDataScope,
} from '../../identity-access/domain/data-scope.js';
import { isAuthorizationResourceKey } from '../../identity-access/domain/authorization-resources.js';
import { isCustomFieldEntityType } from './custom-field-definition.js';

export interface RoleAuthorizationDataScope {
  resourceKey: string;
  scopeType: ResourceDataScope;
  selectedIds?: readonly number[];
}

export interface RoleAuthorizationFieldPolicy {
  entityType: string;
  fieldKey: string;
  canRead: boolean;
  canWrite: boolean;
}

export interface RoleAuthorizationInput {
  permissionIds: readonly number[];
  dataScopes: readonly RoleAuthorizationDataScope[];
  fieldPolicies: readonly RoleAuthorizationFieldPolicy[];
}

export function validateRoleAuthorization(
  input: RoleAuthorizationInput,
): string[] {
  const issues: string[] = [];
  if (
    input.permissionIds.some((id) => !Number.isSafeInteger(id) || id < 1) ||
    new Set(input.permissionIds).size !== input.permissionIds.length
  ) {
    issues.push('invalid_permission_ids');
  }

  const resourceKeys = new Set<string>();
  for (const scope of input.dataScopes) {
    if (!isResourceDataScope(scope.scopeType))
      issues.push('invalid_scope_type');
    if (!/^[a-z][a-z0-9._:-]{0,99}$/.test(scope.resourceKey)) {
      issues.push('invalid_resource_key');
    }
    if (resourceKeys.has(scope.resourceKey)) {
      issues.push('duplicate_resource_scope');
    }
    resourceKeys.add(scope.resourceKey);
    if (scope.scopeType === 'selected') {
      if (
        !scope.selectedIds?.length ||
        scope.selectedIds.some((id) => !Number.isSafeInteger(id) || id < 1) ||
        new Set(scope.selectedIds).size !== scope.selectedIds.length
      ) {
        issues.push('invalid_selected_scope');
      }
    } else if (scope.selectedIds !== undefined) {
      issues.push('unexpected_selected_ids');
    }
  }

  const fieldKeys = new Set<string>();
  for (const policy of input.fieldPolicies) {
    const key = `${policy.entityType}\u0000${policy.fieldKey}`;
    if (
      !isCustomFieldEntityType(policy.entityType) ||
      !/^[a-z][a-z0-9_]{0,99}$/.test(policy.fieldKey)
    ) {
      issues.push('invalid_field_policy_key');
    }
    if (fieldKeys.has(key)) issues.push('duplicate_field_policy');
    fieldKeys.add(key);
  }
  return [...new Set(issues)];
}

export function invalidResourceScopeChanges(
  current: readonly RoleAuthorizationDataScope[],
  previous: readonly RoleAuthorizationDataScope[],
): string[] {
  const previousByKey = new Map(
    previous.map((scope) => [scope.resourceKey, scope]),
  );
  return current
    .filter((scope) => {
      if (isAuthorizationResourceKey(scope.resourceKey)) return false;
      const old = previousByKey.get(scope.resourceKey);
      if (!old || old.scopeType !== scope.scopeType) return true;
      const left = [...(old.selectedIds ?? [])].sort((a, b) => a - b);
      const right = [...(scope.selectedIds ?? [])].sort((a, b) => a - b);
      return (
        left.length !== right.length ||
        left.some((id, index) => id !== right[index])
      );
    })
    .map((scope) => scope.resourceKey);
}
