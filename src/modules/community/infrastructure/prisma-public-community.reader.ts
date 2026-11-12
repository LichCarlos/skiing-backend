import { articleReadableText } from '../../../shared/content/markdown.js';
import { Injectable } from '@nestjs/common';
import {
  avatarAssetSelect,
  resolveAvatarUrl,
} from '../../assets/application/avatar-url.js';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';
import { Inject } from '@nestjs/common';
import {
  ASSET_STORAGE,
  type AssetStorage,
} from '../../assets/application/ports/asset-storage.js';
import type { PageQuery } from '../application/community-models.js';
import type {
  PublicCommunityReader,
  PublicFeedReadQuery,
} from '../application/ports/public-community-reader.js';

const dynamicSelect = {
  DynamicId: true,
  AuthorId: true,
  Content: true,
  ContentFormat: true,
  Version: true,
  ResortId: true,
  CreateTime: true,
  UpdateTime: true,
  Author: {
    select: {
      UserId: true,
      Nickname: true,
      Avatar: true,
      AvatarAsset: avatarAssetSelect,
    },
  },
  Resort: { select: { ResortId: true, Name: true } },
  Images: {
    orderBy: { SortOrder: 'asc' as const },
    include: {
      Asset: {
        select: {
          StorageKey: true,
          Status: true,
          OwnerUserId: true,
          MimeType: true,
        },
      },
    },
  },
  _count: {
    select: {
      Comments: { where: { Status: 'visible', DeletedAt: null } },
      Likes: true,
    },
  },
} as const;

