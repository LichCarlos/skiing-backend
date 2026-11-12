import type { OwnDynamicCard } from './own-dynamics-reader.js';
import type { PageQuery } from '../community-models.js';
export type PublicDynamicCard = Omit<OwnDynamicCard, 'status'> & {
  status: 'published';
};
export interface PublicDynamicDetail extends PublicDynamicCard {
  contentFormat?: 'plain_text' | 'markdown_v1';
  version?: number;
  bodyAssets?: {assetId:string;url:string}[];
  content: string;
  imageUrls: string[];
  updatedAt: string;
}
export interface PublicFeedReadQuery {
  keyword?: string;
  limit: number;
  before: { createdAt: Date; dynamicId: number } | null;
}
export interface PublicComment {
  commentId: number;
  author: OwnDynamicCard['author'];
  content: string;
  createdAt: string;
  status: 'visible';
}
export interface PublicCommentPage {
  items: PublicComment[];
  page: number;
  pageSize: number;
  total: number;
  hasNext: boolean;
}
export const PUBLIC_COMMUNITY_READER = Symbol('PUBLIC_COMMUNITY_READER');
export interface PublicCommunityReader {
  dynamics(
    query: PublicFeedReadQuery,
    userId?: number,
  ): Promise<{ items: PublicDynamicCard[]; hasNext: boolean }>;
  dynamic(id: number, userId?: number): Promise<PublicDynamicDetail | null>;
  comments(
    dynamicId: number,
    query: PageQuery,
  ): Promise<PublicCommentPage | null>;
}
