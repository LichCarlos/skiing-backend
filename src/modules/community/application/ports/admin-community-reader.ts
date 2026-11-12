import type { AdminDynamicQuery, PageQuery } from '../community-models.js';
export interface AdminModerationView {
  status: string;
  moderatedAt: string | null;
  moderatedByUserId: number | null;
  moderationReason: string | null;
}
export interface AdminDynamicView extends AdminModerationView {
  dynamicId: number;
  authorId: number;
  authorNickname: string;
  content: string;
  resortId: number | null;
  imageUrls: string[];
  createdAt: string;
  updatedAt: string;
}
export interface AdminCommentView extends AdminModerationView {
  commentId: number;
  dynamicId: number;
  authorId: number;
  authorNickname: string;
  content: string;
  createdAt: string;
}
export interface AdminCommunityPage<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  hasNext: boolean;
}
export const ADMIN_COMMUNITY_READER = Symbol('ADMIN_COMMUNITY_READER');
export interface AdminCommunityReader {
  listDynamics(
    query: AdminDynamicQuery,
  ): Promise<AdminCommunityPage<AdminDynamicView>>;
  getDynamic(id: number): Promise<AdminDynamicView | null>;
  listComments(
    id: number,
    query: PageQuery,
  ): Promise<AdminCommunityPage<AdminCommentView> | null>;
}
