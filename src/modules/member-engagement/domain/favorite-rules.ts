export type FavoriteTargetType = 'resort' | 'article' | 'dynamic';

export function favoriteTargetType(value: unknown): FavoriteTargetType {
  if (value !== 'resort' && value !== 'article' && value !== 'dynamic')
    throw new RangeError('Invalid favorite target type');
  return value;
}

export function favoriteIdentity(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647)
    throw new RangeError(
      'Favorite identities must be positive 32-bit integers',
    );
  return value;
}

export function favoritePage(page: number, pageSize: number) {
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100
  )
    throw new RangeError('Invalid favorites pagination');
  const skip = (page - 1) * pageSize;
  if (!Number.isSafeInteger(skip) || skip > 2_147_483_647)
    throw new RangeError('Favorites pagination offset is too large');
  return { page, pageSize, skip };
}
