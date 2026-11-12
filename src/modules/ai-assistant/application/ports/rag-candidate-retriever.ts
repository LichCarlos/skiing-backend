import type { RagAccessFilter } from '../../domain/rag-access.js';

export const RAG_CANDIDATE_RETRIEVER = Symbol('RAG_CANDIDATE_RETRIEVER');

export interface RagRetrievalQuery {
  embedding: readonly number[];
  embeddingModel: string;
  limit: number;
}

export interface RagCandidate {
  chunkId: string;
  sourceKey: string;
  sourceType: string;
  sourceId: number | null;
  title: string;
  chunkIndex: number;
  content: string;
  similarity: number;
}

export interface RagCandidateRetriever {
  search(
    query: RagRetrievalQuery,
    access: RagAccessFilter,
  ): Promise<RagCandidate[]>;
}
