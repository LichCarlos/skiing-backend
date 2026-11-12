import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  authorizeMerchantWrite,
  merchantFieldContext,
} from './merchant-resort-authorization.js';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';
import {
  OUTBOX_STORE,
  type OutboxStore,
  type TransactionContext,
} from '../../integration-events/application/ports/outbox-store.js';
import type { MerchantResortAccess } from '../domain/resort-management-scope.js';
import type { MerchantResortFieldGrant } from '../domain/merchant-resort.js';
import type {
  MerchantResortRepository,
  MerchantResortTransaction,
} from '../application/ports/merchant-resort-repository.js';
import type {
  MerchantResortRecord,
  MerchantResortValues,
  MerchantResortAuditContext,
  MerchantResortAuditChange,
  ResortRelations,
} from '../application/merchant-resort-models.js';
import {
  merchantResortWhere,
  merchantResortTargetWhere,
} from './merchant-resort-scope.js';

const resortInclude = {
  FitTags: {
    include: { Item: { select: { Value: true } } },
    orderBy: { ItemId: 'asc' as const },
  },
  Gallery: {
    include: { Asset: { select: { StorageKey: true } } },
    orderBy: { SortOrder: 'asc' as const },
  },
  CoverAsset: { select: { StorageKey: true } },
};
type ResortRow = Prisma.SkiResortGetPayload<{ include: typeof resortInclude }>;

@Injectable()
export class PrismaMerchantResortRepository implements MerchantResortRepository {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(OUTBOX_STORE) private readonly outbox: OutboxStore,
  ) {}
  async findPage(
    access: MerchantResortAccess,
    query: { status?: string; skip: number; take: number },
  ) {
    const where = {
      ...merchantResortWhere(access),
      ...(query.status ? { Status: query.status } : {}),
    };
    const [items, total] = await this.prisma.$transaction(
      [
        this.prisma.skiResort.findMany({
          where,
          skip: query.skip,
          take: query.take,
          orderBy: [{ UpdateTime: 'desc' }, { ResortId: 'desc' }],
          include: resortInclude,
        }),
        this.prisma.skiResort.count({ where }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return { items: items.map(toRecord), total };
  }
  async find(access: MerchantResortAccess, resortId: number) {
    const row = await this.prisma.skiResort.findFirst({
      where: merchantResortTargetWhere(access, resortId),
      include: resortInclude,
    });
    return row ? toRecord(row) : null;
  }
  requireActiveActor(access: MerchantResortAccess) {
    return new PrismaMerchantResortTransaction(
      this.prisma,
      this.outbox,
    ).requireActiveActor(access);
  }
  async fieldGrants(userId: number): Promise<MerchantResortFieldGrant[][]> {
    const roles = await this.prisma.userRole.findMany({
      where: { UserId: userId, Role: { Status: 'active' } },
      select: {
        Role: {
          select: {
            FieldPolicies: {
              where: { EntityType: 'ski_resort' },
              select: { FieldKey: true, CanRead: true, CanWrite: true },
            },
          },
        },
      },
    });
    return roles.map(({ Role }) =>
      Role.FieldPolicies.map((field) => ({
        fieldKey: field.FieldKey,
        canRead: field.CanRead,
        canWrite: field.CanWrite,
      })),
    );
  }
  async runWrite<T>(
    work: (transaction: MerchantResortTransaction) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.prisma.$transaction(
        (tx) => work(new PrismaMerchantResortTransaction(tx, this.outbox)),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2034' ||
          (error.code === 'P2010' &&
            ['40001', '40P01'].includes(String(error.meta?.code))))
      )
        throw new ConflictException(
          'Resort changed concurrently; reload before retrying',
        );
      throw error;
    }
  }
}

