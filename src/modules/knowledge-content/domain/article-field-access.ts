export interface ArticleFieldGrant {
  fieldKey: string;
  canRead: boolean;
  canWrite: boolean;
}

export function resolveArticleFieldPolicies(
  grants: readonly ArticleFieldGrant[],
): Map<string, { canRead: boolean; canWrite: boolean }> {
  const result = new Map<string, { canRead: boolean; canWrite: boolean }>();
  for (const grant of grants) {
    const current = result.get(grant.fieldKey) ?? {
      canRead: false,
      canWrite: false,
    };
    result.set(grant.fieldKey, {
      canRead: current.canRead || grant.canRead,
      canWrite: current.canWrite || grant.canWrite,
    });
  }
  return result;
}
