import type {
  MerchantResortInput,
  MerchantResortRecord,
  MerchantResortValues,
} from './merchant-resort-models.js';

export interface AdminResortInput extends MerchantResortInput {
  merchantId?: unknown;
  rating?: unknown;
  ratingCount?: unknown;
}
export interface AdminResortValues extends MerchantResortValues {
  merchantId: number | null;
  rating: number | null;
  ratingCount: number;
}
export interface AdminResortRecord extends Omit<
  MerchantResortRecord,
  'fitTags'
> {
  merchantName: string | null;
  fitTags: { value: string; label: string }[];
}
export interface AdminResortAuditContext {
  actorUserId: number;
  traceId: string;
  clientIp: string | null;
  userAgent: string | null;
}
export interface AdminResortQuery {
  keyword?: string;
  status?: string;
  merchantId?: number | null;
  skip: number;
  take: number;
}