@Injectable()
export class PrismaPublicCommunityReader implements PublicCommunityReader {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ASSET_STORAGE) private readonly storage: AssetStorage,
  ) {}

  async dynamics(query: PublicFeedReadQuery, userId?: number) {
    const keyword = query.keyword?.trim().replace(/[\\%_]/g, '\\$&');
    const limit = query.limit;
    const cursor = query.before;
    const { page, hasNext, liked } = await this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.dynamic.findMany({
          where: {
            Status: 'published',
            DeletedAt: null,
            ...(keyword
              ? {
                  Content: {
                    contains: keyword,
                    mode: 'insensitive',
                  },
                }
              : {}),
            ...(cursor
              ? {
                  OR: [
                    { CreateTime: { lt: cursor.createdAt } },
                    {
                      CreateTime: cursor.createdAt,
                      DynamicId: { lt: cursor.dynamicId },
                    },
                  ],
                }
              : {}),
          },
          orderBy: [{ CreateTime: 'desc' }, { DynamicId: 'desc' }],
          take: limit + 1,
          select: dynamicSelect,
        });
        const hasNext = rows.length > limit;
        const page = rows.slice(0, limit);
        const liked =
          userId && page.length
            ? new Set(
                (
                  await tx.likeRecord.findMany({
                    where: {
                      UserId: userId,
                      User: { Status: 'active' },
                      DynamicId: { in: page.map(({ DynamicId }) => DynamicId) },
                    },
                    select: { DynamicId: true },
                  })
                ).map(({ DynamicId }) => DynamicId),
              )
            : new Set<number>();
        return { page, hasNext, liked };
      },
      { isolationLevel: 'RepeatableRead' },
    );
    const items = await Promise.all(
      page.map(async (row) => {
        const imageUrls = await Promise.all(
          row.Images.map(async ({ Asset }) =>
            Asset.Status === 'ready' &&
            Asset.OwnerUserId === row.AuthorId &&
            ['image/jpeg', 'image/png', 'image/webp'].includes(Asset.MimeType)
              ? this.storage.createReadUrl(Asset.StorageKey, 900)
              : null,
          ),
        );
        return {
          dynamicId: row.DynamicId,
          author: {
            userId: row.Author.UserId,
            nickname: row.Author.Nickname,
            avatarUrl: await resolveAvatarUrl(this.storage, row.Author),
          },
          summary: articleReadableText(row.Content, row.ContentFormat).slice(0, 180),
          coverUrl: imageUrls[0] ?? null,
          imageCount: imageUrls.filter((url) => url !== null).length,
          resort: row.Resort
            ? { resortId: row.Resort.ResortId, name: row.Resort.Name }
            : null,
          likeCount: row._count.Likes,
          commentCount: row._count.Comments,
          likedByMe: liked.has(row.DynamicId),
          status: 'published' as const,
          createdAt: row.CreateTime.toISOString(),
        };
      }),
    );
    return { items, hasNext };
  }

  async dynamic(id: number, userId?: number) {
    const snapshot = await this.prisma.$transaction(
      async (tx) => {
        const row = await tx.dynamic.findFirst({
          where: { DynamicId: id, Status: 'published', DeletedAt: null },
          select: dynamicSelect,
        });
        if (!row) return null;
        const likedByMe = userId
          ? Boolean(
              await tx.likeRecord.findUnique({
                where: {
                  UserId_DynamicId: { UserId: userId, DynamicId: id },
                  User: { Status: 'active' },
                },
                select: { UserId: true },
              }),
            )
          : false;
        return { row, likedByMe };
      },
      { isolationLevel: 'RepeatableRead' },
    );
    if (!snapshot) return null;
    const { row, likedByMe } = snapshot;
    const imageUrls = await Promise.all(
      row.Images.map(async ({ Asset }) =>
        Asset.Status === 'ready' &&
        Asset.OwnerUserId === row.AuthorId &&
        ['image/jpeg', 'image/png', 'image/webp'].includes(Asset.MimeType)
          ? this.storage.createReadUrl(Asset.StorageKey, 900)
          : null,
      ),
    );
    return {
      dynamicId: row.DynamicId,
      author: {
        userId: row.Author.UserId,
        nickname: row.Author.Nickname,
        avatarUrl: await resolveAvatarUrl(this.storage, row.Author),
      },
      summary: articleReadableText(row.Content, row.ContentFormat).slice(0, 180),
      content: row.Content,
      contentFormat: row.ContentFormat as 'plain_text' | 'markdown_v1',
      version: row.Version,
      bodyAssets: row.Images.flatMap((image,index) => imageUrls[index] ? [{assetId: String(image.AssetId),url:imageUrls[index]!}] : []),
      coverUrl: imageUrls[0] ?? null,
      imageCount: imageUrls.filter((url) => url !== null).length,
      imageUrls: imageUrls.filter((url): url is string => url !== null),
      resort: row.Resort
        ? { resortId: row.Resort.ResortId, name: row.Resort.Name }
        : null,
      likeCount: row._count.Likes,
      commentCount: row._count.Comments,
      likedByMe,
      status: 'published' as const,
      createdAt: row.CreateTime.toISOString(),
      updatedAt: row.UpdateTime.toISOString(),
    };
  }

  async comments(dynamicId: number, query: PageQuery) {
    return this.prisma.$transaction(
      async (tx) => {
        const dynamic = await tx.dynamic.findFirst({
          where: { DynamicId: dynamicId, Status: 'published', DeletedAt: null },
          select: { DynamicId: true },
        });
        if (!dynamic) return null;
        const page = query.page ?? 1;
        const pageSize = query.pageSize ?? 20;
        const where = {
          DynamicId: dynamicId,
          Status: 'visible',
          DeletedAt: null,
        };
        const [rows, total] = await Promise.all([
          tx.comment.findMany({
            where,
            skip: (page - 1) * pageSize,
            take: pageSize,
            orderBy: [{ CreateTime: 'desc' }, { CommentId: 'desc' }],
            select: {
              CommentId: true,
              Content: true,
              CreateTime: true,
              Author: {
                select: {
                  UserId: true,
                  Nickname: true,
                  Avatar: true,
                  AvatarAsset: avatarAssetSelect,
                },
              },
            },
          }),
          tx.comment.count({ where }),
        ]);
        return {
          items: await Promise.all(
            rows.map(async (row) => ({
              commentId: row.CommentId,
              author: {
                userId: row.Author.UserId,
                nickname: row.Author.Nickname,
                avatarUrl: await resolveAvatarUrl(this.storage, row.Author),
              },
              content: row.Content,
              createdAt: row.CreateTime.toISOString(),
              status: 'visible' as const,
            })),
          ),
          page,
          pageSize,
          total,
          hasNext: page * pageSize < total,
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
}
