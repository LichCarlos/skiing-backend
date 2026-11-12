export interface RoleFieldAccessGrant {
  active: boolean;
  entityType: string;
  fieldKey: string;
  canRead: boolean;
  canWrite: boolean;
}

export interface FieldAccessPolicy {
  canRead: boolean;
  canWrite: boolean;
}

export function resolveFieldAccessPolicies(
  grants: readonly RoleFieldAccessGrant[],
  entityType: string,
): ReadonlyMap<string, FieldAccessPolicy> {
  const policies = new Map<string, FieldAccessPolicy>();

  for (const grant of grants) {
    if (!grant.active || grant.entityType !== entityType) continue;
    const current = policies.get(grant.fieldKey) ?? {
      canRead: false,
      canWrite: false,
    };
    policies.set(grant.fieldKey, {
      canRead: current.canRead || grant.canRead,
      canWrite: current.canWrite || grant.canWrite,
    });
  }

  return policies;
}
