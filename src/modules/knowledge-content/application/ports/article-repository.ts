import type {
  ArticleRecord,
  ArticleValues,
  ArticleChange,
  ContentPageQuery,
  ContentAuditContext,
  ContentAuditChange,
} from '../content-models.js';
import type { ArticleAccess } from '../../domain/article-scope.js';
import type {
  CustomFieldDefinition,
  CustomFieldAccessPolicy,
} from '../../../platform-administration/domain/custom-field-validation.js';
export const ARTICLE_REPOSITORY = Symbol('ARTICLE_REPOSITORY');
export interface ArticleFieldContext {
  definitions: readonly (CustomFieldDefinition & { schemaVersion: number })[];
  policies: ReadonlyMap<string, CustomFieldAccessPolicy>;
  dictionaryValues: ReadonlyMap<string, ReadonlySet<string>>;
  groups: readonly ArticleFieldGroup[];
}
export interface ArticleFieldSchemaDefinition {
  fieldDefinitionId: number;
  fieldKey: string;
  label: string;
  dataType: CustomFieldDefinition['dataType'];
  groupKey: string;
  sortOrder: number;
  required: boolean;
  defaultValue: unknown;
  optionsDictType: string | null;
  validation: CustomFieldDefinition['validation'];
  schemaVersion: number;
}
export interface ArticleFieldGroup {
  groupKey: string;
  label: string;
  sortOrder: number;
  fields: readonly ArticleFieldSchemaDefinition[];
}
export interface ArticleReadSession {
  readonly fields: ArticleFieldContext;
  find(id: number): Promise<ArticleRecord | null>;
  findPage(
    query: ContentPageQuery,
  ): Promise<{ items: ArticleRecord[]; total: number }>;
}
export interface ArticleTransaction extends ArticleReadSession {
  assertReferences(values: ArticleValues, existingArticleId?: number): Promise<void>;
  create(values: ArticleValues, actorUserId: number): Promise<ArticleRecord>;
  update(id: number, version: number, change: ArticleChange): Promise<boolean>;
  appendChanged(id: number, status: string): Promise<void>;
  audit(
    context: ContentAuditContext,
    id: number,
    change: ContentAuditChange,
  ): Promise<void>;
}
export interface ArticleRepository {
  runRead<T>(
    access: ArticleAccess,
    actorUserId: number,
    work: (tx: ArticleReadSession) => Promise<T>,
  ): Promise<T>;
  runWrite<T>(
    access: ArticleAccess,
    actorUserId: number,
    work: (tx: ArticleTransaction) => Promise<T>,
  ): Promise<T>;
}
