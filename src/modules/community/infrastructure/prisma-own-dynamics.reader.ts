import { articleReadableText } from '../../../shared/content/markdown.js';
import {
  businessFieldContext,
  businessFieldSchema,
} from '../../platform-administration/infrastructure/business-field-context.js';
import { filterReadableCustomFields } from '../../platform-administration/domain/custom-field-validation.js';
import { Inject, Injectable } from '@nestjs/common';
import {
  avatarAssetSelect,
  resolveAvatarUrl,
} from '../../assets/application/avatar-url.js';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';
import {
  ASSET_STORAGE,
  type AssetStorage,
} from '../../assets/application/ports/asset-storage.js';
import type {
  OwnDynamicCard,
  OwnDynamicDetail,
  OwnDynamicsQuery,
  OwnDynamicsReader,
} from '../application/ports/own-dynamics-reader.js';

const select = {
  DynamicId: true,
  Content: true,
  ContentFormat: true,
  Version: true,
  CustomFields: true,
  Status: true,
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
    orderBy: { SortOrder: 'asc' },
    select: {
      Asset: {
        select: {
          AssetId: true,
          OwnerUserId: true,
          StorageKey: true,
          Status: true,
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
} satisfies Prisma.DynamicSelect;

type Row = Prisma.DynamicGetPayload<{ select: typeof select }>;

@Injectable()
export class PrismaOwnDynamicsReader implements OwnDynamicsReader {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ASSET_STORAGE) private readonly storage: AssetStorage,
  ) {}

  schema(userId: number) {
    return this.prisma.$transaction(
      async (tx) =>
        businessFieldSchema(
          await businessFieldContext(tx, 'dynamic', userId),
          'dynamic',
        ),
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async list(userId: number, query: OwnDynamicsQuery) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = {
      AuthorId: userId,
      DeletedAt: null,
      Status: query.status ?? { in: ['pending', 'published', 'hidden'] },
    };
    const { rows, total, likedIds } = await this.prisma.$transaction(
      async (tx) => {
        const [rows, total] = await Promise.all([
          tx.dynamic.findMany({
            where,
            select,
            skip: (page - 1) * pageSize,
            take: pageSize,
            orderBy: [{ CreateTime: 'desc' }, { DynamicId: 'desc' }],
          }),
          tx.dynamic.count({ where }),
        ]);
        const likedIds = await this.likedIds(
          userId,
          rows.map((row) => row.DynamicId),
          tx,
        );
        return { rows, total, likedIds };
      },
      { isolationLevel: 'RepeatableRead' },
    );
    const items = await Promise.all(
      rows.map(async (row) => {
        const first = row.Images[0]?.Asset;
        const coverUrl =
          first?.Status === 'ready' &&
          first.OwnerUserId === userId &&
          ['image/jpeg', 'image/png', 'image/webp'].includes(first.MimeType)
            ? await this.storage.createReadUrl(first.StorageKey, 900)
            : null;
        return this.card(row, likedIds.has(row.DynamicId), coverUrl);
      }),
    );
    return { items, page, pageSize, total, hasNext: page * pageSize < total };
  }

  async find(
    userId: number,
    dynamicId: number,
  ): Promise<OwnDynamicDetail | null> {
    const snapshot = await this.prisma.$transaction(
      async (tx) => {
        const row = await tx.dynamic.findFirst({
          where: {
            DynamicId: dynamicId,
            AuthorId: userId,
            DeletedAt: null,
            Status: { in: ['pending', 'published', 'hidden'] },
          },
          select,
        });
        if (!row) return null;
        const likedIds = await this.likedIds(userId, [dynamicId], tx);
        const fields = await businessFieldContext(tx, 'dynamic', userId);
        const customFields = filterReadableCustomFields({
          ...fields,
          values: row.CustomFields,
        });
        return { row, likedIds, customFields };
      },
      { isolationLevel: 'RepeatableRead' },
    );
    if (!snapshot) return null;
    const { row, likedIds } = snapshot;
    const candidates = await Promise.all(
      row.Images.map(async ({ Asset }) =>
        Asset.Status === 'ready' &&
        Asset.OwnerUserId === userId &&
        ['image/jpeg', 'image/png', 'image/webp'].includes(Asset.MimeType)
          ? {
              assetId: Asset.AssetId.toString(),
              url: await this.storage.createReadUrl(Asset.StorageKey, 900),
            }
          : null,
      ),
    );
    const images = candidates.filter(
      (image): image is { assetId: string; url: string } => image !== null,
    );
    return {
      ...(await this.card(
        row,
        likedIds.has(dynamicId),
        images[0]?.url ?? null,
      )),
      content: row.Content,
      contentFormat: row.ContentFormat as 'plain_text' | 'markdown_v1',
      version: row.Version,
      bodyAssets: images,
      customFields: snapshot.customFields,
      imageUrls: images.map(({ url }) => url),
      images,
      updatedAt: row.UpdateTime.toISOString(),
    };
  }

  private async likedIds(
    userId: number,
    ids: number[],
    client: Pick<Prisma.TransactionClient, 'likeRecord'>,
  ): Promise<Set<number>> {
    if (!ids.length) return new Set();
    const likes = await client.likeRecord.findMany({
      where: { UserId: userId, DynamicId: { in: ids } },
      select: { DynamicId: true },
    });
    return new Set(likes.map((like) => like.DynamicId));
  }

  private async card(
    row: Row,
    likedByMe: boolean,
    coverUrl: string | null,
  ): Promise<OwnDynamicCard> {
    if (!['pending', 'published', 'hidden'].includes(row.Status)) {
      throw new Error('Unexpected own dynamic status');
    }
    return {
      dynamicId: row.DynamicId,
      author: {
        userId: row.Author.UserId,
        nickname: row.Author.Nickname,
        avatarUrl: await resolveAvatarUrl(this.storage, row.Author),
      },
      summary: articleReadableText(row.Content, row.ContentFormat).slice(0, 180),
      coverUrl,
      imageCount: row.Images.filter(
        ({ Asset }) =>
          Asset.Status === 'ready' &&
          Asset.OwnerUserId === row.Author.UserId &&
          ['image/jpeg', 'image/png', 'image/webp'].includes(Asset.MimeType),
      ).length,
      resort: row.Resort
        ? { resortId: row.Resort.ResortId, name: row.Resort.Name }
        : null,
      likeCount: row._count.Likes,
      commentCount: row._count.Comments,
      likedByMe,
      status: row.Status as OwnDynamicCard['status'],
      createdAt: row.CreateTime.toISOString(),
    };
  }
}
