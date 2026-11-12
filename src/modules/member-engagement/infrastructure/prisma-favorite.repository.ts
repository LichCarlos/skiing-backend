import { ConflictException, Injectable } from '@nestjs/common';
import { articleReadableText } from '../../../shared/content/markdown.js';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';
import type {
  FavoritePageQuery,
  FavoriteRecord,
  FavoriteRepository,
} from '../application/ports/favorite-repository.js';
import type { FavoriteTargetType } from '../domain/favorite-rules.js';

const publicResort = {
  Status: 'published',
  DeletedAt: null,
} satisfies Prisma.SkiResortWhereInput;
const publicDynamic = {
  Status: 'published',
  DeletedAt: null,
} satisfies Prisma.DynamicWhereInput;
const publicArticle = {
  Status: 'published',
  DeletedAt: null,
  PublishTime: { not: null },
  Category: {
    is: {
      DictType: 'knowledge.article_category',
      Status: 'active',
      Type: { is: { Status: 'active', PubliclyReadable: true } },
    },
  },
} satisfies Prisma.ArticleWhereInput;

const selection = {
  FavoriteId: true,
  CreateTime: true,
  Dynamic: {
    select: {
      DynamicId: true,
      Content: true,
      ContentFormat: true,
      CreateTime: true,
      Author: { select: { Nickname: true } },
    },
  },
  Resort: {
    select: {
      ResortId: true,
      Name: true,
      Province: true,
      City: true,
      District: true,
      Rating: true,
      Price: true,
    },
  },
  Article: {
    select: {
      ArticleId: true,
      Title: true,
      Summary: true,
      CategoryValue: true,
      PublishTime: true,
    },
  },
} satisfies Prisma.FavoriteSelect;
type Row = Prisma.FavoriteGetPayload<{ select: typeof selection }>;

@Injectable()
export class PrismaFavoriteRepository implements FavoriteRepository {
  constructor(private readonly prisma: PrismaService) {}
  async hasPublicTarget(
    userId: number,
    type: FavoriteTargetType,
    id: number,
  ): Promise<boolean> {
    return (
      (await this.prisma.favorite.count({
        where: {
          UserId: userId,
          ...(type === 'resort'
            ? { ResortId: id, Resort: { is: publicResort } }
            : type === 'article'
              ? { ArticleId: id, Article: { is: publicArticle } }
              : { DynamicId: id, Dynamic: { is: publicDynamic } }),
        },
      })) > 0
    );
  }

  async addPublicTarget(
    userId: number,
    type: FavoriteTargetType,
    id: number,
  ): Promise<boolean> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          if (type === 'resort') {
            const target = await tx.skiResort.findFirst({
              where: { ...publicResort, ResortId: id },
              select: { ResortId: true },
            });
            if (!target) return false;
            await tx.favorite.upsert({
              where: { UserId_ResortId: { UserId: userId, ResortId: id } },
              create: { UserId: userId, ResortId: id },
              update: {},
            });
          } else if (type === 'article') {
            const target = await tx.article.findFirst({
              where: { ...publicArticle, ArticleId: id },
              select: { ArticleId: true },
            });
            if (!target) return false;
            await tx.favorite.upsert({
              where: { UserId_ArticleId: { UserId: userId, ArticleId: id } },
              create: { UserId: userId, ArticleId: id },
              update: {},
            });
          } else {
            const target = await tx.dynamic.findFirst({
              where: { ...publicDynamic, DynamicId: id },
              select: { DynamicId: true },
            });
            if (!target) return false;
            await tx.favorite.upsert({
              where: { UserId_DynamicId: { UserId: userId, DynamicId: id } },
              create: { UserId: userId, DynamicId: id },
              update: {},
            });
          }
          return true;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2034', 'P2002'].includes(error.code)
      )
        throw new ConflictException(
          'Favorite changed concurrently; retry the request',
        );
      throw error;
    }
  }

  async remove(
    userId: number,
    type: FavoriteTargetType,
    id: number,
  ): Promise<void> {
    await this.prisma.favorite.deleteMany({
      where: {
        UserId: userId,
        ...(type === 'resort'
          ? { ResortId: id }
          : type === 'article'
            ? { ArticleId: id }
            : { DynamicId: id }),
      },
    });
  }

  async findPage(query: FavoritePageQuery) {
    const where: Prisma.FavoriteWhereInput = {
      UserId: query.userId,
      ...(query.targetType === 'resort'
        ? { ResortId: { not: null } }
        : query.targetType === 'article'
          ? { ArticleId: { not: null } }
          : query.targetType === 'dynamic'
            ? { DynamicId: { not: null } }
            : {}),
      OR: [
        { Resort: { is: publicResort } },
        { Article: { is: publicArticle } },
        ...(query.targetType === 'dynamic'
          ? [{ Dynamic: { is: publicDynamic } }]
          : []),
      ],
    };
    const [total, rows] = await this.prisma.$transaction(
      [
        this.prisma.favorite.count({ where }),
        this.prisma.favorite.findMany({
          where,
          orderBy: [{ CreateTime: 'desc' }, { FavoriteId: 'desc' }],
          skip: query.skip,
          take: query.take,
          select: selection,
        }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return { total, items: rows.map(toRecord) };
  }
}

function toRecord(row: Row): FavoriteRecord {
  const base = {
    favoriteId: row.FavoriteId.toString(),
    favoritedAt: row.CreateTime,
  };
  if (row.Dynamic)
    return {
      ...base,
      target: {
        targetType: 'dynamic',
        id: row.Dynamic.DynamicId,
        summary: articleReadableText(
          row.Dynamic.Content,
          row.Dynamic.ContentFormat,
        ).slice(0, 180),
        authorNickname: row.Dynamic.Author.Nickname,
        createdAt: row.Dynamic.CreateTime,
      },
    };
  if (row.Resort)
    return {
      ...base,
      target: {
        targetType: 'resort',
        id: row.Resort.ResortId,
        name: row.Resort.Name,
        province: row.Resort.Province,
        city: row.Resort.City,
        district: row.Resort.District,
        rating: row.Resort.Rating === null ? null : Number(row.Resort.Rating),
        startingPrice: String(row.Resort.Price),
      },
    };
  if (!row.Article?.PublishTime)
    throw new Error('Public favorite requires a published target');
  return {
    ...base,
    target: {
      targetType: 'article',
      id: row.Article.ArticleId,
      title: row.Article.Title,
      summary: row.Article.Summary,
      category: row.Article.CategoryValue,
      publishedAt: row.Article.PublishTime,
    },
  };
}
