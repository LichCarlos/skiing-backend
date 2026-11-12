import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';
import {
  ASSET_STORAGE,
  type AssetStorage,
} from '../../assets/application/ports/asset-storage.js';
import type {
  AdminDynamicQuery,
  PageQuery,
} from '../application/community-models.js';
import type { AdminCommunityReader } from '../application/ports/admin-community-reader.js';

@Injectable()
export class PrismaAdminCommunityReader implements AdminCommunityReader {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ASSET_STORAGE) private readonly storage: AssetStorage,
  ) {}

  async listDynamics(query: AdminDynamicQuery) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.DynamicWhereInput = {
      DeletedAt: null,
      ...(query.status ? { Status: query.status } : {}),
      ...(query.keyword?.trim()
        ? { Content: { contains: query.keyword.trim(), mode: 'insensitive' } }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction(
      [
        this.prisma.dynamic.findMany({
          where,
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: [{ CreateTime: 'desc' }, { DynamicId: 'desc' }],
          select: adminDynamicSelect,
        }),
        this.prisma.dynamic.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return {
      items: await Promise.all(rows.map((row) => this.toDynamicVO(row))),
      page,
      pageSize,
      total,
      hasNext: page * pageSize < total,
    };
  }

  async getDynamic(dynamicId: number) {
    const row = await this.prisma.dynamic.findFirst({
      where: { DynamicId: dynamicId, DeletedAt: null },
      select: adminDynamicSelect,
    });
    if (!row) return null;
    return this.toDynamicVO(row);
  }

  async listComments(dynamicId: number, query: PageQuery) {
    return this.prisma.$transaction(
      async (tx) => {
        const page = query.page ?? 1;
        const pageSize = query.pageSize ?? 20;
        const dynamic = await tx.dynamic.findFirst({
          where: { DynamicId: dynamicId, DeletedAt: null },
          select: { DynamicId: true },
        });
        if (!dynamic) return null;
        const where = { DynamicId: dynamicId, DeletedAt: null };
        const [rows, total] = await Promise.all([
          tx.comment.findMany({
            where,
            skip: (page - 1) * pageSize,
            take: pageSize,
            orderBy: [{ CreateTime: 'desc' }, { CommentId: 'desc' }],
            select: {
              CommentId: true,
              DynamicId: true,
              AuthorId: true,
              Content: true,
              Status: true,
              ModeratedAt: true,
              ModeratedByUserId: true,
              ModerationReason: true,
              CreateTime: true,
              Author: { select: { Nickname: true } },
            },
          }),
          tx.comment.count({ where }),
        ]);
        return {
          items: rows.map((row) => ({
            commentId: row.CommentId,
            dynamicId: row.DynamicId,
            authorId: row.AuthorId,
            authorNickname: row.Author.Nickname,
            content: row.Content,
            status: row.Status,
            moderatedAt: row.ModeratedAt?.toISOString() ?? null,
            moderatedByUserId: row.ModeratedByUserId,
            moderationReason: row.ModerationReason,
            createdAt: row.CreateTime.toISOString(),
          })),
          page,
          pageSize,
          total,
          hasNext: page * pageSize < total,
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  private async toDynamicVO(row: AdminDynamicRecord) {
    const bodyAssets = (
      await Promise.all(
        row.Images.map(async ({ Asset }) =>
          Asset.Status === 'ready'
            ? {
                assetId: String(Asset.AssetId),
                url: await this.storage.createReadUrl(Asset.StorageKey, 900),
              }
            : null,
        ),
      )
    ).filter(
      (asset): asset is { assetId: string; url: string } => asset !== null,
    );
    return {
      dynamicId: row.DynamicId,
      authorId: row.AuthorId,
      authorNickname: row.Author.Nickname,
      content: row.Content,
      contentFormat: row.ContentFormat,
      version: row.Version,
      bodyAssets,
      resortId: row.ResortId,
      status: row.Status,
      imageUrls: bodyAssets.map((asset) => asset.url),
      moderatedAt: row.ModeratedAt?.toISOString() ?? null,
      moderatedByUserId: row.ModeratedByUserId,
      moderationReason: row.ModerationReason,
      createdAt: row.CreateTime.toISOString(),
      updatedAt: row.UpdateTime.toISOString(),
    };
  }
}

const adminDynamicSelect = {
  DynamicId: true,
  AuthorId: true,
  Content: true,
  ContentFormat: true,
  Version: true,
  ResortId: true,
  Status: true,
  ModeratedAt: true,
  ModeratedByUserId: true,
  ModerationReason: true,
  CreateTime: true,
  UpdateTime: true,
  Author: { select: { Nickname: true } },
  Images: {
    orderBy: { SortOrder: 'asc' as const },
    select: {
      Asset: { select: { AssetId: true, StorageKey: true, Status: true } },
    },
  },
} as const;

type AdminDynamicRecord = Prisma.DynamicGetPayload<{
  select: typeof adminDynamicSelect;
}>;
