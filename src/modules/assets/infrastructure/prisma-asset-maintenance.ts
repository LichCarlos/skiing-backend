import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../../../shared/persistence/prisma.service.js';
import type { AssetStorage } from '../application/ports/asset-storage.js';

export class PrismaAssetMaintenance {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: AssetStorage,
  ) {}
  async sweep(input: {
    apply: boolean;
    afterId?: string;
    batchSize?: number;
    minAgeHours?: number;
  }) {
    const after = input.afterId ?? '0',
      batch = input.batchSize ?? 100,
      age = input.minAgeHours ?? 24;
    if (
      !/^\d{1,19}$/.test(after) ||
      BigInt(after) > 9223372036854775807n ||
      !Number.isInteger(batch) ||
      batch < 1 ||
      batch > 500 ||
      !Number.isInteger(age) ||
      age < 24 ||
      age > 8760
    )
      throw new RangeError('Invalid maintenance limits');
    const rows = await this.prisma.$transaction(
      async (tx) => {
        const candidates = await tx.$queryRaw<
          { AssetId: bigint; StorageKey: string }[]
        >(Prisma.sql`
        SELECT a."AssetId",a."StorageKey" FROM "Asset" a WHERE a."AssetId">${BigInt(after)} AND a."StorageDeletedAt" IS NULL
        AND a."CreateTime"<=NOW()-(${age}*INTERVAL '1 hour') AND a."Status" IN ('ready','pending_scan','rejected','deleted')
        AND NOT EXISTS(SELECT 1 FROM "User" u WHERE u."AvatarAssetId"=a."AssetId")
        AND NOT EXISTS(SELECT 1 FROM "SkiResort" r WHERE r."CoverAssetId"=a."AssetId")
        AND NOT EXISTS(SELECT 1 FROM "ResortImage" r WHERE r."AssetId"=a."AssetId")
        AND NOT EXISTS(SELECT 1 FROM "Article" r WHERE r."CoverAssetId"=a."AssetId")
        AND NOT EXISTS(SELECT 1 FROM "ArticleBodyAsset" r WHERE r."AssetId"=a."AssetId")
        AND NOT EXISTS(SELECT 1 FROM "DynamicImage" r WHERE r."AssetId"=a."AssetId")
        ORDER BY a."AssetId" LIMIT ${batch} ${input.apply ? Prisma.sql`FOR UPDATE OF a SKIP LOCKED` : Prisma.empty}`);
        const eligible = [];
        if (input.apply)
          for (const row of candidates) {
            // The candidate query can own a snapshot older than a binding writer
            // that just committed. After taking the exclusive Asset lock, use a
            // fresh committed read as an additional veto. Every binding writer
            // holds a shared/exclusive lock on this same row until commit.
            const current = await this.prisma.asset.findUnique({
              where: { AssetId: row.AssetId },
              select: {
                Status: true,
                StorageDeletedAt: true,
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
              current.StorageDeletedAt ||
              !['ready', 'pending_scan', 'rejected', 'deleted'].includes(
                current.Status,
              ) ||
              Object.values(current._count).some((count) => count > 0)
            )
              continue;
            await tx.asset.update({
              where: { AssetId: row.AssetId },
              data: { Status: 'deleted' },
            });
            await tx.operationLog.create({
              data: {
                ActorUserId: null,
                ActorAccountSnapshot: 'system:maintenance',
                ActionKey: 'asset:cleanup:retire',
                ResourceKey: 'asset',
                TargetType: 'Asset',
                TargetId: String(row.AssetId),
                Result: 'success',
                Reason: 'unreferenced_asset_expired',
                TraceId: randomUUID(),
              },
            });
            eligible.push(row);
          }
        return {
          rows: input.apply ? eligible : candidates,
          nextCursor: candidates.at(-1)?.AssetId.toString() ?? null,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 30000,
      },
    );
    let removed = 0,
      failed = 0;
    // Once retired, reference writers reject the asset; S3 I/O never holds a DB lock.
    // remove is idempotent. Crashes between remove and checkpoint are retried safely.
    if (input.apply)
      for (const row of rows.rows) {
        try {
          await this.storage.remove(row.StorageKey);
        } catch {
          await this.checkpoint(row.AssetId, false);
          failed++;
          continue;
        }
        await this.checkpoint(row.AssetId, true);
        removed++;
      }
    return {
      dryRun: !input.apply,
      candidates: rows.rows.length,
      removed,
      failed,
      nextCursor: rows.nextCursor,
    };
  }
  private async checkpoint(assetId: bigint, removed: boolean) {
    await this.prisma.$transaction(async (tx) => {
      await tx.asset.update({
        where: { AssetId: assetId, Status: 'deleted' },
        data: removed
          ? { StorageDeletedAt: new Date(), CleanupFailureCode: null }
          : { CleanupFailureCode: 'storage_delete_failed' },
      });
      await tx.operationLog.create({
        data: {
          ActorUserId: null,
          ActorAccountSnapshot: 'system:maintenance',
          ActionKey: 'asset:cleanup:storage-delete',
          ResourceKey: 'asset',
          TargetType: 'Asset',
          TargetId: String(assetId),
          Result: removed ? 'success' : 'failure',
          Reason: removed
            ? 'unreferenced_asset_removed'
            : 'storage_delete_failed',
          TraceId: randomUUID(),
        },
      });
    });
  }
}
