import type { RagCandidate } from './rag-candidate-retriever.js';

export const RAG_EVIDENCE_VALIDATOR = Symbol('RAG_EVIDENCE_VALIDATOR');

export type RagEvidenceSnapshot = Readonly<Omit<RagCandidate, 'similarity'>>;

export interface RagEvidenceValidator {
  areCurrent(
    evidence: readonly RagEvidenceSnapshot[],
    embeddingModel: string,
  ): Promise<boolean>;
}

export class RagEvidenceChangedError extends Error {
  constructor() {
    super('RAG evidence is no longer current');
    this.name = 'RagEvidenceChangedError';
  }
}
