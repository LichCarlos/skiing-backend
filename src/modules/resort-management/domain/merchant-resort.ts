export type MerchantResortStatus =
  'draft' | 'pending_review' | 'published' | 'offline';

export interface MerchantResortFieldGrant {
  fieldKey: string;
  canRead: boolean;
  canWrite: boolean;
}

export function resolveMerchantFieldPolicies(
  grantsByRole: readonly (readonly MerchantResortFieldGrant[])[],
): Map<string, { canRead: boolean; canWrite: boolean }> {
  const resolved = new Map<string, { canRead: boolean; canWrite: boolean }>();
  for (const grants of grantsByRole) {
    for (const grant of grants) {
      const current = resolved.get(grant.fieldKey) ?? {
        canRead: false,
        canWrite: false,
      };
      current.canRead ||= grant.canRead;
      current.canWrite ||= grant.canWrite;
      resolved.set(grant.fieldKey, current);
    }
  }
  return resolved;
}

export function parseMerchantResortPage(input: {
  page?: unknown;
  pageSize?: unknown;
}): { page: number; pageSize: number; skip: number } {
  const page = input.page === undefined ? 1 : Number(input.page);
  const pageSize = input.pageSize === undefined ? 20 : Number(input.pageSize);
  const skip = (page - 1) * pageSize;
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100 ||
    !Number.isSafeInteger(skip) ||
    skip > 2_147_483_647
  ) {
    throw new RangeError('Invalid merchant resort pagination');
  }
  return { page, pageSize, skip };
}

export function isResortAssetId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[1-9]\d{0,18}$/.test(value) &&
    BigInt(value) <= 9_223_372_036_854_775_807n
  );
}

export function getMerchantResortStatusAfterUpdate(
  status: MerchantResortStatus,
): MerchantResortStatus {
  return status === 'published' ? 'pending_review' : status;
}

export function canSubmitMerchantResortForReview(
  status: MerchantResortStatus,
): boolean {
  return status === 'draft' || status === 'offline';
}

export function assertMerchantProfile(merchantId: number | null): number {
  if (
    !Number.isSafeInteger(merchantId) ||
    merchantId === null ||
    merchantId < 1
  ) {
    throw new RangeError('Merchant profile is required');
  }
  return merchantId;
}
