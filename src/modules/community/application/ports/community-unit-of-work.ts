import type {
  CommunityAuditChange,
  CommunityAuditContext,
  DynamicWriteInput,
  ModerationUpdate,
  StoredComment,
  StoredDynamic,
} from '../community-models.js';
export const COMMUNITY_UNIT_OF_WORK = Symbol('COMMUNITY_UNIT_OF_WORK');
export type CommunityWritePermission =
  | 'community:dynamic:create'
  | 'community:dynamic:update-own'
  | 'community:comment:create'
  | 'community:like:toggle'
  | 'content:dynamic:moderate';
export interface CommunityUnitOfWork {
  run<T>(work: (transaction: CommunityTransaction) => Promise<T>): Promise<T>;
}
export interface CommunityTransaction {
  authorize(
    userId: number,
    permission: CommunityWritePermission,
  ): Promise<void>;
  findDynamic(id: number): Promise<StoredDynamic | null>;
  createDynamic(
    authorId: number,
    input: DynamicWriteInput,
  ): Promise<{ dynamicId: number; createdAt: Date }>;
  updateDynamic(
    id: number,
    input: DynamicWriteInput,
    status: string,
  ): Promise<void>;
  replaceDynamicImages(id: number, assetIds: string[]): Promise<void>;
  deleteDynamic(id: number, deletedAt: Date): Promise<void>;
  findComment(id: number): Promise<StoredComment | null>;
  createComment(
    authorId: number,
    dynamicId: number,
    content: string,
  ): Promise<{ commentId: number; createdAt: Date }>;
  deleteComment(id: number, deletedAt: Date): Promise<void>;
  ownedReadyAssetIds(authorId: number, ids: string[]): Promise<string[]>;
  isPublishedResort(id: number): Promise<boolean>;
  isPublishedArticle(id: number): Promise<boolean>;
  setLike(
    userId: number,
    dynamicId: number,
    liked: boolean,
  ): Promise<{ liked: boolean; likeCount: number }>;
  moderateDynamic(id: number, update: ModerationUpdate): Promise<void>;
  moderateComment(id: number, update: ModerationUpdate): Promise<void>;
  dynamicChanged(id: number): Promise<void>;
  audit(
    context: CommunityAuditContext,
    change: CommunityAuditChange,
  ): Promise<void>;
}
