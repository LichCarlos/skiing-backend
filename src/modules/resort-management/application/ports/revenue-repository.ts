import type { MerchantResortAccess } from '../../domain/resort-management-scope.js';
import type {
  RevenueAuditContext,
  RevenueQueryRange,
  RevenueRecordView,
  RevenueRequestView,
  UpsertRevenueInput,
} from '../revenue-models.js';

export const REVENUE_REPOSITORY = Symbol('REVENUE_REPOSITORY');
export interface RevenueRepository {
  adminPage(
    actorUserId: number,
    query: RevenueQueryRange & { skip: number; take: number },
  ): Promise<{ items: RevenueRecordView[]; total: number }>;
  upsertIdempotent(
    body: UpsertRevenueInput,
    requestId: string,
    audit: RevenueAuditContext,
  ): Promise<RevenueRecordView>;
  requestResult(
    actorUserId: number,
    requestId: string,
  ): Promise<RevenueRequestView>;
  findPage(
    access: MerchantResortAccess,
    query: RevenueQueryRange & { skip: number; take: number },
  ): Promise<{ items: RevenueRecordView[]; total: number }>;
  summarize(
    access: MerchantResortAccess,
    query: RevenueQueryRange,
  ): Promise<{
    resortId: number | null;
    resortName: string | null;
    totalAmount: string;
    daily: { date: string; amount: string }[];
  }>;
  upsert(
    body: UpsertRevenueInput,
    source: 'manual' | 'import',
    audit: RevenueAuditContext,
  ): Promise<RevenueRecordView>;
}