class PrismaMerchantResortTransaction implements MerchantResortTransaction {
  constructor(
    private readonly tx: Prisma.TransactionClient,
    private readonly outbox: OutboxStore,
  ) {}
  async authorize(access: MerchantResortAccess, permission: string) {
    await authorizeMerchantWrite(this.tx, access, permission);
    await this.tx.$queryRaw`
      SELECT "MerchantId" FROM "MerchantProfile"
      WHERE "MerchantId" = ${access.merchantId} ORDER BY "MerchantId" FOR SHARE
    `;
    return this.requireActiveActor(access);
  }
  fieldContext(userId: number) {
    return merchantFieldContext(this.tx, userId);
  }
  async find(access: MerchantResortAccess, resortId: number) {
    const row = await this.tx.skiResort.findFirst({
      where: merchantResortTargetWhere(access, resortId),
      include: resortInclude,
    });
    return row ? toRecord(row) : null;
  }
  async create(merchantId: number, data: MerchantResortValues) {
    const row = await this.tx.skiResort.create({
      data: { ...toWriteData(data), MerchantId: merchantId, Status: 'draft' },
      select: { ResortId: true },
    });
    return row.ResortId;
  }
  async update(
    access: MerchantResortAccess,
    resortId: number,
    expectedUpdatedAt: Date,
    change: {
      values?: MerchantResortValues;
      status?: import('../domain/merchant-resort.js').MerchantResortStatus;
      deletedAt?: Date;
    },
  ) {
    const result = await this.tx.skiResort.updateMany({
      where: {
        ...merchantResortTargetWhere(access, resortId),
        UpdateTime: expectedUpdatedAt,
      },
      data: {
        ...(change.values ? toWriteData(change.values) : {}),
        ...(change.status ? { Status: change.status } : {}),
        ...(change.deletedAt ? { DeletedAt: change.deletedAt } : {}),
      },
    });
    return result.count === 1;
  }
  appendChanged(resortId: number, merchantId: number, status: string) {
    return this.outbox.append(this.tx as unknown as TransactionContext, {
      eventId: randomUUID(),
      eventType: 'resort.changed.v1',
      aggregateType: 'ski_resort',
      aggregateId: String(resortId),
      occurredAt: new Date(),
      payload: { resortId, merchantId, status },
    });
  }
  async requireActiveActor(access: MerchantResortAccess): Promise<string> {
    const profile = await this.tx.merchantProfile.findFirst({
      where: {
        MerchantId: access.merchantId!,
        UserId: access.userId,
        Status: 'active',
        User: { Status: 'active' },
      },
      select: { User: { select: { Account: true } } },
    });
    if (!profile)
      throw new ForbiddenException(
        'An active merchant profile owned by the current account is required',
      );
    return profile.User.Account;
  }

  async assertReferences(userId: number, body: ResortRelations): Promise<void> {
    const ids = [
      ...new Set([
        ...(Array.isArray(body.galleryAssetIds)
          ? (body.galleryAssetIds as string[])
          : []),
        ...(typeof body.coverAssetId === 'string' ? [body.coverAssetId] : []),
      ]),
    ];
    if (ids.length) {
      const assetIds = ids
        .map(BigInt)
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      await this.tx.$queryRaw(Prisma.sql`
        SELECT "AssetId" FROM "Asset" WHERE "AssetId" IN (${Prisma.join(assetIds)})
        ORDER BY "AssetId" FOR SHARE
      `);
      const assets = await this.tx.asset.findMany({
        where: {
          AssetId: { in: ids.map(BigInt) },
          OwnerUserId: userId,
          Status: 'ready',
          MimeType: { in: ['image/jpeg', 'image/png', 'image/webp'] },
        },
        select: { AssetId: true },
      });
      if (assets.length !== ids.length)
        throw new UnprocessableEntityException(
          'Assets must be ready and owned by the current user',
        );
    }
    const tags = Array.isArray(body.fitTagValues)
      ? (body.fitTagValues as string[])
      : [];
    if (tags.length) {
      await this.tx
        .$queryRaw`SELECT "DictType" FROM "DictionaryType" WHERE "DictType" = 'resort.fit_tag' FOR SHARE`;
      await this.tx.$queryRaw(Prisma.sql`
        SELECT "ItemId" FROM "DictionaryItem" WHERE "DictType" = 'resort.fit_tag'
          AND "Value" IN (${Prisma.join([...tags].sort())}) ORDER BY "ItemId" FOR SHARE
      `);
      const active = await this.tx.dictionaryItem.findMany({
        where: {
          DictType: 'resort.fit_tag',
          Value: { in: tags },
          Status: 'active',
          Type: { Status: 'active' },
        },
        select: { Value: true },
      });
      if (active.length !== tags.length)
        throw new UnprocessableEntityException('Unknown or inactive fit tag');
    }
  }

