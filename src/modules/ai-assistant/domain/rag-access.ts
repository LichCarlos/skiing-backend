import { RAG_QUERY_PERMISSION } from '../../identity-access/domain/permissions.js';

export interface RagAccessRole {
  active: boolean;
  dataScope: 'self' | 'merchant' | 'all';
  permissionKeys: readonly string[];
}

export interface RagAccessPrincipal {
  userId: number;
  active: boolean;
  merchantId: number | null;
  roles: readonly RagAccessRole[];
}

export type MerchantRagAccess =
  { kind: 'none' } | { kind: 'selected'; merchantId: number } | { kind: 'all' };

export interface RagAccessFilter {
  public: boolean;
  merchant: MerchantRagAccess;
  admin: boolean;
}

export function resolveRagAccess(
  principal: RagAccessPrincipal | null,
): RagAccessFilter {
  if (
    principal !== null &&
    (!principal.active ||
      !Number.isSafeInteger(principal.userId) ||
      principal.userId < 1)
  ) {
    return {
      public: false,
      merchant: { kind: 'none' },
      admin: false,
    };
  }

  const scopes = new Set(
    (principal?.roles ?? [])
      .filter(
        ({ active, permissionKeys }) =>
          active && permissionKeys.includes(RAG_QUERY_PERMISSION),
      )
      .map(({ dataScope }) => dataScope),
  );
  if (scopes.size !== 1) return publicOnlyAccess();

  const [scope] = scopes;
  if (scope === 'all') {
    return { public: true, merchant: { kind: 'all' }, admin: true };
  }

  const merchantId = principal?.merchantId;
  if (
    scope === 'merchant' &&
    Number.isSafeInteger(merchantId) &&
    merchantId !== null &&
    merchantId !== undefined &&
    merchantId > 0
  ) {
    return {
      public: true,
      merchant: { kind: 'selected', merchantId },
      admin: false,
    };
  }

  return publicOnlyAccess();
}

function publicOnlyAccess(): RagAccessFilter {
  return { public: true, merchant: { kind: 'none' }, admin: false };
}
