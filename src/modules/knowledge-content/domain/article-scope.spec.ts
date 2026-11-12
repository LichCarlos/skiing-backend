import { describe, expect, it } from 'vitest';
import {
  resolveArticleAccess,
  mayCreateArticle,
  articleActorMatches,
} from './article-scope.js';

describe('article scope domain', () => {
  it('supports self, selected and global without introducing merchant ownership', () => {
    expect(resolveArticleAccess({ kind: 'self', userId: 3 })).toEqual({
      kind: 'self',
      userId: 3,
    });
    expect(resolveArticleAccess({ kind: 'selected', ids: [2, 2, 3] })).toEqual({
      kind: 'selected',
      ids: [2, 3],
    });
    expect(resolveArticleAccess({ kind: 'all' })).toEqual({ kind: 'all' });
    expect(
      resolveArticleAccess({ kind: 'merchant', merchantId: 4 }),
    ).toBeNull();
    expect(resolveArticleAccess(undefined)).toBeNull();
  });
  it('denies malformed selected/self identifiers and selected creation', () => {
    for (const ids of [[], [0], [-1], [1.5], [Number.MAX_SAFE_INTEGER + 1]])
      expect(resolveArticleAccess({ kind: 'selected', ids })).toBeNull();
    expect(resolveArticleAccess({ kind: 'self', userId: 0 })).toBeNull();
    expect(mayCreateArticle({ kind: 'selected', ids: [1] })).toBe(false);
    expect(mayCreateArticle({ kind: 'self', userId: 3 })).toBe(true);
    expect(articleActorMatches({ kind: 'self', userId: 3 }, 4)).toBe(false);
    expect(articleActorMatches({ kind: 'all' }, 4)).toBe(true);
  });
  it.each([
    0,
    -1,
    1.5,
    2147483648,
    Number.MAX_SAFE_INTEGER,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])('denies invalid database scope and actor identifier %s', (id) => {
    expect(resolveArticleAccess({ kind: 'self', userId: id })).toBeNull();
    expect(resolveArticleAccess({ kind: 'selected', ids: [1, id] })).toBeNull();
    expect(articleActorMatches({ kind: 'all' }, id)).toBe(false);
    expect(articleActorMatches({ kind: 'selected', ids: [1] }, id)).toBe(false);
  });
  it('accepts the positive int4 upper boundary', () => {
    expect(resolveArticleAccess({ kind: 'self', userId: 2147483647 })).toEqual({
      kind: 'self',
      userId: 2147483647,
    });
    expect(
      resolveArticleAccess({ kind: 'selected', ids: [2147483647] }),
    ).toEqual({ kind: 'selected', ids: [2147483647] });
    expect(articleActorMatches({ kind: 'all' }, 2147483647)).toBe(true);
  });
});
