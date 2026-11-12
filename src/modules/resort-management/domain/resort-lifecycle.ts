import type { MerchantResortStatus } from './merchant-resort.js';

export function canAdminTransitionResort(
  current: MerchantResortStatus,
  target: 'published' | 'offline',
): boolean {
  return target === 'published'
    ? ['draft', 'pending_review', 'offline'].includes(current)
    : current === 'published';
}
