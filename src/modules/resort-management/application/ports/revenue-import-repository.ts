import type {
  RevenueAuditContext,
  UpsertRevenueInput,
} from '../revenue-models.js';

export interface PreparedRevenueRow {
  rowNumber: number;
  input: UpsertRevenueInput | null;
  error: string | null;
}
export interface RevenueImportResult {
  totalRows: number;
  succeededRows: number;
  failedRows: number;
  results: {
    rowNumber: number;
    success: boolean;
    revenueId: number | null;
    error: string | null;
  }[];
}
export interface RevenueImportJobView {
  jobId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  createdAt: string;
  updatedAt: string;
  totalRows: number;
  processedRows: number;
  succeededRows: number;
  failedRows: number;
  result: RevenueImportResult | null;
}
export interface ImportClaim {
  jobId: string;
  lockToken: string;
}
export const REVENUE_IMPORT_REPOSITORY = Symbol('REVENUE_IMPORT_REPOSITORY');
export interface RevenueImportRepository {
  create(
    requestId: string,
    fileHash: string,
    rows: PreparedRevenueRow[],
    audit: RevenueAuditContext,
  ): Promise<RevenueImportJobView>;
  find(actorUserId: number, jobId: string): Promise<RevenueImportJobView>;
  claim(jobId: string): Promise<ImportClaim | null>;
  processOne(claim: ImportClaim): Promise<'processed' | 'completed' | 'lost'>;
  release(claim: ImportClaim): Promise<void>;
  defer(claim: ImportClaim): Promise<void>;
  ready(limit: number): Promise<string[]>;
  retain(): Promise<void>;
}
