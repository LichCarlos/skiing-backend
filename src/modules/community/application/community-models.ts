import type {
  DynamicModerationAction,
  CommentModerationAction,
} from '../domain/community-rules.js';
export interface DynamicWriteInput {
  contentFormat?: 'plain_text' | 'markdown_v1';
  expectedVersion?: number;
  customFields?: Record<string, unknown>;
  content: string;
  imageAssetIds: string[];
  resortId?: number;
}
export type DynamicPatchInput = Partial<Omit<DynamicWriteInput, 'resortId'>> & {
  resortId?: number | null;
};
export interface PageQuery {
  page?: number;
  pageSize?: number;
}
export interface DynamicFeedQuery {
  keyword?: string;
  cursor?: string;
  limit?: number;
}
export interface AdminDynamicQuery extends PageQuery {
  status?: string;
  keyword?: string;
}
export interface DynamicModerationInput {
  action: DynamicModerationAction;
  reason?: string;
}
export interface CommentModerationInput {
  action: CommentModerationAction;
  reason?: string;
}
export interface CommunityAuditContext {
  actorUserId: number;
  traceId: string;
  clientIp: string | null;
  userAgent: string | null;
}
export type CommunityJson =
  | string
  | number
  | boolean
  | null
  | CommunityJson[]
  | { [key: string]: CommunityJson };
export interface CommunityAuditChange {
  actionKey: string;
  targetType: 'Dynamic' | 'Comment';
  targetId: number;
  reason: string | null;
  before: { [key: string]: CommunityJson };
  after: { [key: string]: CommunityJson };
}
export interface ModerationState {
  status: string;
  moderatedAt: Date | null;
  moderatedByUserId: number | null;
  moderationReason: string | null;
}
export interface StoredDynamic extends ModerationState {
  contentFormat?: 'plain_text' | 'markdown_v1';
  version?: number;
  authorId: number;
  content: string;
  resortId: number | null;
  imageAssetIds: string[];
}
export interface StoredComment extends ModerationState {
  authorId: number;
  dynamicId: number;
}
export interface ModerationUpdate {
  status: string;
  moderatedAt: Date;
  moderatedByUserId: number;
  moderationReason: string | null;
}
