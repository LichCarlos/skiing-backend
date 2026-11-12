import {
  Inject,
  Injectable,
  ConflictException,
  ForbiddenException,
  UnprocessableEntityException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';
import {
  OUTBOX_STORE,
  type OutboxStore,
  type TransactionContext,
} from '../../integration-events/application/ports/outbox-store.js';
import { randomUUID } from 'node:crypto';
import type {
  AdminResortRepository,
  AdminResortTransaction,
} from '../application/ports/admin-resort-repository.js';
import type {
  AdminResortValues,
  AdminResortRecord,
  AdminResortAuditContext,
  AdminResortQuery,
} from '../application/admin-resort-models.js';
import type { ResortRelations } from '../application/merchant-resort-models.js';
import { authorizeAdminResortWrite } from './admin-resort-authorization.js';
import { ResolveAuthorizationPrincipal } from '../../identity-access/application/resolve-authorization-principal.js';
import { PrismaAuthorizationPrincipalReader } from '../../identity-access/infrastructure/prisma-authorization-principal-reader.js';
import {
  mayEnterManagementPortal,
  resolveDataScope,
} from '../../identity-access/domain/authorization.js';
import type {
  CustomFieldAccessPolicy,
  CustomFieldDataType,
  CustomFieldDefinition,
  CustomFieldValidationRules,
} from '../../platform-administration/domain/custom-field-validation.js';
import type { CustomFieldSchemaGroup } from '../../platform-administration/application/ports/custom-field-repository.js';
const resortInclude = {
  Merchant: { select: { MerchantId: true, BusinessName: true } },
  FitTags: {
    include: { Item: { select: { Value: true, Label: true } } },
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
export class PrismaAdminResortRepository implements AdminResortRepository {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(OUTBOX_STORE) private readonly outbox: OutboxStore,
  ) {}
  async findPage(query: AdminResortQuery) {
    const where: Prisma.SkiResortWhereInput = {
      DeletedAt: null,
      ...(query.status ? { Status: query.status } : {}),
      ...(query.merchantId ? { MerchantId: query.merchantId } : {}),
      ...(query.keyword
        ? {
            OR: [
              { Name: { contains: query.keyword, mode: 'insensitive' } },
              { City: { contains: query.keyword, mode: 'insensitive' } },
              { Province: { contains: query.keyword, mode: 'insensitive' } },
            ],
          }
        : {}),
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
  async find(resortId: number) {
    const row = await this.prisma.skiResort.findFirst({
      where: { ResortId: resortId, DeletedAt: null },
      include: resortInclude,
    });
    return row ? toRecord(row) : null;
  }
  async findCustomFieldSchema(actorUserId: number) {
    return this.prisma.$transaction(
      (tx) => loadCustomFieldContext(tx, actorUserId),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async runWrite<T>(
    work: (transaction: AdminResortTransaction) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.prisma.$transaction(
        (tx) => work(new PrismaAdminResortTransaction(tx, this.outbox)),
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
class PrismaAdminResortTransaction implements AdminResortTransaction {
  constructor(
    private readonly tx: Prisma.TransactionClient,
    private readonly outbox: OutboxStore,
  ) {}
  authorize(actorUserId: number, permission: string) {
    return authorizeAdminResortWrite(this.tx, actorUserId, permission);
  }
  async fieldContext(actorUserId: number) {
    const context = await loadCustomFieldContext(this.tx, actorUserId);
    const dictionaryValues = new Map<string, ReadonlySet<string>>();
    const dictTypes = new Set(
      context.groups
        .flatMap((group) => group.fields)
        .flatMap((field) =>
          field.optionsDictType ? [field.optionsDictType] : [],
        ),
    );
    for (const dictType of dictTypes) {
      const items = await this.tx.dictionaryItem.findMany({
        where: {
          DictType: dictType,
          Status: 'active',
          Type: { Status: 'active' },
        },
        select: { Value: true },
      });
      dictionaryValues.set(dictType, new Set(items.map((item) => item.Value)));
    }
    return {
      definitions: context.groups
        .flatMap((group) => group.fields)
        .map((field) => ({
          fieldKey: field.fieldKey,
          dataType: field.dataType as CustomFieldDataType,
          required: field.required,
          status: 'active' as const,
          validation: field.validation,
          optionsDictType: field.optionsDictType,
        })),
      policies: context.policies,
      dictionaryValues,
    };
  }
  async find(resortId: number) {
    const row = await this.tx.skiResort.findFirst({
      where: { ResortId: resortId, DeletedAt: null },
      include: resortInclude,
    });
    return row ? toRecord(row) : null;
  }
  async create(values: AdminResortValues) {
    const row = await this.tx.skiResort.create({
      data: { ...toWriteData(values), Status: 'draft' },
      select: { ResortId: true },
    });
    return row.ResortId;
  }
  async update(
    resortId: number,
    version: Date,
    change: Parameters<AdminResortTransaction['update']>[2],
  ) {
    const result = await this.tx.skiResort.updateMany({
      where: { ResortId: resortId, DeletedAt: null, UpdateTime: version },
      data: {
        ...(change.values ? toWriteData(change.values) : {}),
        ...(change.status ? { Status: change.status } : {}),
        ...(change.deletedAt ? { DeletedAt: change.deletedAt } : {}),
      },
    });
    return result.count === 1;
  }
  async assertReferences(
    actorUserId: number,
    merchantId: number | null,
    relations: ResortRelations,
    options = { requireAssetAssociationPermission: true },
  ) {
    await this.assertMerchant(merchantId);
    const ids = [
      ...new Set([
        ...(relations.coverAssetId ? [relations.coverAssetId] : []),
        ...(relations.galleryAssetIds ?? []),
      ]),
    ];
    if (ids.length) {
      if (options.requireAssetAssociationPermission) {
        const principal = await new ResolveAuthorizationPrincipal(
          new PrismaAuthorizationPrincipalReader(this.tx),
        ).execute(actorUserId);
        const assetScope = resolveDataScope(
          principal,
          'content:asset:list',
          'asset',
        );
        if (!mayEnterManagementPortal(principal) || assetScope?.kind !== 'all')
          throw new ForbiddenException(
            'Associating global assets requires content:asset:list with all scope',
          );
      }
      const assetIds = ids
        .map(BigInt)
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      await this.tx.$queryRaw(Prisma.sql`
        SELECT "AssetId" FROM "Asset" WHERE "AssetId" IN (${Prisma.join(assetIds)}) ORDER BY "AssetId" FOR SHARE
      `);
      const found = await this.tx.asset.findMany({
        where: {
          AssetId: { in: ids.map(BigInt) },
          Status: 'ready',
          MimeType: { in: ['image/jpeg', 'image/png', 'image/webp'] },
        },
        select: { AssetId: true },
      });
      if (found.length !== ids.length)
        throw new UnprocessableEntityException(
          'Assets must be ready JPEG, PNG or WebP images',
        );
    }
    const tags = relations.fitTagValues ?? [];
    if (tags.length) {
      await this.tx
        .$queryRaw`SELECT "DictType" FROM "DictionaryType" WHERE "DictType" = 'resort.fit_tag' FOR SHARE`;
      await this.tx.$queryRaw(Prisma.sql`
        SELECT "ItemId" FROM "DictionaryItem" WHERE "DictType" = 'resort.fit_tag'
          AND "Value" IN (${Prisma.join([...tags].sort())}) ORDER BY "ItemId" FOR SHARE
      `);
      const found = await this.tx.dictionaryItem.findMany({
        where: {
          DictType: 'resort.fit_tag',
          Value: { in: tags },
          Status: 'active',
          Type: { Status: 'active' },
        },
        select: { Value: true },
      });
      if (found.length !== tags.length)
        throw new UnprocessableEntityException('Unknown or inactive fit tag');
    }
  }
  async replaceRelations(resortId: number, body: ResortRelations) {
    const gallery = Array.isArray(body.galleryAssetIds)
      ? (body.galleryAssetIds as string[])
      : [];
    const tags = Array.isArray(body.fitTagValues)
      ? (body.fitTagValues as string[])
      : [];
    await this.tx.resortImage.deleteMany({ where: { ResortId: resortId } });
    if (gallery.length)
      await this.tx.resortImage.createMany({
        data: gallery.map((id, index) => ({
          ResortId: resortId,
          AssetId: BigInt(id),
          SortOrder: index,
        })),
      });
    await this.tx.resortFitTag.deleteMany({ where: { ResortId: resortId } });
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

  appendChanged(resortId: number, merchantId: number | null, status: string) {
    return this.outbox.append(this.tx as unknown as TransactionContext, {
      eventId: randomUUID(),
      eventType: 'resort.changed.v1',
      aggregateType: 'ski_resort',
      aggregateId: String(resortId),
      occurredAt: new Date(),
      payload: {
        resortId,
        ...(merchantId === null ? {} : { merchantId }),
        status,
      },
    });
  }

  private async assertMerchant(merchantId: number | null) {
    if (merchantId === null) return;
    await this.tx
      .$queryRaw`SELECT "MerchantId" FROM "MerchantProfile" WHERE "MerchantId" = ${merchantId} ORDER BY "MerchantId" FOR SHARE`;
    const merchant = await this.tx.merchantProfile.findFirst({
      where: {
        MerchantId: merchantId,
        Status: 'active',
        User: { Status: 'active' },
      },
      select: { MerchantId: true },
    });
    if (!merchant)
      throw new UnprocessableEntityException('Merchant profile not found');
  }

  async audit(
    audit: AdminResortAuditContext,
    input: {
      actionKey: string;
      resortId: number;
      metadata: Record<string, unknown>;
      reason?: string | null;
    },
  ): Promise<void> {
    const actor = await this.tx.user.findUnique({
      where: { UserId: audit.actorUserId, Status: 'active' },
      select: { Account: true },
    });
    if (!actor) throw new NotFoundException('Audit actor not found');
    await this.tx.operationLog.create({
      data: {
        ActorUserId: audit.actorUserId,
        ActorAccountSnapshot: actor.Account,
        ActionKey: input.actionKey,
        ResourceKey: 'resort',
        TargetType: 'SkiResort',
        TargetId: String(input.resortId),
        Result: 'success',
        Reason: input.reason ?? null,
        TraceId: audit.traceId,
        ClientIp: audit.clientIp,
        UserAgent: audit.userAgent,
        Metadata: input.metadata as Prisma.InputJsonObject,
      },
    });
  }
}

async function loadCustomFieldContext(
  tx: Prisma.TransactionClient,
  actorUserId: number,
): Promise<{
  groups: CustomFieldSchemaGroup[];
  policies: ReadonlyMap<string, CustomFieldAccessPolicy>;
}> {
  const principal = await new ResolveAuthorizationPrincipal(
    new PrismaAuthorizationPrincipalReader(tx),
  ).execute(actorUserId);
  if (!mayEnterManagementPortal(principal))
    throw new ForbiddenException('Management portal access is required');

  const [groups, grants] = await Promise.all([
    tx.customFieldGroup.findMany({
      where: { EntityType: 'ski_resort', Status: 'active' },
      include: {
        Definitions: {
          where: { Status: 'active' },
          orderBy: [{ SortOrder: 'asc' }, { FieldDefinitionId: 'asc' }],
        },
      },
      orderBy: [{ SortOrder: 'asc' }, { GroupKey: 'asc' }],
    }),
    tx.roleFieldPermission.findMany({
      where: {
        EntityType: 'ski_resort',
        Role: {
          Status: 'active',
          UserRoles: { some: { UserId: actorUserId } },
        },
      },
      select: { FieldKey: true, CanRead: true, CanWrite: true },
    }),
  ]);
  const definitions: CustomFieldDefinition[] = groups.flatMap((group) =>
    group.Definitions.map((field) => ({
      fieldKey: field.FieldKey,
      dataType: field.DataType as CustomFieldDataType,
      required: field.Required,
      status: 'active',
      validation: field.Validation as CustomFieldValidationRules | null,
      optionsDictType: field.OptionsDictType,
    })),
  );
  const systemAdmin =
    principal?.roles.some(
      (role) => role.active && role.roleKey === 'system_admin',
    ) ?? false;
  const policies = new Map<string, CustomFieldAccessPolicy>();
  if (systemAdmin) {
    for (const field of definitions)
      policies.set(field.fieldKey, { canRead: true, canWrite: true });
  } else {
    for (const grant of grants) {
      const current = policies.get(grant.FieldKey) ?? {
        canRead: false,
        canWrite: false,
      };
      current.canRead ||= grant.CanRead;
      current.canWrite ||= grant.CanWrite;
      policies.set(grant.FieldKey, current);
    }
  }
  return {
    groups: groups.map((group) => ({
      entityType: group.EntityType,
      groupKey: group.GroupKey,
      label: group.Label,
      sortOrder: group.SortOrder,
      visibilityRule: group.VisibilityRule,
      status: group.Status as 'active' | 'disabled',
      createTime: group.CreateTime,
      updateTime: group.UpdateTime,
      fields: group.Definitions.map((field) => ({
        fieldDefinitionId: field.FieldDefinitionId,
        entityType: field.EntityType,
        fieldKey: field.FieldKey,
        label: field.Label,
        dataType: field.DataType,
        groupKey: field.GroupKey,
        sortOrder: field.SortOrder,
        required: field.Required,
        defaultValue: field.DefaultValue,
        optionsDictType: field.OptionsDictType,
        validation: field.Validation as CustomFieldValidationRules | null,
        searchable: field.Searchable,
        filterable: field.Filterable,
        sortable: field.Sortable,
        isPublic: field.IsPublic,
        status: field.Status as 'draft' | 'active' | 'disabled',
        schemaVersion: field.SchemaVersion,
        createTime: field.CreateTime,
        updateTime: field.UpdateTime,
      })),
    })),
    policies,
  };
}
function toWriteData(
  data: AdminResortValues,
): Prisma.SkiResortUncheckedCreateInput {
  return {
    Name: data.name,
    MerchantId: data.merchantId,
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
    Rating: data.rating == null ? data.rating : new Prisma.Decimal(data.rating),
    RatingCount: data.ratingCount,
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
function toRecord(row: ResortRow): AdminResortRecord {
  return {
    name: row.Name,
    merchantId: row.MerchantId,
    province: row.Province,
    city: row.City,
    district: row.District,
    address: row.Address,
    longitude: row.Longitude?.toString() ?? null,
    latitude: row.Latitude?.toString() ?? null,
    coverAssetId: row.CoverAssetId?.toString() ?? null,
    price: row.Price,
    rating: row.Rating?.toString() ?? null,
    ratingCount: row.RatingCount,
    openStatus: row.OpenStatus,
    snowCondition: row.SnowCondition,
    openingHours: row.OpeningHours,
    trailSummary: row.TrailSummary,
    facilitySummary: row.FacilitySummary,
    officialUrl: row.OfficialUrl,
    description: row.Description,
    customFields: row.CustomFields,
    resortId: row.ResortId,
    status: row.Status as AdminResortRecord['status'],
    snowConditionUpdatedAt: row.SnowConditionUpdatedAt,
    merchantName: row.Merchant?.BusinessName ?? null,
    coverStorageKey: row.CoverAsset?.StorageKey ?? null,
    gallery: row.Gallery.map((item) => ({
      assetId: item.AssetId.toString(),
      sortOrder: item.SortOrder,
      storageKey: item.Asset.StorageKey,
    })),
    fitTags: row.FitTags.map(({ Item }) => ({
      value: Item.Value,
      label: Item.Label,
    })),
    updatedAt: row.UpdateTime,
  };
}
