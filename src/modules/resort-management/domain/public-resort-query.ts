export const RESORT_SORT_FIELDS = [
  'name',
  'price',
  'rating',
  'distance',
] as const;
export interface PublicResortQuery {
  keyword?: string;
  province?: string;
  city?: string;
  district?: string;
  fitTags?: string[];
  minPrice?: number;
  maxPrice?: number;
  minRating?: number;
  openStatus?: string;
  latitude?: number;
  longitude?: number;
  page?: number;
  pageSize?: number;
  sortBy?: (typeof RESORT_SORT_FIELDS)[number];
  sortOrder?: 'asc' | 'desc';
}
export interface NormalizedPublicResortQuery extends PublicResortQuery {
  fitTags: string[];
  page: number;
  pageSize: number;
  skip: number;
  sortBy: (typeof RESORT_SORT_FIELDS)[number];
  sortOrder: 'asc' | 'desc';
}
export function normalizePublicResortQuery(
  query: PublicResortQuery,
): NormalizedPublicResortQuery {
  const page = query.page ?? 1,
    pageSize = query.pageSize ?? 20;
  const skip = (page - 1) * pageSize;
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100 ||
    !Number.isSafeInteger(skip) ||
    skip > 2_147_483_647
  )
    throw new RangeError('Invalid resort pagination');
  if ((query.latitude === undefined) !== (query.longitude === undefined))
    throw new RangeError('latitude and longitude must be provided together');
  for (const [value, min, max] of [
    [query.latitude, -90, 90],
    [query.longitude, -180, 180],
    [query.minRating, 0, 5],
  ] as const)
    if (
      value !== undefined &&
      (!Number.isFinite(value) || value < min || value > max)
    )
      throw new RangeError('Invalid resort coordinates or rating');
  for (const value of [query.minPrice, query.maxPrice])
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0))
      throw new RangeError('Invalid resort price');
  if (
    query.minPrice !== undefined &&
    query.maxPrice !== undefined &&
    query.minPrice > query.maxPrice
  )
    throw new RangeError('minPrice must not exceed maxPrice');
  const sortBy = query.sortBy ?? 'name',
    sortOrder = query.sortOrder ?? 'asc';
  if (
    !RESORT_SORT_FIELDS.includes(sortBy) ||
    !['asc', 'desc'].includes(sortOrder)
  )
    throw new RangeError('Invalid resort sort');
  if (sortBy === 'distance' && query.latitude === undefined)
    throw new RangeError('Distance sorting requires coordinates');
  for (const [value, max] of [
    [query.keyword, 100],
    [query.province, 50],
    [query.city, 50],
    [query.district, 50],
  ] as const)
    if (
      value !== undefined &&
      (typeof value !== 'string' || value.length > max)
    )
      throw new RangeError('Invalid resort text filter');
  if (
    query.openStatus !== undefined &&
    !['open', 'closed', 'limited', 'unknown'].includes(query.openStatus)
  )
    throw new RangeError('Invalid resort openStatus');
  if (
    query.fitTags !== undefined &&
    (!Array.isArray(query.fitTags) ||
      query.fitTags.length > 20 ||
      !query.fitTags.every((tag) => typeof tag === 'string'))
  )
    throw new RangeError('Invalid resort fitTags');
  return {
    ...query,
    keyword: query.keyword?.trim(),
    fitTags: [...new Set(query.fitTags ?? [])],
    page,
    pageSize,
    skip,
    sortBy,
    sortOrder,
  };
}
