import type { RagSourceType } from './rag-document-writer.js';

export const RAG_SOURCE_MANAGEMENT_REPOSITORY = Symbol(
  'RAG_SOURCE_MANAGEMENT_REPOSITORY',
);

export type ManagedRagStatus = 'pending' | 'indexed' | 'failed' | 'disabled';

export interface RagSourceVO {
  ragDocumentId: number;
  sourceKey: string;
  sourceType: Exclude<RagSourceType, 'revenue'>;
  sourceId: number | null;
  title: string;
  accessScope: 'public' | 'merchant' | 'admin';
  status: ManagedRagStatus;
  manualDisabled: boolean;
  controlVersion: number;
  sourceEligible: boolean;
  chunkCount: number;
  embeddingModels: string[];
  embeddingDimension: 1024;
  sourceUpdatedAt: Date;
  indexedAt: Date | null;
  createdAt: Date;
  failureReason?: string | null;
  failureAt?: Date | null;
  failureCode: 'indexing_failed' | null;
}

export interface RagSourceListInput {
  page: number;
  pageSize: number;
  sourceType?: Exclude<RagSourceType, 'revenue'>;
  status?: ManagedRagStatus;
  manualDisabled?: boolean;
  keyword?: string;
}

export interface RagSourceManagementRepository {
  list(
    userId: number,
    input: RagSourceListInput,
  ): Promise<{ items: RagSourceVO[]; total: number }>;
  find(userId: number, ragDocumentId: number): Promise<RagSourceVO | null>;
  reindex(
    userId: number,
    ragDocumentId: number,
    input: { expectedVersion: number; reason: string; traceId: string },
  ): Promise<{ source: RagSourceVO; eventId: string }>;
  setEnabled(
    userId: number,
    ragDocumentId: number,
    input: {
      enabled: boolean;
      expectedVersion: number;
      reason: string;
      traceId: string;
    },
  ): Promise<{ source: RagSourceVO; eventId: string | null }>;
}
