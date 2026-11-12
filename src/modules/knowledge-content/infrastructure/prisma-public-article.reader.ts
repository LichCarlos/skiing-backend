import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';
import type { PublicArticleReader } from '../application/ports/public-article-reader.js';
import type {
  ContentPageQuery,
  PublicArticleRecord,
} from '../application/content-models.js';

const publicCategoryWhere = {
  DictType: 'knowledge.article_category',
  Status: 'active',
  Type: { is: { Status: 'active', PubliclyReadable: true } },
} satisfies Prisma.DictionaryItemWhereInput;
const publicArticleWhere = {
  Status: 'published',
  DeletedAt: null,
  PublishTime: { not: null },
  Category: { is: publicCategoryWhere },
} satisfies Prisma.ArticleWhereInput;
const include = {
  Category: { select: { Value: true, Label: true } },
  CoverAsset: { select: { StorageKey: true } },
  BodyAssets: { where: { Asset: { Status: 'ready', StorageDeletedAt: null } }, include: { Asset: { select: { StorageKey: true } } } },
};
function personalInclude(userId?: number) {
  return {
    ...include,
    Favorites: {
      where: { UserId: userId ?? -1, User: { Status: 'active' } },
      select: { UserId: true },
      take: 1,
    },
  } satisfies Prisma.ArticleInclude;
}
type Row = Prisma.ArticleGetPayload<{
  include: ReturnType<typeof personalInclude>;
}>;
@Injectable()
export class PrismaPublicArticleReader implements PublicArticleReader {
  constructor(private readonly prisma: PrismaService) {}
  async categories() {
    const items = await this.prisma.dictionaryItem.findMany({
      where: publicCategoryWhere,
      orderBy: [{ SortOrder: 'asc' }, { ItemId: 'asc' }],
      select: { Value: true, Label: true },
    });
    return items.map((item) => ({ value: item.Value, label: item.Label }));
  }
  async findPage(query: ContentPageQuery, userId?: number) {
    // PostgreSQL LIKE treats these characters as patterns; search input is literal.
    const keyword = query.keyword?.replace(/[\\%_]/g, '\\$&');
    const where: Prisma.ArticleWhereInput = {
      ...publicArticleWhere,
      ...(query.categoryValue ? { CategoryValue: query.categoryValue } : {}),
      ...(keyword
        ? {
            OR: [
              { Title: { contains: keyword, mode: 'insensitive' } },
              { Summary: { contains: keyword, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction(
      [
        this.prisma.article.findMany({
          where,
          skip: query.skip,
          take: query.take,
          orderBy: [{ PublishTime: 'desc' }, { ArticleId: 'desc' }],
          include: personalInclude(userId),
        }),
        this.prisma.article.count({ where }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return { items: items.map((item) => toRecord(item, userId)), total };
  }
  async find(id: number, userId?: number) {
    const row = await this.prisma.article.findFirst({
      where: { ...publicArticleWhere, ArticleId: id },
      include: personalInclude(userId),
    });
    return row ? toRecord(row, userId) : null;
  }
}
function toRecord(row: Row, userId?: number): PublicArticleRecord {
  if (!row.PublishTime)
    throw new Error('Public article requires publication time');
  return {
    articleId: row.ArticleId,
    title: row.Title,
    summary: row.Summary,
    body: row.Body,
    contentFormat: row.ContentFormat as PublicArticleRecord['contentFormat'] ?? 'plain_text',
    bodyAssets: (row.BodyAssets ?? []).map((binding) => ({ assetId: String(binding.AssetId), storageKey: binding.Asset.StorageKey })),
    authorName: row.AuthorName,
    publishTime: row.PublishTime,
    coverStorageKey: row.CoverAsset?.StorageKey ?? null,
    category: { value: row.Category.Value, label: row.Category.Label },
    favoriteByMe: userId !== undefined && row.Favorites.length > 0,
  };
}
