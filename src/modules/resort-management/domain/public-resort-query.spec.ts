import { describe, expect, it } from 'vitest';
import {
  normalizePublicResortQuery,
  type PublicResortQuery,
} from './public-resort-query.js';
import { canAdminTransitionResort } from './resort-lifecycle.js';

describe('public resort query rules', () => {
  it('normalizes pagination, trims keywords and deduplicates tags', () => {
    expect(
      normalizePublicResortQuery({
        keyword: ' Alpine ',
        page: 3,
        pageSize: 2,
        fitTags: ['beginner', 'family', 'beginner'],
      }),
    ).toMatchObject({
      keyword: 'Alpine',
      skip: 4,
      fitTags: ['beginner', 'family'],
      sortBy: 'name',
      sortOrder: 'asc',
    });
  });
  it.each([
    { page: 0 },
    { pageSize: 101 },
    { page: 2147483647, pageSize: 100 },
    { latitude: 0 },
    { latitude: NaN, longitude: 0 },
    { latitude: 91, longitude: 0 },
    { latitude: 0, longitude: 181 },
    { sortBy: 'distance' },
    { sortBy: 'Name; DROP TABLE' },
    { sortOrder: 'DESC NULLS FIRST' },
    { minPrice: 2, maxPrice: 1 },
    { minPrice: 0.1 },
    { minRating: 5.1 },
    { openStatus: 'other' },
    { keyword: 'a'.repeat(101) },
    { fitTags: [4] },
    { fitTags: Array(21).fill('tag') },
  ])('rejects invalid query %j', (query) => {
    expect(() =>
      normalizePublicResortQuery(query as PublicResortQuery),
    ).toThrow(RangeError);
  });
  it('accepts zero coordinates for distance sorting', () => {
    expect(
      normalizePublicResortQuery({
        latitude: 0,
        longitude: 0,
        sortBy: 'distance',
      }).sortBy,
    ).toBe('distance');
  });
});
describe('global resort lifecycle', () => {
  it.each(['draft', 'pending_review', 'offline'] as const)(
    'publishes %s',
    (current) => {
      expect(canAdminTransitionResort(current, 'published')).toBe(true);
    },
  );
  it.each(['draft', 'pending_review', 'offline'] as const)(
    'cannot take %s offline',
    (current) => {
      expect(canAdminTransitionResort(current, 'offline')).toBe(false);
    },
  );
  it('takes published resorts offline but does not republish them', () => {
    expect(canAdminTransitionResort('published', 'offline')).toBe(true);
    expect(canAdminTransitionResort('published', 'published')).toBe(false);
  });
});
