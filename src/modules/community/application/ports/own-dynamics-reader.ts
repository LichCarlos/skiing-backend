import type { DynamicStatus } from '../../domain/community-rules.js';
export type OwnDynamicStatus = DynamicStatus;

export interface OwnDynamicCard {
  dynamicId: number;
  author: { userId: number; nickname: string; avatarUrl: string | null };
  summary: string;
  coverUrl: string | null;
  imageCount: number;
  resort: { resortId: number; name: string } | null;
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
  status: OwnDynamicStatus;
  createdAt: string;
}

export interface OwnDynamicDetail extends OwnDynamicCard {
  contentFormat?: 'plain_text' | 'markdown_v1';
  version?: number;
  bodyAssets?: {assetId:string;url:string}[];
  customFields?: Record<string, unknown>;
  content: string;
  imageUrls: string[];
  images: { assetId: string; url: string }[];
  updatedAt: string;
}

export interface OwnDynamicsQuery {
  page?: number;
  pageSize?: number;
  status?: OwnDynamicStatus;
}

export interface OwnDynamicPage {
  items: OwnDynamicCard[];
  page: number;
  pageSize: number;
  total: number;
  hasNext: boolean;
}

export const OWN_DYNAMICS_READER = Symbol('OWN_DYNAMICS_READER');

export interface OwnDynamicsReader {
  schema(userId: number): Promise<unknown>;
  list(userId: number, query: OwnDynamicsQuery): Promise<OwnDynamicPage>;
  find(userId: number, dynamicId: number): Promise<OwnDynamicDetail | null>;
}
