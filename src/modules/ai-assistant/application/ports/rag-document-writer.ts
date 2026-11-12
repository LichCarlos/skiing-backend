import type { RagSourceState } from '../../domain/rag-source-state.js';

export const RAG_DOCUMENT_WRITER = Symbol('RAG_DOCUMENT_WRITER');

export type RagSourceType =
  'resort' | 'article' | 'dynamic' | 'project_doc' | 'dictionary' | 'revenue';

export type IndexFailureReason = 'embedding_failed' | 'index_commit_failed';

export type RagAccessScope = 'public' | 'merchant' | 'admin';

export interface RagIndexDocument {
  sourceKey: string;
  sourceType: RagSourceType;
  sourceId: number | null;
  title: string;
  content: string;
  accessScope: RagAccessScope;
  merchantId: number | null;
  sourceUpdatedAt: Date;
  sourceState?: RagSourceState;
}

export interface RagIndexedChunk {
  index: number;
  content: string;
  embedding: readonly number[];
}

export type RagIndexClaim =
  | { kind: 'skip' | 'manual-disabled' | 'stale' }
  | {
      kind: 'claimed';
      ragDocumentId: number;
      controlVersion: number;
      indexGeneration: bigint;
    };

export interface RagIndexOptions {
  force?: boolean;
  expectedControlVersion?: number;
}

export interface RagDocumentWriter {
  beginIndexing(
    document: RagIndexDocument,
    contentHash: string,
    embeddingModel: string,
    chunkCount: number,
    options?: RagIndexOptions,
  ): Promise<RagIndexClaim>;
  replaceChunksAndMarkIndexed(
    sourceKey: string,
    contentHash: string,
    embeddingModel: string,
    claim: Extract<RagIndexClaim, { kind: 'claimed' }>,
    chunks: readonly RagIndexedChunk[],
  ): Promise<boolean>;
  markFailed(
    sourceKey: string,
    contentHash: string,
    claim: Extract<RagIndexClaim, { kind: 'claimed' }>,
    reason?: IndexFailureReason,
  ): Promise<boolean>;
  isCurrentCommand(sourceKey: string, controlVersion: number): Promise<boolean>;
  disable(sourceKey: string, expectedControlVersion?: number): Promise<boolean>;
}
