import {
  assertCommunityImageIds,
  authorEditedStatus,
  commentModerationStatus,
  CommunityRuleError,
  dynamicModerationStatus,
  normalizeCommunityContent,
  normalizeModerationReason,
  assertCommunityId,
  assertCommunityPage,
  assertCommunityPatch,
} from './community-rules.js';
describe('Community domain rules', () => {
  it('accepts image collections beyond the former count limits without reordering', () => {
    const ids = Array.from({ length: 150 }, (_, index) => String(index + 1));
    const before = [...ids];
    expect(() => assertCommunityImageIds(ids)).not.toThrow();
    expect(() => assertCommunityPatch({ imageAssetIds: ids })).not.toThrow();
    expect(ids).toEqual(before);
  });
  it.each([0, -1, 1.2, 2147483648, Number.MAX_SAFE_INTEGER, NaN])(
    'rejects unsafe ID %s',
    (id) => {
      expect(() => assertCommunityId(id)).toThrow(CommunityRuleError);
    },
  );
  it.each([
    { page: 0 },
    { page: 1.1 },
    { pageSize: 101 },
    { page: 2147483647, pageSize: 100 },
  ])('rejects unsafe pagination %j', (query) => {
    expect(() => assertCommunityPage(query)).toThrow(CommunityRuleError);
  });
  it('rejects empty or null patches while preserving explicit unlink and empty images', () => {
    for (const patch of [{}, { content: null }, { imageAssetIds: null }])
      expect(() => assertCommunityPatch(patch as never)).toThrow(
        CommunityRuleError,
      );
    expect(() =>
      assertCommunityPatch({ resortId: null, imageAssetIds: [] }),
    ).not.toThrow();
  });
  it('rejects runtime nonstrings and excessive content/reasons with domain errors', () => {
    for (const content of [null, 5, {}, 'x'.repeat(10001)])
      expect(() =>
        normalizeCommunityContent(content as never, 'Dynamic'),
      ).toThrow(CommunityRuleError);
    expect(() =>
      normalizeCommunityContent('x'.repeat(2001), 'Comment'),
    ).toThrow(CommunityRuleError);
    expect(() => normalizeModerationReason(null as never)).toThrow(
      CommunityRuleError,
    );
    expect(() => normalizeModerationReason('x'.repeat(501))).toThrow(
      CommunityRuleError,
    );
    expect(() => assertCommunityImageIds(null as never)).toThrow(
      CommunityRuleError,
    );
  });
  it.each([
    ['pending', 'approve', 'published'],
    ['pending', 'hide', 'hidden'],
    ['published', 'hide', 'hidden'],
    ['hidden', 'restore', 'published'],
  ] as const)('allows %s via %s to %s', (from, action, to) => {
    expect(dynamicModerationStatus(from, action)).toBe(to);
  });
  it.each([
    ['pending', 'restore'],
    ['published', 'approve'],
    ['published', 'restore'],
    ['hidden', 'approve'],
    ['hidden', 'hide'],
    ['unknown', 'approve'],
  ] as const)('rejects %s via %s', (from, action) => {
    expect(() => dynamicModerationStatus(from, action)).toThrow(
      CommunityRuleError,
    );
  });
  it('requires reapproval for published edits without restoring hidden posts', () => {
    expect(authorEditedStatus('published')).toBe('pending');
    expect(authorEditedStatus('pending')).toBe('pending');
    expect(authorEditedStatus('hidden')).toBe('hidden');
    expect(() => authorEditedStatus('unknown')).toThrow(CommunityRuleError);
  });
  it('does not allow repeated or unknown comment moderation transitions', () => {
    expect(commentModerationStatus('visible', 'hide')).toBe('hidden');
    expect(commentModerationStatus('hidden', 'restore')).toBe('visible');
    expect(() => commentModerationStatus('hidden', 'hide')).toThrow(
      CommunityRuleError,
    );
    expect(() => commentModerationStatus('visible', 'restore')).toThrow(
      CommunityRuleError,
    );
    expect(() => commentModerationStatus('unknown', 'restore')).toThrow(
      CommunityRuleError,
    );
  });
  it.each([
    ['11', '11'],
    ['0'],
    ['-1'],
    ['1.2'],
    ['11x'],
    ['9223372036854775808'],
    ['11111111111111111111'],
  ])(
    'rejects invalid or duplicate Asset IDs %j before database conversion',
    (...values) => {
      expect(() => assertCommunityImageIds(values)).toThrow(CommunityRuleError);
    },
  );
  it('accepts empty images and signed-bigint bounds without reordering them', () => {
    expect(() => assertCommunityImageIds([])).not.toThrow();
    const ids = ['9223372036854775807', '11'];
    assertCommunityImageIds(ids);
    expect(ids).toEqual(['9223372036854775807', '11']);
  });
  it('normalizes content/reasons while rejecting whitespace-only content', () => {
    expect(normalizeCommunityContent(' 雪\n道 ', 'Dynamic')).toBe('雪\n道');
    expect(() => normalizeCommunityContent(' \n ', 'Comment')).toThrow(
      CommunityRuleError,
    );
    expect(normalizeModerationReason('  reviewed ')).toBe('reviewed');
    expect(normalizeModerationReason('  ')).toBeNull();
  });
});
