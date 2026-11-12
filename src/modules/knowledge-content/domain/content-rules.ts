export type ContentStatus = 'draft' | 'published' | 'withdrawn';

export function canPublishContent(status: string): boolean {
  return status === 'draft' || status === 'withdrawn';
}
export function canWithdrawContent(status: string): boolean {
  return status === 'published';
}
export function contentPage(input: { page?: number; pageSize?: number }) {
  const page = input.page ?? 1,
    pageSize = input.pageSize ?? 20;
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
    throw new RangeError('Invalid pagination');
  return { page, pageSize, skip };
}
