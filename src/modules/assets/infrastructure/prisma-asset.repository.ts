import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AdminAssetAccess } from '../domain/admin-asset-access.js';
import {
  authorizeAdminAssetDeletion,
  authorizeAdminAssetRead,
} from './admin-asset-authorization.js';
import {
  authorizeOwnedAsset,
  authorizeOwnedAssetUpload,
} from './owned-asset-authorization.js';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';
import type {
  AssetRecord,
  AssetRepository,
} from '../application/ports/asset-repository.js';
import type {
  AdminAssetRecord,
  AdminAssetRepository,
} from '../application/ports/admin-asset-repository.js';

@Injectable()
export class PrismaAssetRepository
  implements AssetRepository, AdminAssetRepository
{
  constructor(private readonly prisma: PrismaService) {}

  async createPending(input: {
    ownerUserId: number;
    storageKey: string;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
  }): Promise<AssetRecord> {
    return this.prisma.$transaction(
      async (tx) => {
        await authorizeOwnedAssetUpload(tx, input.ownerUserId);
        const asset = await tx.asset.create({
          data: {
            OwnerUserId: input.ownerUserId,
            StorageKey: input.storageKey,
            OriginalName: input.originalName,
            MimeType: input.mimeType,
            SizeBytes: BigInt(input.sizeBytes),
            Sha256: input.sha256,
            Status: 'pending_scan',
          },
        });
        return mapAsset(asset);
      },
      { isolationLevel: 'Serializable' },
    );
  }

  async setStatus(
    assetId: string,
    status: 'ready' | 'rejected',
  ): Promise<boolean> {
    if (status === 'ready') {
      return this.prisma.$transaction(
        async (tx) => {
          // Do not hold a transaction across scanner or S3 I/O. Resolve the
          // owner from the row and reauthorize after those external operations.
          await tx.$queryRaw`SELECT "AssetId" FROM "Asset" WHERE "AssetId" = ${BigInt(assetId)} FOR UPDATE`;
          const asset = await tx.asset.findUnique({
            where: { AssetId: BigInt(assetId) },
            select: { OwnerUserId: true, Status: true },
          });
          if (!asset || asset.Status !== 'pending_scan') return false;
          await authorizeOwnedAssetUpload(tx, asset.OwnerUserId);
          const result = await tx.asset.updateMany({
            where: {
              AssetId: BigInt(assetId),
              OwnerUserId: asset.OwnerUserId,
              Status: 'pending_scan',
            },
            data: { Status: 'ready' },
          });
          return result.count === 1;
        },
        { isolationLevel: 'Serializable' },
      );
    }
    // A failed or revoked upload still needs cleanup; rejected is a monotonic
    // transition from pending_scan, never a way to revive ready/deleted rows.
    const result = await this.prisma.asset.updateMany({
      where: { AssetId: BigInt(assetId), Status: 'pending_scan' },
      data: { Status: status },
    });
    return result.count === 1;
  }

  async findOwnedReady(
    assetId: string,
    ownerUserId: number,
    operation: 'read' | 'delete',
  ): Promise<AssetRecord | null> {
    return this.prisma.$transaction(
      async (tx) => {
        await authorizeOwnedAsset(
          tx,
          ownerUserId,
          operation === 'read' ? 'asset:read-own' : 'asset:delete-own',
        );
        const asset = await tx.asset.findFirst({
          where: {
            AssetId: BigInt(assetId),
            OwnerUserId: ownerUserId,
            Status: 'ready',
          },
        });
        return asset ? mapAsset(asset) : null;
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async deleteIfUnreferenced(
    assetId: string,
    ownerUserId: number,
  ): Promise<boolean> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "AssetId" FROM "Asset" WHERE "AssetId" = ${BigInt(assetId)} FOR UPDATE`;
        await authorizeOwnedAsset(tx, ownerUserId, 'asset:delete-own');
        // A binding writer can commit while this Serializable transaction waits
        // for the row lock. Read committed references after locking, as in the
        // management delete path; this separate read only adds a veto.
        const current = await this.prisma.asset.findFirst({
          where: {
            AssetId: BigInt(assetId),
            OwnerUserId: ownerUserId,
            Status: 'ready',
          },
          select: {
            _count: {
              select: {
                CoverResorts: true,
                ResortImages: true,
                ArticleCovers: true,
                ArticleBodyImages: true,
                DynamicImages: true,
                AvatarUsers: true,
              },
            },
          },
        });
        if (
          !current ||
          Object.values(current._count).some((count) => count > 0)
        )
          return false;
        const result = await tx.asset.updateMany({
          where: {
            AssetId: BigInt(assetId),
            OwnerUserId: ownerUserId,
            Status: 'ready',
            CoverResorts: { none: {} },
            ResortImages: { none: {} },
            ArticleCovers: { none: {} },
            ArticleBodyImages: { none: {} },
            DynamicImages: { none: {} },
            AvatarUsers: { none: {} },
          },
          data: { Status: 'deleted' },
        });
        return result.count === 1;
      },
      { isolationLevel: 'Serializable' },
    );
  }

  async verifyReadAccess(input: {
    actorUserId: number;
    access: AdminAssetAccess;
    assets: readonly AdminAssetRecord[];
  }): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        const access = await authorizeAdminAssetRead(
          tx,
          input.actorUserId,
          input.access,
        );
        if (!input.assets.length) return;
        const current = await tx.asset.findMany({
          where: {
            AssetId: { in: input.assets.map((asset) => BigInt(asset.assetId)) },
            AND: [assetAccessWhere(access)],
          },
          select: {
            AssetId: true,
            OwnerUserId: true,
            StorageKey: true,
            Status: true,
          },
        });
        const byId = new Map(
          current.map((asset) => [asset.AssetId.toString(), asset]),
        );
        for (const asset of input.assets) {
          const row = byId.get(asset.assetId);
          if (
            !row ||
            row.OwnerUserId !== asset.ownerUserId ||
            row.StorageKey !== asset.storageKey ||
            row.Status !== asset.status
          ) {
            throw new NotFoundException(
              'Asset changed or is no longer visible',
            );
          }
        }
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async findPage(input: {
    access: AdminAssetAccess;
    skip: number;
    take: number;
    status?: string;
    ownerUserId?: number;
    keyword?: string;
  }): Promise<{ items: AdminAssetRecord[]; total: number }> {
    const where = {
      AND: [assetAccessWhere(input.access)],
      ...(input.status ? { Status: input.status } : {}),
      ...(input.ownerUserId ? { OwnerUserId: input.ownerUserId } : {}),
      ...(input.keyword
        ? {
            OR: [
              {
                OriginalName: {
                  contains: input.keyword,
                  mode: 'insensitive' as const,
                },
              },
              {
                StorageKey: {
                  contains: input.keyword,
                  mode: 'insensitive' as const,
                },
              },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.asset.findMany({
        where,
        skip: input.skip,
        take: input.take,
        orderBy: [{ CreateTime: 'desc' }, { AssetId: 'desc' }],
        include: {
          Owner: { select: { Account: true } },
          _count: {
            select: {
              CoverResorts: true,
              ResortImages: true,
              ArticleCovers: true,
                ArticleBodyImages: true,
              DynamicImages: true,
              AvatarUsers: true,
            },
          },
        },
      }),
      this.prisma.asset.count({ where }),
    ]);
    return { items: rows.map(mapAdminAsset), total };
  }

  async findById(
    assetId: string,
    access: AdminAssetAccess,
  ): Promise<AdminAssetRecord | null> {
    if (!/^\d+$/.test(assetId)) return null;
    const asset = await this.prisma.asset.findFirst({
      where: { AssetId: BigInt(assetId), AND: [assetAccessWhere(access)] },
      include: {
        Owner: { select: { Account: true } },
        _count: {
          select: {
            CoverResorts: true,
            ResortImages: true,
            ArticleCovers: true,
                ArticleBodyImages: true,
            DynamicImages: true,
            AvatarUsers: true,
          },
        },
      },
    });
    return asset ? mapAdminAsset(asset) : null;
  }

  async deleteIfUnreferencedAdmin(input: {
    access: AdminAssetAccess;
    assetId: string;
    actorUserId: number;
    traceId: string;
    clientIp: string | null;
    userAgent: string | null;
  }): Promise<'deleted' | 'not_found' | 'referenced'> {
    if (!/^\d+$/.test(input.assetId)) return 'not_found';
    return this.prisma
      .$transaction(
        async (transaction) => {
          const access = await authorizeAdminAssetDeletion(
            transaction,
            input.actorUserId,
            input.access,
          );
          await transaction.$queryRaw`SELECT "AssetId" FROM "Asset" WHERE "AssetId" = ${BigInt(input.assetId)} FOR UPDATE`;
          // Authorization may establish the Serializable snapshot before a lock
          // wait. Read committed references on a separate connection after owning
          // the lock: binding writers hold FOR SHARE on this same Asset row.
          // This read only adds a veto; authorization and all writes stay in tx.
          const current = await this.prisma.asset.findFirst({
            where: {
              AssetId: BigInt(input.assetId),
              AND: [assetAccessWhere(access)],
            },
            select: {
              _count: {
                select: {
                  CoverResorts: true,
                  ResortImages: true,
                  ArticleCovers: true,
                ArticleBodyImages: true,
                  DynamicImages: true,
                  AvatarUsers: true,
                },
              },
            },
          });
          if (!current) return 'not_found';
          if (Object.values(current._count).some((count) => count > 0))
            return 'referenced';
          const result = await transaction.asset.updateMany({
            where: {
              AssetId: BigInt(input.assetId),
              AND: [assetAccessWhere(access)],
              Status: { in: ['ready', 'rejected', 'pending_scan'] },
              CoverResorts: { none: {} },
              ResortImages: { none: {} },
              ArticleCovers: { none: {} },
            ArticleBodyImages: { none: {} },
              DynamicImages: { none: {} },
              AvatarUsers: { none: {} },
            },
            data: { Status: 'deleted' },
          });
          if (result.count !== 1) {
            const visible = await transaction.asset.findFirst({
              where: {
                AssetId: BigInt(input.assetId),
                AND: [assetAccessWhere(access)],
              },
              select: { AssetId: true },
            });
            return visible ? 'referenced' : 'not_found';
          }
          const actor = await transaction.user.findUnique({
            where: { UserId: input.actorUserId },
            select: { Account: true },
          });
          await transaction.operationLog.create({
            data: {
              ActorUserId: input.actorUserId,
              ActorAccountSnapshot:
                actor?.Account ?? `user:${input.actorUserId}`,
              ActionKey: 'content:asset:delete',
              ResourceKey: 'asset',
              TargetType: 'asset',
              TargetId: input.assetId,
              Result: 'success',
              Reason: null,
              TraceId: input.traceId,
              ClientIp: input.clientIp,
              UserAgent: input.userAgent,
            },
          });
          return 'deleted';
        },
        { isolationLevel: 'Serializable' },
      )
      .catch((error: unknown) => {
        if (isAssetWriteConflict(error))
          throw new ConflictException(
            'Asset changed concurrently; reload before retrying',
          );
        throw error;
      });
  }
}

function isAssetWriteConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { code?: string; meta?: { code?: string } };
  return (
    value.code === 'P2034' ||
    value.code === '40001' ||
    value.code === '40P01' ||
    (value.code === 'P2010' &&
      (value.meta?.code === '40001' || value.meta?.code === '40P01'))
  );
}

function assetAccessWhere(access: AdminAssetAccess): Prisma.AssetWhereInput {
  switch (access.kind) {
    case 'all':
      return {};
    case 'self':
      return { OwnerUserId: access.userId };
    case 'selected':
      return { AssetId: { in: access.ids.map((id) => BigInt(id)) } };
  }
}

function mapAsset(asset: {
  AssetId: bigint;
  OwnerUserId: number;
  StorageKey: string;
  OriginalName: string;
  MimeType: string;
  SizeBytes: bigint;
  Status: string;
  CreateTime: Date;
}): AssetRecord {
  return {
    assetId: asset.AssetId.toString(),
    ownerUserId: asset.OwnerUserId,
    storageKey: asset.StorageKey,
    originalName: asset.OriginalName,
    mimeType: asset.MimeType,
    sizeBytes: asset.SizeBytes.toString(),
    status: asset.Status as AssetRecord['status'],
    createdAt: asset.CreateTime,
  };
}

function mapAdminAsset(asset: {
  AssetId: bigint;
  OwnerUserId: number;
  StorageKey: string;
  OriginalName: string;
  MimeType: string;
  SizeBytes: bigint;
  Status: string;
  CreateTime: Date;
  Owner: { Account: string };
  _count: {
    CoverResorts: number;
    ResortImages: number;
    ArticleCovers: number;
    ArticleBodyImages?: number;
    DynamicImages: number;
    AvatarUsers: number;
  };
}): AdminAssetRecord {
  const record = mapAsset(asset);
  return {
    ...record,
    ownerAccount: asset.Owner.Account,
    references: {
      coverResorts: asset._count.CoverResorts,
      resortImages: asset._count.ResortImages,
      articleCovers: asset._count.ArticleCovers + (asset._count.ArticleBodyImages ?? 0),
      dynamicImages: asset._count.DynamicImages,
      userAvatars: asset._count.AvatarUsers,
    },
  };
}
