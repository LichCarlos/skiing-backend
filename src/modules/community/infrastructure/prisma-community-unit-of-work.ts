import { businessFieldContext } from '../../platform-administration/infrastructure/business-field-context.js';
import { validateCustomFieldWrite } from '../../platform-administration/domain/custom-field-validation.js';
import { BadRequestException } from '@nestjs/common';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';
import { appendOutboxEvent } from '../../integration-events/infrastructure/append-outbox-event.js';
import { CommunityRuleError } from '../domain/community-rules.js';
import type {
  CommunityAuditChange,
  CommunityAuditContext,
  DynamicWriteInput,
  ModerationUpdate,
} from '../application/community-models.js';
import type {
  CommunityTransaction,
  CommunityUnitOfWork,
  CommunityWritePermission,
} from '../application/ports/community-unit-of-work.js';
import { authorizeCommunityWrite } from './community-authorization.js';

@Injectable()
export class PrismaCommunityUnitOfWork implements CommunityUnitOfWork {
  constructor(private readonly prisma: PrismaService) {}
  async run<T>(
    work: (transaction: CommunityTransaction) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.$transaction(
          (tx) => work(new PrismaCommunityTransaction(tx)),
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          },
        );
      } catch (error) {
        if (
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          !(
            error.code === 'P2034' ||
            (error.code === 'P2010' &&
              ['40001', '40P01'].includes(String(error.meta?.code)))
          )
        )
          throw error;
        if (attempt === 2)
          throw new CommunityRuleError(
            'conflict',
            'Concurrent community write, please retry',
          );
      }
    }
    throw new Error('Unreachable community transaction state');
  }
}

class PrismaCommunityTransaction implements CommunityTransaction {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  authorize(userId: number, permission: CommunityWritePermission) {
    return authorizeCommunityWrite(this.tx, userId, permission);
  }