  async audit(
    userId: number,
    account: string,
    audit: MerchantResortAuditContext,
    change: MerchantResortAuditChange,
  ): Promise<void> {
    await this.tx.operationLog.create({
      data: {
        ActorUserId: userId,
        ActorAccountSnapshot: account,
        ActionKey: change.actionKey,
        ResourceKey: 'resort',
        TargetType: 'SkiResort',
        TargetId: String(change.resortId),
        Result: 'success',
        TraceId: audit.traceId,
        ClientIp: audit.clientIp,
        UserAgent: audit.userAgent,
        Metadata: {
          ...(change.before
            ? { before: change.before as Prisma.InputJsonObject }
            : {}),
          after: change.after as Prisma.InputJsonObject,
          ...(change.changedFields
            ? { changedFields: change.changedFields }
            : {}),
        },
      },
    });
  }

  async replaceRelations(
    resortId: number,
    body: ResortRelations,
  ): Promise<void> {
    if (body.galleryAssetIds !== undefined) {
      await this.tx.resortImage.deleteMany({ where: { ResortId: resortId } });
      const ids = body.galleryAssetIds as string[];
      if (ids.length)
        await this.tx.resortImage.createMany({
          data: ids.map((id, index) => ({
            ResortId: resortId,
            AssetId: BigInt(id),
            SortOrder: index,
          })),
        });
    }
    if (body.fitTagValues !== undefined) {
      await this.tx.resortFitTag.deleteMany({ where: { ResortId: resortId } });
      const tags = body.fitTagValues as string[];
      if (tags.length) {
        const items = await this.tx.dictionaryItem.findMany({
          where: {
            DictType: 'resort.fit_tag',
            Value: { in: tags },
            Status: 'active',
            Type: { Status: 'active' },
          },
          select: { ItemId: true, DictType: true },
        });
        await this.tx.resortFitTag.createMany({
          data: items.map((item) => ({
            ResortId: resortId,
            ItemId: item.ItemId,
            DictType: item.DictType,
          })),
        });
      }
    }
  }
}

function toWriteData(
  data: MerchantResortValues,
): Prisma.SkiResortUncheckedCreateInput {
  return {
    Name: data.name,
    Province: data.province,
    City: data.city,
    District: data.district,
    Address: data.address,
    Longitude:
      data.longitude == null
        ? data.longitude
        : new Prisma.Decimal(data.longitude),
    Latitude:
      data.latitude == null ? data.latitude : new Prisma.Decimal(data.latitude),
    CoverAssetId: data.coverAssetId == null ? null : BigInt(data.coverAssetId),
    Price: data.price,
    OpenStatus: data.openStatus,
    SnowCondition: data.snowCondition,
    OpeningHours: data.openingHours,
    TrailSummary: data.trailSummary,
    FacilitySummary: data.facilitySummary,
    OfficialUrl: data.officialUrl,
    Description: data.description,
    CustomFields: data.customFields as Prisma.InputJsonObject,
    LegacyDistance: new Prisma.Decimal(0),
  };
}
function toRecord(row: ResortRow): MerchantResortRecord {
  return {
    name: row.Name,
    province: row.Province,
    city: row.City,
    district: row.District,
    address: row.Address,
    longitude: row.Longitude?.toString() ?? null,
    latitude: row.Latitude?.toString() ?? null,
    coverAssetId: row.CoverAssetId?.toString() ?? null,
    price: row.Price,
    openStatus: row.OpenStatus,
    snowCondition: row.SnowCondition,
    openingHours: row.OpeningHours,
    trailSummary: row.TrailSummary,
    facilitySummary: row.FacilitySummary,
    officialUrl: row.OfficialUrl,
    description: row.Description,
    customFields: row.CustomFields,
    resortId: row.ResortId,
    merchantId: row.MerchantId,
    rating: row.Rating?.toString() ?? null,
    ratingCount: row.RatingCount,
    snowConditionUpdatedAt: row.SnowConditionUpdatedAt,
    status: row.Status as MerchantResortRecord['status'],
    coverStorageKey: row.CoverAsset?.StorageKey ?? null,
    gallery: row.Gallery.map((item) => ({
      assetId: item.AssetId.toString(),
      sortOrder: item.SortOrder,
      storageKey: item.Asset.StorageKey,
    })),
    fitTags: row.FitTags.map(({ Item }) => Item.Value),
    updatedAt: row.UpdateTime,
  };
}
