import { describe, expect, it } from 'vitest';
import {
  assertMerchantProfile,
  canSubmitMerchantResortForReview,
  getMerchantResortStatusAfterUpdate,
  parseMerchantResortPage,
  resolveMerchantFieldPolicies,
  isResortAssetId,
} from './merchant-resort.js';

describe('merchant resort rules', () => {
  it('requires a valid merchant profile', () => {
    expect(() => assertMerchantProfile(null)).toThrow();
    expect(assertMerchantProfile(4)).toBe(4);
  });

  it('bounds offset pagination and applies defaults', () => {
    expect(parseMerchantResortPage({})).toEqual({
      page: 1,
      pageSize: 20,
      skip: 0,
    });
    expect(parseMerchantResortPage({ page: 3, pageSize: 10 }).skip).toBe(20);
    expect(() => parseMerchantResortPage({ pageSize: 101 })).toThrow(
      RangeError,
    );
  });

  it.each([Number.MAX_SAFE_INTEGER, 21_474_838, 2_147_483_648])(
    'rejects unsafe database offsets for page %s',
    (page) => {
      expect(() => parseMerchantResortPage({ page, pageSize: 100 })).toThrow(
        RangeError,
      );
    },
  );
  it.each([
    '0',
    '01',
    '-1',
    '1.1',
    '9223372036854775808',
    '9'.repeat(100),
    1,
    null,
  ])('rejects a noncanonical or out-of-range asset ID: %j', (id) => {
    expect(isResortAssetId(id)).toBe(false);
  });
  it('accepts positive database bigint asset IDs without converting to floating point', () => {
    expect(isResortAssetId('1')).toBe(true);
    expect(isResortAssetId('9223372036854775807')).toBe(true);
  });

  it('sends published edits back to review and rejects duplicate review submissions', () => {
    expect(getMerchantResortStatusAfterUpdate('published')).toBe(
      'pending_review',
    );
    expect(getMerchantResortStatusAfterUpdate('draft')).toBe('draft');
    expect(canSubmitMerchantResortForReview('draft')).toBe(true);
    expect(canSubmitMerchantResortForReview('offline')).toBe(true);
    expect(canSubmitMerchantResortForReview('pending_review')).toBe(false);
  });

  it('unions each active role field grant independently', () => {
    expect(
      resolveMerchantFieldPolicies([
        [{ fieldKey: 'a', canRead: true, canWrite: false }],
        [{ fieldKey: 'a', canRead: false, canWrite: true }],
      ]),
    ).toEqual(new Map([['a', { canRead: true, canWrite: true }]]));
  });
});
