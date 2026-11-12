import {
  ProjectKnowledgeValidationError,
  validateProjectKnowledge,
} from '../../domain/project-knowledge-validation.js';

/** Published cross-context policy for adapters exporting public knowledge.
 * A rejection is deterministic source ineligibility, not a provider failure.
 * Keep stored values unchanged: RAG source snapshots compare the original row.
 */
export function isPublishableProjectKnowledge(source: {
  title: string;
  content: string;
  category: string;
  sourceUrl: string | null;
}): boolean {
  try {
    validateProjectKnowledge(source);
    return true;
  } catch (error) {
    if (error instanceof ProjectKnowledgeValidationError) return false;
    throw error;
  }
}
