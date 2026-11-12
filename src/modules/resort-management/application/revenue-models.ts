export interface RevenueListQuery {
  resortId?: number;
  fromDate?: string;
  toDate?: string;
  page: number;
  pageSize: number;
}
export interface UpsertRevenueInput {
  resortId: number;
  reportDate: string;
  revenueAmount: string;
  note?: string | null;
}
export interface RevenueAuditContext {
  actorUserId: number;
  traceId: string;
  clientIp: string | null;
  userAgent: string | null;
}
export interface RevenueRecordView {
  revenueId: number;
  resortId: number;
  resortName: string;
  reportDate: string;
  revenueAmount: string;
  source: string;
  note: string | null;
  createdBy: { userId: number; nickname: string };
  createdAt: string;
  updatedAt: string;
}
export interface RevenueQueryRange {
  resortId?: number;
  from: Date | null;
  to: Date | null;
}

export type RevenueRequestResult = Pick<
  RevenueRecordView,
  | 'revenueId'
  | 'resortId'
  | 'reportDate'
  | 'revenueAmount'
  | 'source'
  | 'createdAt'
  | 'updatedAt'
>;
export interface RevenueRequestView {
  requestId: string;
  status: 'completed';
  createdAt: string;
  completedAt: string;
  result: RevenueRequestResult;
}
