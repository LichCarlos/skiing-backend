import type { ResolvedDataScope } from '../../identity-access/domain/authorization.js';

export type AdminAssetAccess =
  | { kind: 'all' }
  | { kind: 'self'; userId: number }
  | { kind: 'selected'; ids: readonly number[] };

export function resolveAdminAssetAccess(
  scope: ResolvedDataScope | undefined,
  actorUserId: number | undefined,
): AdminAssetAccess | null {
  if (!Number.isSafeInteger(actorUserId) || !actorUserId || actorUserId < 1)
    return null;
  if (scope?.kind === 'all') return { kind: 'all' };
  if (scope?.kind === 'self' && scope.userId === actorUserId)
    return { kind: 'self', userId: actorUserId };
  if (
    scope?.kind === 'selected' &&
    scope.ids.length > 0 &&
    scope.ids.every((id) => Number.isSafeInteger(id) && id > 0)
  )
    return { kind: 'selected', ids: [...new Set(scope.ids)] };
  return null;
}
