import type {
  ProjectKnowledgeRecord,
  ProjectKnowledgeValues,
  ProjectKnowledgeChange,
  ContentPageQuery,
  ContentAuditContext,
  ContentAuditChange,
} from '../content-models.js';
export const PROJECT_KNOWLEDGE_REPOSITORY = Symbol(
  'PROJECT_KNOWLEDGE_REPOSITORY',
);
export interface ProjectKnowledgeTransaction {
  authorize(actorUserId: number, permission: string): Promise<void>;
  find(
    id: number,
    includeDeleted?: boolean,
  ): Promise<ProjectKnowledgeRecord | null>;
  create(values: ProjectKnowledgeValues): Promise<ProjectKnowledgeRecord>;
  update(
    id: number,
    version: number,
    change: ProjectKnowledgeChange,
  ): Promise<boolean>;
  appendChanged(id: number, status: string): Promise<void>;
  audit(
    context: ContentAuditContext,
    id: number,
    change: ContentAuditChange,
  ): Promise<void>;
}
export interface ProjectKnowledgeRepository {
  find(id: number): Promise<ProjectKnowledgeRecord | null>;
  findPage(
    query: ContentPageQuery,
  ): Promise<{ items: ProjectKnowledgeRecord[]; total: number }>;
  runWrite<T>(
    work: (tx: ProjectKnowledgeTransaction) => Promise<T>,
  ): Promise<T>;
}
