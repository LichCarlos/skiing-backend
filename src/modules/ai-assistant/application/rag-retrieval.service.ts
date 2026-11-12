import { Inject, Injectable } from '@nestjs/common';
import {
  RAG_CANDIDATE_RETRIEVER,
  type RagCandidate,
  type RagCandidateRetriever,
  type RagRetrievalQuery,
} from './ports/rag-candidate-retriever.js';
import {
  resolveRagAccess,
  type RagAccessPrincipal,
} from '../domain/rag-access.js';

@Injectable()
export class RagRetrievalService {
  constructor(
    @Inject(RAG_CANDIDATE_RETRIEVER)
    private readonly candidates: RagCandidateRetriever,
  ) {}

  search(
    query: RagRetrievalQuery,
    principal: RagAccessPrincipal | null,
  ): Promise<RagCandidate[]> {
    const access = resolveRagAccess(principal);
    if (!access.public && access.merchant.kind === 'none' && !access.admin) {
      return Promise.resolve([]);
    }

    return this.candidates.search(query, access);
  }
}
