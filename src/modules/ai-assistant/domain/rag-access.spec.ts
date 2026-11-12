import { describe, expect, it } from 'vitest';
import { resolveRagAccess, type RagAccessPrincipal } from './rag-access.js';

const user: RagAccessPrincipal = {
  userId: 7,
  active: true,
  merchantId: null,
  roles: [{ active: true, dataScope: 'self', permissionKeys: [] }],
};

const ragGrant = {
  active: true,
  dataScope: 'merchant' as const,
  permissionKeys: ['ai:rag:query'],
};

describe('RAG access policy', () => {
  it('allows guests to retrieve public sources only', () => {
    expect(resolveRagAccess(null)).toEqual({
      public: true,
      merchant: { kind: 'none' },
      admin: false,
    });
  });

  it('limits active users to public sources without an explicit query grant', () => {
    expect(resolveRagAccess(user)).toEqual({
      public: true,
      merchant: { kind: 'none' },
      admin: false,
    });
  });

  it('uses configured permission and merchant data scope', () => {
    expect(
      resolveRagAccess({
        ...user,
        merchantId: 23,
        roles: [ragGrant],
      }),
    ).toEqual({
      public: true,
      merchant: { kind: 'selected', merchantId: 23 },
      admin: false,
    });
  });

  it('does not grant merchant data when the identity has no valid binding', () => {
    for (const merchantId of [null, 0, -1, 1.5]) {
      expect(
        resolveRagAccess({ ...user, merchantId, roles: [ragGrant] }).merchant,
      ).toEqual({ kind: 'none' });
    }
  });

  it('allows an explicit all-scope grant independent of role name or merchant binding', () => {
    expect(
      resolveRagAccess({
        ...user,
        roles: [
          {
            active: true,
            dataScope: 'all',
            permissionKeys: ['ai:rag:query'],
          },
        ],
      }),
    ).toEqual({ public: true, merchant: { kind: 'all' }, admin: true });
  });

  it('ignores inactive grants', () => {
    expect(
      resolveRagAccess({
        ...user,
        merchantId: 23,
        roles: [{ ...ragGrant, active: false }],
      }),
    ).toEqual({
      public: true,
      merchant: { kind: 'none' },
      admin: false,
    });
  });

  it('fails closed for missing grants and conflicting scopes', () => {
    expect(
      resolveRagAccess({
        ...user,
        merchantId: 23,
        roles: [{ ...ragGrant, permissionKeys: [] }],
      }).merchant,
    ).toEqual({ kind: 'none' });

    expect(
      resolveRagAccess({
        ...user,
        merchantId: 23,
        roles: [
          ragGrant,
          {
            active: true,
            dataScope: 'all',
            permissionKeys: ['ai:rag:query'],
          },
        ],
      }).merchant,
    ).toEqual({ kind: 'none' });
  });

  it('denies inactive or invalid authenticated principals', () => {
    expect(resolveRagAccess({ ...user, active: false })).toEqual({
      public: false,
      merchant: { kind: 'none' },
      admin: false,
    });
    expect(resolveRagAccess({ ...user, userId: 0 })).toEqual({
      public: false,
      merchant: { kind: 'none' },
      admin: false,
    });
  });

  it('returns isolated decisions so callers cannot mutate future policy results', () => {
    const first = resolveRagAccess({ ...user, active: false });
    first.public = true;
    first.merchant.kind = 'all';
    first.admin = true;

    expect(resolveRagAccess({ ...user, active: false })).toEqual({
      public: false,
      merchant: { kind: 'none' },
      admin: false,
    });
  });
});
