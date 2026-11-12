import { parseArticleMarkdown } from '../../../shared/content/markdown.js';
import { articleAuthorization } from './article-authorization.js';
import { articleWhere } from './article-scope.js';
import {
  mayCreateArticle,
  articleActorMatches,
  resolveArticleAccess,
  type ArticleAccess,
} from '../domain/article-scope.js';
import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';
import {
  OUTBOX_STORE,
  type OutboxStore,
  type TransactionContext,
} from '../../integration-events/application/ports/outbox-store.js';
import type {
  ArticleRepository,
  ArticleTransaction,
  ArticleReadSession,
  ArticleFieldContext,
} from '../application/ports/article-repository.js';
import type {
  ArticleValues,
  ArticleRecord,
  ArticleChange,
  ContentPageQuery,
  ContentAuditContext,
  ContentAuditChange,
} from '../application/content-models.js';
import {
  serializableContentWrite,
  auditContent,
} from './content-persistence.js';

const include = {
  Category: { select: { Value: true, Label: true } },
  CoverAsset: { select: { StorageKey: true } },
  BodyAssets: {
    where: { Asset: { Status: 'ready' } },
    include: { Asset: { select: { StorageKey: true } } },
  },
};
type Row = Prisma.ArticleGetPayload<{ include: typeof include }>;
@Injectable()
export class PrismaArticleRepository implements ArticleRepository {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(OUTBOX_STORE) private readonly outbox: OutboxStore,
  ) {}
  runRead<T>(
    access: ArticleAccess,
    actorUserId: number,
    work: (tx: ArticleReadSession) => Promise<T>,
  ): Promise<T> {
    const validated = resolveArticleAccess(access);
    if (!validated) throw new ForbiddenException('Invalid article scope');
    return this.prisma.$transaction(
      async (tx) => {
        const context = await articleAuthorization(tx, validated, actorUserId);
        return work(
          new PrismaArticleTransaction(
            tx,
            this.outbox,
            context.access,
            context.fields,
            actorUserId,
          ),
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  runWrite<T>(
    access: ArticleAccess,
    actorUserId: number,
    work: (tx: ArticleTransaction) => Promise<T>,
  ): Promise<T> {
    const validated = resolveArticleAccess(access);
    if (!validated) throw new ForbiddenException('Invalid article scope');
    return serializableContentWrite(this.prisma, async (tx) => {
      const context = await articleAuthorization(tx, validated, actorUserId);
      return work(
        new PrismaArticleTransaction(
          tx,
          this.outbox,
          context.access,
          context.fields,
          actorUserId,
        ),
      );
    });
  }
}

class PrismaArticleTransaction implements ArticleTransaction {
  constructor(
    private readonly tx: Prisma.TransactionClient,
    private readonly outbox: OutboxStore,
    private readonly access: ArticleAccess,
    readonly fields: ArticleFieldContext,
    private readonly actorUserId: number,
  ) {}
  async find(id: number) {
    const row = await this.tx.article.findFirst({
      where: articleWhere(this.access, id),
      include,
    });
    return row ? toRecord(row) : null;
  }
  async findPage(query: ContentPageQuery) {
    const where: Prisma.ArticleWhereInput = {
      ...articleWhere(this.access),
      ...(query.status ? { Status: query.status } : {}),
      ...(query.keyword
        ? {
            OR: [
              { Title: { contains: query.keyword, mode: 'insensitive' } },
              { Summary: { contains: query.keyword, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.tx.article.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: [{ UpdateTime: 'desc' }, { ArticleId: 'desc' }],
        include,
      }),
      this.tx.article.count({ where }),
    ]);
    return { items: items.map(toRecord), total };
  }
  async assertReferences(values: ArticleValues, existingArticleId?: number) {
    await this.tx
      .$queryRaw`SELECT "DictType" FROM "DictionaryType" WHERE "DictType" = 'knowledge.article_category' FOR SHARE`;
    await this.tx
      .$queryRaw`SELECT "ItemId" FROM "DictionaryItem" WHERE "DictType" = 'knowledge.article_category' AND "Value" = ${values.categoryValue} ORDER BY "ItemId" FOR SHARE`;
    const category = await this.tx.dictionaryItem.findFirst({
      where: {
        DictType: 'knowledge.article_category',
        Value: values.categoryValue,
        Status: 'active',
        Type: { Status: 'active', PubliclyReadable: true },
      },
      select: { ItemId: true },
    });
    if (!category)
      throw new UnprocessableEntityException(
        'Unknown or inactive article category',
      );
    await this.assertBodyReferences(values, existingArticleId);
    if (values.coverAssetId !== null) {
      await this.tx
        .$queryRaw`SELECT "AssetId" FROM "Asset" WHERE "AssetId" = ${BigInt(values.coverAssetId)} FOR SHARE`;
      const asset = await this.tx.asset.findFirst({
        where: {
          AssetId: BigInt(values.coverAssetId),
          Status: 'ready',
          MimeType: { in: ['image/jpeg', 'image/png', 'image/webp'] },
        },
        select: { AssetId: true },
      });
      if (!asset)
        throw new UnprocessableEntityException(
          'Cover asset must be a ready JPEG, PNG or WebP image',
        );
    }
  }
  private async assertBodyReferences(
    values: ArticleValues,
    existingArticleId?: number,
  ) {
    if (values.contentFormat !== 'markdown_v1') return;
    const parsed = parseArticleMarkdown(values.body);
    for (const id of [...parsed.assetIds].sort((a, b) =>
      BigInt(a) < BigInt(b) ? -1 : 1,
    )) {
      await this.tx
        .$queryRaw`SELECT "AssetId" FROM "Asset" WHERE "AssetId" = ${BigInt(id)} FOR SHARE`;
      const asset = await this.tx.asset.findFirst({
        where: {
          AssetId: BigInt(id),
          Status: 'ready',
          StorageDeletedAt: null,
          MimeType: { in: ['image/jpeg', 'image/png', 'image/webp'] },
          OR: [
            { OwnerUserId: this.actorUserId },
            ...(existingArticleId
              ? [
                  {
                    ArticleBodyImages: {
                      some: {
                        ArticleId: existingArticleId,
                        Article: articleWhere(this.access, existingArticleId),
                      },
                    },
                  },
                ]
              : []),
          ],
        },
        select: { AssetId: true },
      });
      if (!asset)
        throw new UnprocessableEntityException(
          'Body image must be an owned ready image or an existing image bound to this article',
        );
    }
    for (const link of parsed.links) {
      const visible =
        link.type === 'resort'
          ? await this.tx.skiResort.findFirst({
              where: {
                ResortId: link.id,
                Status: 'published',
                DeletedAt: null,
              },
              select: { ResortId: true },
            })
          : await this.tx.article.findFirst({
              where: {
                ArticleId: link.id,
                Status: 'published',
                DeletedAt: null,
                PublishTime: { not: null },
                Category: {
                  Status: 'active',
                  Type: { Status: 'active', PubliclyReadable: true },
                },
              },
              select: { ArticleId: true },
            });
      if (!visible)
        throw new UnprocessableEntityException(
          'Linked article or resort is not publicly available',
        );
    }
  }
  async create(values: ArticleValues, actorUserId: number) {
    if (
      !mayCreateArticle(this.access) ||
      !articleActorMatches(this.access, actorUserId)
    )
      throw new ForbiddenException(
        'Article scope cannot create for this actor',
      );
    const actor = await this.tx.user.findUnique({
      where: { UserId: actorUserId, Status: 'active' },
      select: { Nickname: true },
    });
    if (!actor) throw new NotFoundException('Article author not found');
    return toRecord(
      await this.tx.article.create({
        data: {
          ...toData(values),
          BodyAssets: {
            create: bodyAssetIds(values).map((id) => ({ AssetId: BigInt(id) })),
          },
          Status: 'draft',
          AuthorId: actorUserId,
          AuthorName: actor.Nickname,
        },
        include,
      }),
    );
  }
  async update(id: number, version: number, change: ArticleChange) {
    const result = await this.tx.article.updateMany({
      where: { ...articleWhere(this.access, id), Version: version },
      data: {
        ...(change.values ? toData(change.values) : {}),
        ...(change.status ? { Status: change.status } : {}),
        ...(change.publishTime ? { PublishTime: change.publishTime } : {}),
        ...(change.deletedAt ? { DeletedAt: change.deletedAt } : {}),
        Version: { increment: 1 },
      },
    });
    if (result.count === 1 && change.values?.contentFormat === 'markdown_v1') {
      await this.tx.articleBodyAsset.deleteMany({ where: { ArticleId: id } });
      const ids = bodyAssetIds(change.values);
      if (ids.length)
        await this.tx.articleBodyAsset.createMany({
          data: ids.map((assetId) => ({
            ArticleId: id,
            AssetId: BigInt(assetId),
          })),
        });
    }
    return result.count === 1;
  }
  appendChanged(id: number, status: string) {
    return this.outbox.append(this.tx as unknown as TransactionContext, {
      eventId: randomUUID(),
      eventType: 'article.changed.v1',
      aggregateType: 'article',
      aggregateId: String(id),
      occurredAt: new Date(),
      payload: { articleId: id, status },
    });
  }
  audit(context: ContentAuditContext, id: number, change: ContentAuditChange) {
    return auditContent(this.tx, context, id, 'article', 'Article', change);
  }
}
function toData(values: ArticleValues): Prisma.ArticleUncheckedCreateInput {
  return {
    Title: values.title,
    Summary: values.summary,
    Body: values.body,
    ContentFormat: values.contentFormat ?? 'plain_text',
    CategoryDictType: 'knowledge.article_category',
    CategoryValue: values.categoryValue,
    CoverAssetId:
      values.coverAssetId === null ? null : BigInt(values.coverAssetId),
    CustomFields: values.customFields as Prisma.InputJsonObject,
    SchemaVersion: values.schemaVersion,
  };
}
function toRecord(row: Row): ArticleRecord {
  return {
    articleId: row.ArticleId,
    title: row.Title,
    summary: row.Summary,
    body: row.Body,
    contentFormat:
      (row.ContentFormat as ArticleRecord['contentFormat']) ?? 'plain_text',
    bodyAssets: (row.BodyAssets ?? []).map((binding) => ({
      assetId: String(binding.AssetId),
      storageKey: binding.Asset.StorageKey,
    })),
    coverAssetId: row.CoverAssetId?.toString() ?? null,
    coverStorageKey: row.CoverAsset?.StorageKey ?? null,
    categoryValue: row.CategoryValue,
    category: { value: row.Category.Value, label: row.Category.Label },
    authorId: row.AuthorId,
    authorName: row.AuthorName,
    status: row.Status as ArticleRecord['status'],
    publishTime: row.PublishTime,
    version: row.Version,
    customFields: row.CustomFields,
    schemaVersion: row.SchemaVersion,
    createdAt: row.CreateTime,
    updatedAt: row.UpdateTime,
  };
}

function bodyAssetIds(values: ArticleValues): string[] {
  return values.contentFormat === 'markdown_v1'
    ? parseArticleMarkdown(values.body).assetIds
    : [];
}
