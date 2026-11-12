import {
  COMMUNITY_CONTENT_PARSER,
  unavailableContentParser,
  type CommunityContentParser,
} from './ports/content-parser.js';
import { validateReferences } from './community-writes.js';
import {
  Inject,
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import {
  commentModerationStatus,
  dynamicModerationStatus,
  normalizeModerationReason,
  assertCommunityId,
  assertCommunityPage,
} from '../domain/community-rules.js';
import type {
  AdminDynamicQuery,
  CommentModerationInput,
  CommunityAuditContext,
  DynamicModerationInput,
  ModerationState,
  PageQuery,
} from './community-models.js';
import {
  runCommunityTransaction,
  communityInput,
} from './community-transaction.js';
import {
  ADMIN_COMMUNITY_READER,
  type AdminCommunityReader,
} from './ports/admin-community-reader.js';
import {
  COMMUNITY_UNIT_OF_WORK,
  type CommunityUnitOfWork,
} from './ports/community-unit-of-work.js';
export type { CommunityAuditContext } from './community-models.js';

@Injectable()
export class AdminCommunityService {
  constructor(
    @Inject(ADMIN_COMMUNITY_READER)
    private readonly reader: AdminCommunityReader,
    @Inject(COMMUNITY_UNIT_OF_WORK) private readonly uow: CommunityUnitOfWork,
    @Inject(COMMUNITY_CONTENT_PARSER)
    private readonly contentParser: CommunityContentParser = unavailableContentParser,
  ) {}
  listDynamics(query: AdminDynamicQuery) {
    communityInput(() => assertCommunityPage(query));
    return this.reader.listDynamics(query);
  }
  async getDynamic(id: number) {
    communityInput(() => assertCommunityId(id));
    const result = await this.reader.getDynamic(id);
    if (!result) throw new NotFoundException('Dynamic not found');
    return result;
  }
  async listComments(id: number, query: PageQuery) {
    communityInput(() => {
      assertCommunityId(id);
      assertCommunityPage(query);
    });
    const result = await this.reader.listComments(id, query);
    if (!result) throw new NotFoundException('Dynamic not found');
    return result;
  }
  moderateDynamic(
    dynamicId: number,
    input: DynamicModerationInput,
    audit: CommunityAuditContext,
  ) {
    return runCommunityTransaction(this.uow, async (tx) => {
      await tx.authorize(audit.actorUserId, 'content:dynamic:moderate');
      assertCommunityId(dynamicId);
      const current = await tx.findDynamic(dynamicId);
      if (!current) throw new NotFoundException('Dynamic not found');
      if (current.version !== undefined && current.version >= 2147483647)
        throw new ConflictException('Dynamic version is exhausted');
      const status = dynamicModerationStatus(current.status, input.action);
      if (status === 'published' && current.contentFormat === 'markdown_v1') {
        await validateReferences(
          tx,
          current.authorId,
          {
            content: current.content,
            contentFormat: current.contentFormat,
            imageAssetIds: current.imageAssetIds,
            ...(current.resortId !== null
              ? { resortId: current.resortId }
              : {}),
          },
          this.contentParser,
        );
      }
      const moderatedAt = new Date();
      const reason = normalizeModerationReason(input.reason);
      await tx.moderateDynamic(dynamicId, {
        status,
        moderatedAt,
        moderatedByUserId: audit.actorUserId,
        moderationReason: reason,
      });
      await tx.dynamicChanged(dynamicId);
      await tx.audit(audit, {
        actionKey: `community.dynamic.${input.action}`,
        targetType: 'Dynamic',
        targetId: dynamicId,
        reason,
        before: moderationSnapshot(current),
        after: {
          status,
          moderatedAt: moderatedAt.toISOString(),
          moderationReason: reason,
        },
      });
      return {
        dynamicId,
        status,
        moderatedAt: moderatedAt.toISOString(),
        moderatedByUserId: audit.actorUserId,
        moderationReason: reason,
      };
    });
  }
  moderateComment(
    commentId: number,
    input: CommentModerationInput,
    audit: CommunityAuditContext,
  ) {
    return runCommunityTransaction(this.uow, async (tx) => {
      await tx.authorize(audit.actorUserId, 'content:dynamic:moderate');
      assertCommunityId(commentId);
      const current = await tx.findComment(commentId);
      if (!current) throw new NotFoundException('Comment not found');
      const status = commentModerationStatus(current.status, input.action);
      const moderatedAt = new Date();
      const reason = normalizeModerationReason(input.reason);
      await tx.moderateComment(commentId, {
        status,
        moderatedAt,
        moderatedByUserId: audit.actorUserId,
        moderationReason: reason,
      });
      await tx.audit(audit, {
        actionKey: `community.comment.${input.action}`,
        targetType: 'Comment',
        targetId: commentId,
        reason,
        before: moderationSnapshot(current),
        after: {
          status,
          moderatedAt: moderatedAt.toISOString(),
          moderationReason: reason,
        },
      });
      return {
        commentId,
        status,
        moderatedAt: moderatedAt.toISOString(),
        moderatedByUserId: audit.actorUserId,
        moderationReason: reason,
      };
    });
  }
  removeDynamic(dynamicId: number, audit: CommunityAuditContext) {
    return runCommunityTransaction(this.uow, async (tx) => {
      await tx.authorize(audit.actorUserId, 'content:dynamic:moderate');
      assertCommunityId(dynamicId);
      const current = await tx.findDynamic(dynamicId);
      if (!current) throw new NotFoundException('Dynamic not found');
      const deletedAt = new Date();
      await tx.deleteDynamic(dynamicId, deletedAt);
      await tx.dynamicChanged(dynamicId);
      await tx.audit(audit, {
        actionKey: 'community.dynamic.delete',
        targetType: 'Dynamic',
        targetId: dynamicId,
        reason: null,
        before: { status: current.status, deletedAt: null },
        after: { status: current.status, deletedAt: deletedAt.toISOString() },
      });
    });
  }
  removeComment(commentId: number, audit: CommunityAuditContext) {
    return runCommunityTransaction(this.uow, async (tx) => {
      await tx.authorize(audit.actorUserId, 'content:dynamic:moderate');
      assertCommunityId(commentId);
      const current = await tx.findComment(commentId);
      if (!current) throw new NotFoundException('Comment not found');
      const deletedAt = new Date();
      await tx.deleteComment(commentId, deletedAt);
      await tx.audit(audit, {
        actionKey: 'community.comment.delete',
        targetType: 'Comment',
        targetId: commentId,
        reason: null,
        before: {
          status: current.status,
          dynamicId: current.dynamicId,
          deletedAt: null,
        },
        after: {
          status: current.status,
          dynamicId: current.dynamicId,
          deletedAt: deletedAt.toISOString(),
        },
      });
    });
  }
}
function moderationSnapshot(current: ModerationState) {
  return {
    status: current.status,
    moderatedAt: current.moderatedAt?.toISOString() ?? null,
    moderatedByUserId: current.moderatedByUserId,
    moderationReason: current.moderationReason,
  };
}
