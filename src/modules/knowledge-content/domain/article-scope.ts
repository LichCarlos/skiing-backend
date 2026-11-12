import type { ResolvedDataScope } from '../../identity-access/domain/authorization.js';

export type ArticleAccess =
  | { kind: 'all' }
  | { kind: 'self'; userId: number }
  | { kind: 'selected'; ids: readonly number[] };
export function resolveArticleAccess(
  scope: ResolvedDataScope | undefined,
): ArticleAccess | null {
  if (scope?.kind === 'all') return { kind: 'all' };
  if (scope?.kind === 'self' && isDatabaseId(scope.userId))
    return { kind: 'self', userId: scope.userId };
  if (
    scope?.kind === 'selected' &&
    scope.ids.length > 0 &&
    scope.ids.every(isDatabaseId)
  )
    return { kind: 'selected', ids: [...new Set(scope.ids)] };
  return null;
}
export function mayCreateArticle(access: ArticleAccess): boolean {
  return access.kind !== 'selected';
}
export function articleActorMatches(
  access: ArticleAccess,
  userId: number,
): boolean {
  return (
    isDatabaseId(userId) && (access.kind !== 'self' || access.userId === userId)
  );
}

function isDatabaseId(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647;
}
