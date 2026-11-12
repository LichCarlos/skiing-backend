export class CommunityRuleError extends Error {
  constructor(
    readonly kind: 'invalid' | 'conflict' | 'reference',
    message: string,
  ) {
    super(message);
  }
}
export type DynamicStatus = 'pending' | 'published' | 'hidden';
export type DynamicModerationAction = 'approve' | 'hide' | 'restore';
export type CommentModerationAction = 'hide' | 'restore';
export function normalizeCommunityContent(
  content: string,
  kind: 'Dynamic' | 'Comment',
): string {
  if (
    typeof content !== 'string' ||
    Array.from(content).length > (kind === 'Dynamic' ? 10000 : 2000)
  )
    throw new CommunityRuleError('invalid', `Invalid ${kind} content`);
  const normalized = content.trim();
  if (!normalized)
    throw new CommunityRuleError('invalid', `${kind} content cannot be blank`);
  return normalized;
}
export function assertCommunityImageIds(ids: readonly string[]): void {
  if (!Array.isArray(ids))
    throw new CommunityRuleError('invalid', 'Image asset IDs must be an array');
  if (
    new Set(ids).size !== ids.length ||
    ids.some(
      (id) =>
        typeof id !== 'string' ||
        !/^[1-9]\d{0,18}$/.test(id) ||
        BigInt(id) > 9_223_372_036_854_775_807n,
    )
  ) {
    throw new CommunityRuleError('reference', 'Image asset not found');
  }
}
export function authorEditedStatus(current: string): DynamicStatus {
  if (current === 'published' || current === 'pending') return 'pending';
  if (current === 'hidden') return 'hidden';
  throw new CommunityRuleError('conflict', `Cannot edit a ${current} dynamic`);
}
export function dynamicModerationStatus(
  current: string,
  action: DynamicModerationAction,
): 'published' | 'hidden' {
  if (action === 'approve' && current === 'pending') return 'published';
  if (action === 'hide' && (current === 'pending' || current === 'published'))
    return 'hidden';
  if (action === 'restore' && current === 'hidden') return 'published';
  throw new CommunityRuleError(
    'conflict',
    `Cannot ${action} a ${current} dynamic`,
  );
}
export function commentModerationStatus(
  current: string,
  action: CommentModerationAction,
): 'visible' | 'hidden' {
  if (action === 'hide' && current === 'visible') return 'hidden';
  if (action === 'restore' && current === 'hidden') return 'visible';
  throw new CommunityRuleError(
    'conflict',
    `Cannot ${action} a ${current} comment`,
  );
}
export function normalizeModerationReason(reason?: string): string | null {
  if (
    reason !== undefined &&
    (typeof reason !== 'string' || Array.from(reason).length > 500)
  )
    throw new CommunityRuleError('invalid', 'Invalid moderation reason');
  return reason?.trim() || null;
}
export function assertCommunityId(id: number): void {
  if (!Number.isSafeInteger(id) || id < 1 || id > 2_147_483_647)
    throw new CommunityRuleError('invalid', 'Invalid community ID');
}
export function assertCommunityPage(query: {
  page?: number;
  pageSize?: number;
}): void {
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
    throw new CommunityRuleError('invalid', 'Invalid community pagination');
}
export function assertCommunityPatch(patch: {
  content?: string;
  imageAssetIds?: string[];
  resortId?: number | null;
}): void {
  if (
    !patch ||
    !['content', 'imageAssetIds', 'resortId', 'customFields'].some(
      (key) => patch[key as keyof typeof patch] !== undefined,
    )
  )
    throw new CommunityRuleError(
      'invalid',
      'At least one dynamic field is required',
    );
  if (patch.content !== undefined)
    normalizeCommunityContent(patch.content, 'Dynamic');
  if (patch.imageAssetIds !== undefined)
    assertCommunityImageIds(patch.imageAssetIds);
  if (patch.resortId !== undefined && patch.resortId !== null)
    assertCommunityId(patch.resortId);
}
