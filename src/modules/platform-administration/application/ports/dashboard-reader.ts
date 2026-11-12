export interface AccountCounts {
  total: number;
  active: number;
  disabled: number;
}
export interface DashboardSummary {
  generatedAt: string;
  users: AccountCounts | null;
  merchants: AccountCounts | null;
  resorts: {
    total: number;
    draft: number;
    pendingReview: number;
    published: number;
    offline: number;
  } | null;
  articles: {
    total: number;
    draft: number;
    published: number;
    withdrawn: number;
  } | null;
  dynamics: {
    total: number;
    pending: number;
    published: number;
    hidden: number;
  } | null;
  rag: { failed: number } | null;
  revenue: {
    amount: string;
    currency: 'CNY';
    period: 'all-time';
    scope: 'all' | 'merchant';
  } | null;
}
export const DASHBOARD_READER = Symbol('DASHBOARD_READER');
export interface DashboardReader {
  summarize(actorUserId: number): Promise<DashboardSummary>;
}
