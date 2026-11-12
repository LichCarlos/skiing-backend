type ArticleContentFormat = 'plain_text' | 'markdown_v1';
import type { ContentStatus } from '../domain/content-rules.js';

export interface ContentAuditContext {
  actorUserId: number;
  traceId: string;
  clientIp: string | null;
  userAgent: string | null;
}
export interface ContentListQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: string;
}
export interface ContentPageQuery {
  skip: number;
  take: number;
  keyword?: string;
  status?: string;
  categoryValue?: string;
}
export interface ContentAuditChange {
  actionKey: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
}
export interface ArticleInput {
  contentFormat?: ArticleContentFormat;
  expectedVersion?: number;
  title: string;
  summary: string;
  body: string;
  categoryValue: string;
  coverAssetId?: string | null;
  customFields?: Record<string, unknown>;
}
export interface ArticleValues {
  contentFormat?: ArticleContentFormat;
  title: string;
  summary: string;
  body: string;
  categoryValue: string;
  coverAssetId: string | null;
  customFields: Record<string, unknown>;
  schemaVersion: number;
}
export interface ArticleRecord extends Omit<ArticleValues, 'customFields'> {
  bodyAssets?: { assetId: string; storageKey: string }[];
  customFields: unknown;
  articleId: number;
  authorId: number | null;
  authorName: string | null;
  status: ContentStatus;
  publishTime: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  category: { value: string; label: string };
  coverStorageKey: string | null;
}
export interface ArticleChange {
  values?: ArticleValues;
  status?: ContentStatus;
  publishTime?: Date;
  deletedAt?: Date;
}
export interface PublicArticleQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  categoryValue?: string;
}
export type PublicArticleRecord = Pick<
  ArticleRecord,
  | 'articleId'
  | 'title'
  | 'summary'
  | 'body'
  | 'contentFormat'
  | 'bodyAssets'
  | 'authorName'
  | 'category'
  | 'coverStorageKey'
> & { publishTime: Date; favoriteByMe: boolean };

export interface ProjectKnowledgeInput {
  title: string;
  content: string;
  category: string;
  sourceUrl?: string | null;
}
export interface ProjectKnowledgeUpdate extends ProjectKnowledgeInput {
  version: number;
}
export interface ProjectKnowledgeValues {
  title: string;
  content: string;
  category: string;
  sourceUrl: string | null;
}
export interface ProjectKnowledgeRecord extends ProjectKnowledgeValues {
  projectKnowledgeId: number;
  status: ContentStatus;
  publishTime: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}
export interface ProjectKnowledgeChange {
  values?: ProjectKnowledgeValues;
  status?: ContentStatus;
  publishTime?: Date;
  deletedAt?: Date;
}