  async findDynamic(id: number) {
    const row = await this.tx.dynamic.findFirst({
      where: { DynamicId: id, DeletedAt: null },
      select: {
        AuthorId: true,
        Content: true,
        ContentFormat: true,
        Version: true,
        ResortId: true,
        Status: true,
        ModeratedAt: true,
        ModeratedByUserId: true,
        ModerationReason: true,
        Images: { orderBy: { SortOrder: 'asc' }, select: { AssetId: true } },
      },
    });
    return row
      ? {
          authorId: row.AuthorId,
          content: row.Content,
          contentFormat: row.ContentFormat as 'plain_text' | 'markdown_v1',
          version: row.Version,
          resortId: row.ResortId,
          imageAssetIds: row.Images.map(({ AssetId }) => AssetId.toString()),
          ...moderationState(row),
        }
      : null;
  }
  async createDynamic(authorId: number, input: DynamicWriteInput) {
    const fields = await this.validateFields(
      authorId,
      input.customFields ?? {},
      {},
    );
    const row = await this.tx.dynamic.create({
      data: {
        AuthorId: authorId,
        Content: input.content,
        ContentFormat: input.contentFormat ?? 'plain_text',
        ResortId: input.resortId ?? null,
        Status: 'pending',
        CustomFields: fields.values as Prisma.InputJsonObject,
        SchemaVersion: fields.schemaVersion,
      },
      select: { DynamicId: true, CreateTime: true },
    });
    return { dynamicId: row.DynamicId, createdAt: row.CreateTime };
  }
  async updateDynamic(id: number, input: DynamicWriteInput, status: string) {
    const current = await this.tx.dynamic.findUniqueOrThrow({
      where: { DynamicId: id },
      select: { AuthorId: true, CustomFields: true },
    });
    const fields = await this.validateFields(
      current.AuthorId,
      input.customFields ?? {},
      current.CustomFields as Record<string, unknown>,
    );
    try { await this.tx.dynamic.update({
      where: { DynamicId: id, ...(input.expectedVersion !== undefined ? { Version: input.expectedVersion } : {}) },
      data: {
        Content: input.content,
        ContentFormat: input.contentFormat ?? 'plain_text',
        Version: { increment: 1 },
        ResortId: input.resortId ?? null,
        Status: status,
        CustomFields: fields.values as Prisma.InputJsonObject,
        SchemaVersion: fields.schemaVersion,
      },
    }); } catch(error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') throw new CommunityRuleError('conflict','Dynamic changed concurrently'); throw error; }
  }
  private async validateFields(
    userId: number,
    submittedValues: unknown,
    existingValues: Record<string, unknown>,
  ) {
    const context = await businessFieldContext(this.tx, 'dynamic', userId);
    const result = validateCustomFieldWrite({
      ...context,
      submittedValues,
      existingValues,
    });
    if (!result.ok)
      throw new BadRequestException({
        message: 'Invalid custom fields',
        details: result.issues.map((i) => ({
          code: i.code,
          field: i.fieldKey,
          message: i.code,
        })),
      });
    return {
      values: result.values,
      schemaVersion: Math.max(
        1,
        ...context.groups.flatMap((g) => g.fields.map((f) => f.schemaVersion)),
      ),
    };
  }
  async replaceDynamicImages(id: number, assetIds: string[]) {
    await this.tx.dynamicImage.deleteMany({ where: { DynamicId: id } });
    if (assetIds.length)
      await this.tx.dynamicImage.createMany({
        data: assetIds.map((assetId, SortOrder) => ({
          DynamicId: id,
          AssetId: BigInt(assetId),
          SortOrder,
        })),
      });
  }
  async deleteDynamic(id: number, deletedAt: Date) {
    await this.tx.dynamic.update({
      where: { DynamicId: id },
      data: { DeletedAt: deletedAt },
    });
  }
  async findComment(id: number) {
    const row = await this.tx.comment.findFirst({
      where: { CommentId: id, DeletedAt: null },
      select: {
        AuthorId: true,
        DynamicId: true,
        Status: true,
        ModeratedAt: true,
        ModeratedByUserId: true,
        ModerationReason: true,
      },
    });
    return row
      ? {
          authorId: row.AuthorId,
          dynamicId: row.DynamicId,
          ...moderationState(row),
        }
      : null;
  }
  async createComment(authorId: number, dynamicId: number, content: string) {
    const row = await this.tx.comment.create({
      data: {
        AuthorId: authorId,
        DynamicId: dynamicId,
        Content: content,
        Status: 'visible',
      },
      select: { CommentId: true, CreateTime: true },
    });
    return { commentId: row.CommentId, createdAt: row.CreateTime };
  }
  async deleteComment(id: number, deletedAt: Date) {
    await this.tx.comment.update({
      where: { CommentId: id },
      data: { DeletedAt: deletedAt },
    });
  }
  async ownedReadyAssetIds(authorId: number, ids: string[]) {
    if (!ids.length) return [];
    // Protect reference creation against both soft deletion and physical deletion.
    // Always acquire multiple image locks in numeric order.
    await this.tx
      .$queryRaw`SELECT "AssetId" FROM "Asset" WHERE "AssetId" IN (${Prisma.join(ids.map(BigInt))}) ORDER BY "AssetId" FOR SHARE`;
    const assets = await this.tx.asset.findMany({
      where: {
        AssetId: { in: ids.map(BigInt) },
        OwnerUserId: authorId,
        Status: 'ready',
        MimeType: { in: ['image/jpeg', 'image/png', 'image/webp'] },
      },
      select: { AssetId: true },
    });
    return assets.map(({ AssetId }) => AssetId.toString());
  }
  async isPublishedResort(id: number) {
    await this.tx
      .$queryRaw`SELECT "ResortId" FROM "SkiResort" WHERE "ResortId" = ${id} FOR SHARE`;
    return Boolean(
      await this.tx.skiResort.findFirst({
        where: { ResortId: id, Status: 'published', DeletedAt: null },
        select: { ResortId: true },
      }),
    );
  }
  async isPublishedArticle(id: number) {
    await this.tx.$queryRaw`SELECT "ArticleId" FROM "Article" WHERE "ArticleId" = ${id} FOR SHARE`;
    return Boolean(await this.tx.article.findFirst({where:{ArticleId:id,Status:'published',DeletedAt:null,PublishTime:{not:null},Category:{Status:'active',Type:{Status:'active',PubliclyReadable:true}}},select:{ArticleId:true}}));
  }
  async setLike(userId: number, dynamicId: number, liked: boolean) {
    const key = { UserId_DynamicId: { UserId: userId, DynamicId: dynamicId } };
    if (liked)
      await this.tx.likeRecord.upsert({
        where: key,
        create: { UserId: userId, DynamicId: dynamicId },
        update: {},
      });
    else
      await this.tx.likeRecord.deleteMany({
        where: { UserId: userId, DynamicId: dynamicId },
      });
    const [likeCount, current] = await Promise.all([
      this.tx.likeRecord.count({ where: { DynamicId: dynamicId } }),
      this.tx.likeRecord.findUnique({ where: key, select: { UserId: true } }),
    ]);
    return { liked: Boolean(current), likeCount };
  }
  async moderateDynamic(id: number, update: ModerationUpdate) {
    await this.tx.dynamic.update({
      where: { DynamicId: id },
      data: { ...moderationData(update), Version: { increment: 1 } },
    });
  }
  async moderateComment(id: number, update: ModerationUpdate) {
    await this.tx.comment.update({
      where: { CommentId: id },
      data: moderationData(update),
    });
  }
  dynamicChanged(id: number) {
    return appendOutboxEvent(this.tx, {
      eventType: 'dynamic.changed.v1',
      aggregateType: 'Dynamic',
      aggregateId: String(id),
      payload: { dynamicId: id },
    });
  }
  async audit(context: CommunityAuditContext, change: CommunityAuditChange) {
    const actor = await this.tx.user.findUnique({
      where: { UserId: context.actorUserId },
      select: { Account: true },
    });
    if (!actor) throw new NotFoundException('Audit actor not found');
    await this.tx.operationLog.create({
      data: {
        ActorUserId: context.actorUserId,
        ActorAccountSnapshot: actor.Account,
        ActionKey: change.actionKey,
        ResourceKey: 'community',
        TargetType: change.targetType,
        TargetId: String(change.targetId),
        Result: 'success',
        Reason: change.reason,
        TraceId: context.traceId,
        ClientIp: context.clientIp,
        UserAgent: context.userAgent,
        Metadata: { before: change.before, after: change.after },
      },
    });
  }
}
function moderationState(row: {
  Status: string;
  ModeratedAt: Date | null;
  ModeratedByUserId: number | null;
  ModerationReason: string | null;
}) {
  return {
    status: row.Status,
    moderatedAt: row.ModeratedAt,
    moderatedByUserId: row.ModeratedByUserId,
    moderationReason: row.ModerationReason,
  };
}
function moderationData(update: ModerationUpdate) {
  return {
    Status: update.status,
    ModeratedAt: update.moderatedAt,
    ModeratedByUserId: update.moderatedByUserId,
    ModerationReason: update.moderationReason,
  };
}
