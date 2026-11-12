import type { ResolvedDataScope } from '../../identity-access/domain/authorization.js';

export interface MerchantResortAccess {
  userId: number;
  merchantId: number | null;
  scope: ResolvedDataScope | undefined;
}

// A resource grant always intersects the account's own merchant profile.
export function permitsMerchantResortAccess(
  access: MerchantResortAccess,
): boolean {
  const { userId, merchantId, scope } = access;
  if (
    !Number.isSafeInteger(userId) ||
    userId <= 0 ||
    !Number.isSafeInteger(merchantId) ||
    merchantId === null ||
    merchantId <= 0 ||
    !scope
  )
    return false;
  switch (scope.kind) {
    case 'all':
      return true;
    case 'self':
      return scope.userId === userId;
    case 'merchant':
      return scope.merchantId === merchantId;
    case 'selected':
      return (
        scope.ids.length > 0 &&
        scope.ids.every((id) => Number.isSafeInteger(id) && id > 0)
      );
    default:
      return false;
  }
}

// Global resort administration has a separate API from merchant-owned operations.
export function permitsGlobalResortManagement(
  scope: ResolvedDataScope | undefined,
): boolean {
  return scope?.kind === 'all';
}
