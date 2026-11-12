import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';
import type { PublicResortReader } from '../application/ports/public-resort-reader.js';
import type { PublicResortRecord } from '../application/public-resort-models.js';
import {
  normalizePublicResortQuery,
  type NormalizedPublicResortQuery,
} from '../domain/public-resort-query.js';
const publicResortInclude = {
  FitTags: {
    where: {
      Item: { Status: 'active', Type: { Status: 'active' } },
    },
    include: { Item: { select: { Value: true, Label: true } } },
    orderBy: { ItemId: 'asc' as const },
  },
  CoverAsset: { select: { StorageKey: true } },
  Gallery: {
    include: { Asset: { select: { StorageKey: true } } },
    orderBy: { SortOrder: 'asc' as const },
  },
};

type ResortRow = Prisma.SkiResortGetPayload<{
  include: typeof publicResortInclude;
}>;
@Injectable()
export class PrismaPublicResortReader implements PublicResortReader {
  constructor(private readonly prisma: PrismaService) {}
  async findPublicFitTags() {
    const items = await this.prisma.dictionaryItem.findMany({
      where: {
        DictType: 'resort.fit_tag',
        Status: 'active',
        Type: { Status: 'active' },
        ResortTags: {
          some: {
            Resort: { Status: 'published', DeletedAt: null },
          },
        },
      },
      orderBy: [{ SortOrder: 'asc' }, { ItemId: 'asc' }],
      select: { Value: true, Label: true },
    });
    return items.map(({ Value, Label }) => ({ value: Value, label: Label }));
  }
  async findPage(input: NormalizedPublicResortQuery, userId?: number) {
    const query = normalizePublicResortQuery(input);
    const predicate = whereSql(query),
      distance = distanceSql(query);
    const column =
      query.sortBy === 'name'
        ? Prisma.sql`r."Name"`
        : query.sortBy === 'price'
          ? Prisma.sql`r."Price"`
          : query.sortBy === 'rating'
            ? Prisma.sql`r."Rating"`
            : Prisma.sql`"distanceMeters"`;
    const direction =
      query.sortOrder === 'desc' ? Prisma.sql`DESC` : Prisma.sql`ASC`;
    return this.prisma.$transaction(
      async (tx) => {
        const counts = await tx.$queryRaw<{ total: bigint }[]>(
          Prisma.sql`SELECT COUNT(*)::bigint AS total FROM "SkiResort" r WHERE ${predicate}`,
        );
        const page = await tx.$queryRaw<
          { resortId: number; distanceMeters: number | null }[]
        >(Prisma.sql`
        SELECT r."ResortId" AS "resortId", ${distance} AS "distanceMeters"
        FROM "SkiResort" r WHERE ${predicate}
        ORDER BY ${column} ${direction} NULLS LAST, r."ResortId" ASC
        LIMIT ${query.pageSize} OFFSET ${query.skip}`);
        const ids = page.map((item) => item.resortId);
        const records = ids.length
          ? await tx.skiResort.findMany({
              where: {
                ResortId: { in: ids },
                Status: 'published',
                DeletedAt: null,
              },
              include: publicResortInclude,
            })
          : [];
        const favorites =
          userId && ids.length
            ? await tx.favorite.findMany({
                where: { UserId: userId, ResortId: { in: ids } },
                select: { ResortId: true },
              })
            : [];
        const favoriteIds = new Set(favorites.map((item) => item.ResortId));
        const byId = new Map(records.map((row) => [row.ResortId, row]));
        return {
          total: Number(counts[0]?.total ?? 0n),
          items: page.flatMap((item) => {
            const row = byId.get(item.resortId);
            return row
              ? [
                  toRecord(
                    row,
                    item.distanceMeters,
                    favoriteIds.has(row.ResortId),
                  ),
                ]
              : [];
          }),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async find(resortId: number, userId?: number) {
    return this.prisma.$transaction(
      async (tx) => {
        const record = await tx.skiResort.findFirst({
          where: { ResortId: resortId, Status: 'published', DeletedAt: null },
          include: publicResortInclude,
        });
        if (!record) return null;
        const favorites = userId
          ? await tx.favorite.findMany({
              where: { UserId: userId, ResortId: resortId },
              select: { ResortId: true },
            })
          : [];
        return toRecord(record, null, favorites.length > 0);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
function whereSql(query: NormalizedPublicResortQuery): Prisma.Sql {
  const conditions = [
    Prisma.sql`r."Status" = 'published'`,
    Prisma.sql`r."DeletedAt" IS NULL`,
  ];
  if (query.keyword)
    conditions.push(Prisma.sql`(
    position(lower(${query.keyword}) in lower(r."Name")) > 0 OR
    position(lower(${query.keyword}) in lower(COALESCE(r."Province",''))) > 0 OR
    position(lower(${query.keyword}) in lower(COALESCE(r."City",''))) > 0 OR
    position(lower(${query.keyword}) in lower(COALESCE(r."District",''))) > 0)`);
  if (query.province)
    conditions.push(Prisma.sql`r."Province"=${query.province}`);
  if (query.city) conditions.push(Prisma.sql`r."City"=${query.city}`);
  if (query.district)
    conditions.push(Prisma.sql`r."District"=${query.district}`);
  if (query.openStatus)
    conditions.push(Prisma.sql`r."OpenStatus"=${query.openStatus}`);
  if (query.minPrice !== undefined)
    conditions.push(Prisma.sql`r."Price">=${query.minPrice}`);
  if (query.maxPrice !== undefined)
    conditions.push(Prisma.sql`r."Price"<=${query.maxPrice}`);
  if (query.minRating !== undefined)
    conditions.push(Prisma.sql`r."Rating">=${query.minRating}`);
  for (const tag of query.fitTags)
    conditions.push(Prisma.sql`EXISTS (
    SELECT 1 FROM "ResortFitTag" rt JOIN "DictionaryItem" di ON di."ItemId"=rt."ItemId" AND di."DictType"=rt."DictType"
    JOIN "DictionaryType" dt ON dt."DictType"=di."DictType"
    WHERE rt."ResortId"=r."ResortId" AND di."DictType"='resort.fit_tag' AND di."Value"=${tag}
      AND di."Status"='active' AND dt."Status"='active')`);
  return Prisma.join(conditions, ' AND ');
}
function distanceSql(query: NormalizedPublicResortQuery): Prisma.Sql {
  if (query.latitude === undefined) return Prisma.sql`NULL::double precision`;
  return Prisma.sql`CASE WHEN r."Latitude" IS NULL OR r."Longitude" IS NULL THEN NULL ELSE
    ROUND((6371000.0 * 2 * asin(sqrt(LEAST(1.0, GREATEST(0.0,
      power(sin(radians(r."Latitude"::double precision-${query.latitude}::double precision)/2),2) +
      cos(radians(${query.latitude}::double precision))*cos(radians(r."Latitude"::double precision))*
      power(sin(radians(r."Longitude"::double precision-${query.longitude}::double precision)/2),2)
    )))))::numeric)::double precision END`;
}
function toRecord(
  row: ResortRow,
  distanceMeters: number | null,
  favoriteByMe: boolean,
): PublicResortRecord {
  return {
    resortId: row.ResortId,
    name: row.Name,
    province: row.Province,
    city: row.City,
    district: row.District,
    address: row.Address,
    longitude: row.Longitude?.toString() ?? null,
    latitude: row.Latitude?.toString() ?? null,
    rating: row.Rating?.toString() ?? null,
    ratingCount: row.RatingCount,
    price: row.Price,
    openStatus: row.OpenStatus,
    snowCondition: row.SnowCondition,
    snowConditionUpdatedAt: row.SnowConditionUpdatedAt,
    openingHours: row.OpeningHours,
    trailSummary: row.TrailSummary,
    facilitySummary: row.FacilitySummary,
    officialUrl: row.OfficialUrl,
    description: row.Description,
    customFields: row.CustomFields,
    coverStorageKey: row.CoverAsset?.StorageKey ?? null,
    galleryStorageKeys: row.Gallery.map(({ Asset }) => Asset.StorageKey),
    fitTags: row.FitTags.map(({ Item }) => ({
      value: Item.Value,
      label: Item.Label,
    })),
    updatedAt: row.UpdateTime,
    distanceMeters,
    favoriteByMe,
  };
}
