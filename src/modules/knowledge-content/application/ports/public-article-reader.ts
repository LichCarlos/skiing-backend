import type {
  ContentPageQuery,
  PublicArticleRecord,
} from '../content-models.js';
export const PUBLIC_ARTICLE_READER = Symbol('PUBLIC_ARTICLE_READER');
export interface PublicArticleReader {
  categories(): Promise<{ value: string; label: string }[]>;
  findPage(
    query: ContentPageQuery,
    userId?: number,
  ): Promise<{ items: PublicArticleRecord[]; total: number }>;
  find(id: number, userId?: number): Promise<PublicArticleRecord | null>;
}
