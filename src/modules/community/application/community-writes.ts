import {
  COMMUNITY_CONTENT_PARSER,
  unavailableContentParser,
  type CommunityContentParser,
} from './ports/content-parser.js';
import {
  ForbiddenException,
  ConflictException,
  UnprocessableEntityException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  assertCommunityImageIds,
  assertCommunityId,
  assertCommunityPatch,
  authorEditedStatus,
  normalizeCommunityContent,
} from '../domain/community-rules.js';
import type {
  DynamicPatchInput,
  DynamicWriteInput,
} from './community-models.js';
import { runCommunityTransaction } from './community-transaction.js';
import {
  COMMUNITY_UNIT_OF_WORK,
  type CommunityTransaction,
  type CommunityUnitOfWork,
} from './ports/community-unit-of-work.js';
@Injectable()
export class CommunityWrites {
  constructor(
    @Inject(COMMUNITY_UNIT_OF_WORK) private readonly uow: CommunityUnitOfWork,
    @Inject(COMMUNITY_CONTENT_PARSER)
    private readonly contentParser: CommunityContentParser = unavailableContentParser,
  ) {}
  createDynamic(authorId: number, input: DynamicWriteInput) {
    return runCommunityTransaction(this.uow, async (tx) => {
      await tx.authorize(authorId, 'community:dynamic:create');
      if (input.resortId !== undefined) assertCommunityId(input.resortId);
      const body = {
        ...input,
        content: normalizeCommunityContent(input.content, 'Dynamic'),
      };
      await validateReferences(tx, authorId, body, this.contentParser);
      const dynamic = await tx.createDynamic(authorId, body);
      await tx.replaceDynamicImages(dynamic.dynamicId, body.imageAssetIds);
      await tx.dynamicChanged(dynamic.dynamicId);
      return {
        dynamicId: dynamic.dynamicId,
        status: 'pending' as const,
        createdAt: dynamic.createdAt.toISOString(),
      };
    });
  }
  updateDynamic(authorId: number, dynamicId: number, patch: DynamicPatchInput) {
    return runCommunityTransaction(this.uow, async (tx) => {
      await tx.authorize(authorId, 'community:dynamic:update-own');
      assertCommunityId(dynamicId);
      assertCommunityPatch(patch);
      const current = await tx.findDynamic(dynamicId);
      if (!current) throw new NotFoundException('Dynamic not found');
      if (current.authorId !== authorId)
        throw new ForbiddenException('Only the dynamic author can update it');
      if (
        patch.expectedVersion !== undefined &&
        patch.expectedVersion !== current.version
      )
        throw new ConflictException('Dynamic changed concurrently');
      if (
        (current.contentFormat === 'markdown_v1' ||
          patch.contentFormat === 'markdown_v1') &&
        (patch.contentFormat === undefined ||
          patch.expectedVersion === undefined)
      )
        throw new ConflictException(
          'Markdown update requires explicit format and expectedVersion',
        );
      if (
        current.contentFormat === 'markdown_v1' &&
        patch.contentFormat !== 'markdown_v1'
      )
        throw new UnprocessableEntityException(
          'Markdown cannot be silently downgraded',
        );
      if (current.version !== undefined && current.version >= 2147483647)
        throw new ConflictException('Dynamic version is exhausted');
      const body: DynamicWriteInput = {
        ...(patch.contentFormat !== undefined ||
        current.contentFormat !== undefined
          ? { contentFormat: patch.contentFormat ?? current.contentFormat }
          : {}),
        ...(current.version !== undefined
          ? { expectedVersion: current.version }
          : {}),
        ...(patch.customFields !== undefined
          ? { customFields: patch.customFields }
          : {}),
        content: normalizeCommunityContent(
          patch.content ?? current.content,
          'Dynamic',
        ),
        imageAssetIds: patch.imageAssetIds ?? current.imageAssetIds,
        ...(patch.resortId !== undefined
          ? patch.resortId === null
            ? {}
            : { resortId: patch.resortId }
          : current.resortId !== null
            ? { resortId: current.resortId }
            : {}),
      };
      await validateReferences(tx, authorId, body, this.contentParser);
      const status = authorEditedStatus(current.status);
      await tx.updateDynamic(dynamicId, body, status);
      await tx.replaceDynamicImages(dynamicId, body.imageAssetIds);
      await tx.dynamicChanged(dynamicId);
      return { dynamicId, status };
    });
  }
  removeDynamic(authorId: number, dynamicId: number) {
    return runCommunityTransaction(this.uow, async (tx) => {
      await tx.authorize(authorId, 'community:dynamic:update-own');
      assertCommunityId(dynamicId);
      const current = await tx.findDynamic(dynamicId);
      if (!current) throw new NotFoundException('Dynamic not found');
      if (current.authorId !== authorId)
        throw new ForbiddenException('Only the dynamic author can remove it');
      await tx.deleteDynamic(dynamicId, new Date());
      await tx.dynamicChanged(dynamicId);
    });
  }
  createComment(
    authorId: number,
    dynamicId: number,
    body: { content: string },
  ) {
    return runCommunityTransaction(this.uow, async (tx) => {
      await tx.authorize(authorId, 'community:comment:create');
      assertCommunityId(dynamicId);
      const content = normalizeCommunityContent(body.content, 'Comment');
      const dynamic = await tx.findDynamic(dynamicId);
      if (dynamic?.status !== 'published')
        throw new NotFoundException('Dynamic not found');
      const comment = await tx.createComment(authorId, dynamicId, content);
      return {
        commentId: comment.commentId,
        createdAt: comment.createdAt.toISOString(),
        status: 'visible' as const,
      };
    });
  }
  removeComment(authorId: number, commentId: number) {
    return runCommunityTransaction(this.uow, async (tx) => {
      await tx.authorize(authorId, 'community:comment:create');
      assertCommunityId(commentId);
      const current = await tx.findComment(commentId);
      if (!current) throw new NotFoundException('Comment not found');
      if (current.authorId !== authorId)
        throw new ForbiddenException('Only the comment author can remove it');
      await tx.deleteComment(commentId, new Date());
    });
  }
  setLiked(userId: number, dynamicId: number, liked: boolean) {
    return runCommunityTransaction(this.uow, async (tx) => {
      await tx.authorize(userId, 'community:like:toggle');
      assertCommunityId(dynamicId);
      const dynamic = await tx.findDynamic(dynamicId);
      if (dynamic?.status !== 'published')
        throw new NotFoundException('Dynamic not found');
      return tx.setLike(userId, dynamicId, liked);
    });
  }
}
export async function validateReferences(
  tx: CommunityTransaction,
  authorId: number,
  body: DynamicWriteInput,
  parser: CommunityContentParser,
) {
  assertCommunityImageIds(body.imageAssetIds);
  if (
    body.contentFormat !== undefined &&
    !['plain_text', 'markdown_v1'].includes(body.contentFormat)
  )
    throw new UnprocessableEntityException('Unsupported content format');
  if (body.contentFormat === 'markdown_v1') {
    let parsed: ReturnType<CommunityContentParser['parse']>;
    try {
      parsed = parser.parse(body.content);
    } catch (error) {
      throw new UnprocessableEntityException(
        error instanceof Error ? error.message : 'Invalid Markdown',
      );
    }
    if (parsed.assetIds.some((id) => !body.imageAssetIds.includes(id)))
      throw new UnprocessableEntityException(
        'Inline images must be present in the dynamic image list',
      );
    for (const link of parsed.links) {
      if (
        !(await (link.type === 'resort'
          ? tx.isPublishedResort(link.id)
          : tx.isPublishedArticle(link.id)))
      )
        throw new UnprocessableEntityException(
          'Linked article or resort is not publicly available',
        );
    }
  }
  if (body.imageAssetIds.length) {
    const assets = await tx.ownedReadyAssetIds(authorId, body.imageAssetIds);
    if (assets.length !== body.imageAssetIds.length)
      throw new NotFoundException('Image asset not found');
  }
  if (
    body.resortId !== undefined &&
    !(await tx.isPublishedResort(body.resortId))
  )
    throw new NotFoundException('Resort not found');
}
