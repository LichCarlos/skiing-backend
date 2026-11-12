import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  ASSET_STORAGE,
  type AssetStorage,
} from '../../assets/application/ports/asset-storage.js';
import {
  CUSTOM_FIELD_REPOSITORY,
  type CustomFieldRepository,
} from '../../platform-administration/application/ports/custom-field-repository.js';
import {
  filterReadableCustomFields,
  validateCustomFieldWrite,
  type CustomFieldDataType,
} from '../../platform-administration/domain/custom-field-validation.js';
import {
  canSubmitMerchantResortForReview,
  getMerchantResortStatusAfterUpdate,
  parseMerchantResortPage,
  isResortAssetId,
  resolveMerchantFieldPolicies,
} from '../domain/merchant-resort.js';
import {
  permitsMerchantResortAccess,
  type MerchantResortAccess,
} from '../domain/resort-management-scope.js';
import {
  MERCHANT_RESORT_REPOSITORY,
  type MerchantResortRepository,
  type MerchantResortTransaction,
} from './ports/merchant-resort-repository.js';
import type {
  MerchantResortInput,
  MerchantResortAuditContext,
  MerchantResortValues,
  MerchantResortRecord,
  ResortRelations,
} from './merchant-resort-models.js';
export type {
  MerchantResortInput,
  MerchantResortAuditContext,
} from './merchant-resort-models.js';

@Injectable()
export class MerchantResortService {
  constructor(
    @Inject(MERCHANT_RESORT_REPOSITORY)
    private readonly resorts: MerchantResortRepository,
    @Inject(ASSET_STORAGE) private readonly storage: AssetStorage,
    @Inject(CUSTOM_FIELD_REPOSITORY)
    private readonly customFields: CustomFieldRepository,
  ) {}

  async list(
    input: MerchantResortAccess & {
      page?: unknown;
      pageSize?: unknown;
      status?: string;
    },
  ) {
    assertAccess(input);
    let paging: ReturnType<typeof parseMerchantResortPage>;
    try {
      paging = parseMerchantResortPage(input);
    } catch (error) {
      if (error instanceof RangeError)
        throw new BadRequestException(error.message);
      throw error;
    }
    const { items, total } = await this.resorts.findPage(input, {
      status: input.status,
      skip: paging.skip,
      take: paging.pageSize,
    });
    const policies = await this.loadFieldPolicies(input.userId);
    return {
      items: await Promise.all(items.map((item) => this.toVO(item, policies))),
      total,
      page: paging.page,
      pageSize: paging.pageSize,
      hasNext: paging.skip + items.length < total,
    };
  }
  async customFieldSchema(input: MerchantResortAccess) {
    assertAccess(input);
    await this.resorts.requireActiveActor(input);
    const [groups, policies] = await Promise.all([
      this.customFields.findActiveSchema('ski_resort'),
      this.loadFieldPolicies(input.userId),
    ]);
    return {
      entityType: 'ski_resort',
      groups: groups
        .map((group) => ({
          ...group,
          fields: group.fields.flatMap((field) => {
            const permission = policies.get(field.fieldKey);
            return permission?.canRead || permission?.canWrite
              ? [{ ...field, ...permission }]
              : [];
          }),
        }))
        .filter((group) => group.fields.length > 0),
    };
  }
  async get(input: MerchantResortAccess & { resortId: number }) {
    assertAccess(input);
    assertResortId(input.resortId);
    const resort = await this.resorts.find(input, input.resortId);
    if (!resort) throw new NotFoundException('Resort not found');
    return this.toVO(resort, await this.loadFieldPolicies(input.userId));
  }
  async create(
    input: MerchantResortAccess & { body: MerchantResortInput },
    audit: MerchantResortAuditContext,
  ) {
    assertAccess(input);
    if (input.scope?.kind === 'selected')
      throw new ForbiddenException('Selected scope cannot create resorts');
    const merchantId = input.merchantId!;
    const created = await this.resorts.runWrite(async (tx) => {
      const account = await tx.authorize(input, 'resort:merchant:create');
      const data = await this.validateWrite(input.userId, input.body, {}, tx);
      await tx.assertReferences(input.userId, relations(input.body));
      const resortId = await tx.create(merchantId, data);
      await tx.replaceRelations(resortId, relations(input.body));
      await tx.appendChanged(resortId, merchantId, 'draft');
      await tx.audit(input.userId, account, audit, {
        actionKey: 'resort:merchant:create',
        resortId,
        after: { name: data.name, merchantId, status: 'draft' },
      });
      return requireRecord(await tx.find(input, resortId));
    });
    return this.toVO(created, await this.loadFieldPolicies(input.userId));
  }
  async update(
    input: MerchantResortAccess & {
      resortId: number;
      body: MerchantResortInput;
    },
    audit: MerchantResortAuditContext,
  ) {
    assertAccess(input);
    assertResortId(input.resortId);
    const existing = requireRecord(
      await this.resorts.find(input, input.resortId),
    );
    const mergedBody: MerchantResortInput = {
      name: existing.name,
      province: existing.province,
      city: existing.city,
      district: existing.district,
      address: existing.address,
      longitude:
        existing.longitude === null ? null : Number(existing.longitude),
      latitude: existing.latitude === null ? null : Number(existing.latitude),
      coverAssetId: existing.coverAssetId,
      galleryAssetIds: existing.gallery.map((item) => item.assetId),
      fitTagValues: existing.fitTags,
      price: existing.price,
      openStatus: existing.openStatus,
      snowCondition: existing.snowCondition,
      openingHours: existing.openingHours,
      trailSummary: existing.trailSummary,
      facilitySummary: existing.facilitySummary,
      officialUrl: existing.officialUrl,
      description: existing.description,
      customFields: input.body.customFields ?? {},
      ...input.body,
    };
    const status = getMerchantResortStatusAfterUpdate(existing.status);
    const merchantId = input.merchantId!;
    const updated = await this.resorts.runWrite(async (tx) => {
      const account = await tx.authorize(input, 'resort:merchant:update');
      const data = await this.validateWrite(
        input.userId,
        mergedBody,
        existing.customFields,
        tx,
      );
      await tx.assertReferences(input.userId, relations(mergedBody));
      await updateOrConflict(tx, input, existing.updatedAt, {
        values: data,
        status,
      });
      await tx.replaceRelations(input.resortId, relations(input.body, false));
      await tx.appendChanged(input.resortId, merchantId, status);
      await tx.audit(input.userId, account, audit, {
        actionKey: 'resort:merchant:update',
        resortId: input.resortId,
        before: { name: existing.name, merchantId, status: existing.status },
        after: { name: data.name, merchantId, status },
        changedFields: Object.keys(input.body).sort(),
      });
      return requireRecord(await tx.find(input, input.resortId));
    });
    return this.toVO(updated, await this.loadFieldPolicies(input.userId));
  }
  async remove(
    input: MerchantResortAccess & { resortId: number },
    audit: MerchantResortAuditContext,
  ) {
    assertAccess(input);
    assertResortId(input.resortId);
    await this.resorts.runWrite(async (tx) => {
      const account = await tx.authorize(input, 'resort:merchant:delete');
      const existing = requireRecord(await tx.find(input, input.resortId));
      await updateOrConflict(tx, input, existing.updatedAt, {
        deletedAt: new Date(),
      });
      await tx.appendChanged(input.resortId, input.merchantId!, 'deleted');
      await tx.audit(input.userId, account, audit, {
        actionKey: 'resort:merchant:delete',
        resortId: input.resortId,
        before: {
          name: existing.name,
          merchantId: input.merchantId!,
          status: existing.status,
        },
        after: { deleted: true },
      });
    });
  }
  async submitReview(
    input: MerchantResortAccess & { resortId: number },
    audit: MerchantResortAuditContext,
  ) {
    assertAccess(input);
    assertResortId(input.resortId);
    const existing = requireRecord(
      await this.resorts.find(input, input.resortId),
    );
    if (!canSubmitMerchantResortForReview(existing.status))
      throw new ConflictException(
        'Resort cannot be submitted from its current status',
      );
    const updated = await this.resorts.runWrite(async (tx) => {
      const account = await tx.authorize(
        input,
        'resort:merchant:submit-review',
      );
      await updateOrConflict(tx, input, existing.updatedAt, {
        status: 'pending_review',
      });
      await tx.appendChanged(
        input.resortId,
        input.merchantId!,
        'pending_review',
      );
      await tx.audit(input.userId, account, audit, {
        actionKey: 'resort:merchant:submit-review',
        resortId: input.resortId,
        before: {
          name: existing.name,
          merchantId: input.merchantId!,
          status: existing.status,
        },
        after: {
          name: existing.name,
          merchantId: input.merchantId!,
          status: 'pending_review',
        },
      });
      return requireRecord(await tx.find(input, input.resortId));
    });
    return this.toVO(updated, await this.loadFieldPolicies(input.userId));
  }
  private async loadFieldPolicies(userId: number) {
    return resolveMerchantFieldPolicies(await this.resorts.fieldGrants(userId));
  }
  private async validateWrite(
    userId: number,
    body: MerchantResortInput,
    existingFields: unknown,
    transaction: MerchantResortTransaction,
  ): Promise<MerchantResortValues> {
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new UnprocessableEntityException('Request body must be an object');
    const allowed = new Set([
      'name',
      'province',
      'city',
      'district',
      'address',
      'longitude',
      'latitude',
      'coverAssetId',
      'galleryAssetIds',
      'fitTagValues',
      'price',
      'openStatus',
      'snowCondition',
      'openingHours',
      'trailSummary',
      'facilitySummary',
      'officialUrl',
      'description',
      'customFields',
    ]);
    const extra = Object.keys(body).filter((key) => !allowed.has(key));
    if (extra.length)
      throw new UnprocessableEntityException(
        `Unsupported fields: ${extra.join(', ')}`,
      );
    const { policies, definitions, dictionaryValues } =
      await transaction.fieldContext(userId);
    const fieldResult = validateCustomFieldWrite({
      definitions,
      policies,
      dictionaryValues,
      existingValues: isRecord(existingFields) ? existingFields : {},
      submittedValues: body.customFields ?? {},
    });
    if (!fieldResult.ok)
      throw new UnprocessableEntityException({
        message: 'Invalid custom fields',
        details: fieldResult.issues,
      });
    const value = (key: keyof MerchantResortInput) => body[key];
    const name = value('name');
    const price = value('price');
    const openStatus = value('openStatus');
    const snowCondition = value('snowCondition');
    const description = value('description');
    if (
      typeof name !== 'string' ||
      !name.trim() ||
      name.length > 100 ||
      !Number.isSafeInteger(price) ||
      (price as number) < 0 ||
      !['open', 'closed', 'limited', 'unknown'].includes(String(openStatus)) ||
      typeof snowCondition !== 'string' ||
      !snowCondition.trim() ||
      typeof description !== 'string' ||
      !description.trim() ||
      description.length > 1000
    )
      throw new UnprocessableEntityException('Invalid required resort fields');
    const gallery = body.galleryAssetIds ?? [];
    const tags = body.fitTagValues ?? [];
    if (
      !Array.isArray(gallery) ||
      gallery.length > 30 ||
      !gallery.every(isResortAssetId) ||
      new Set(gallery).size !== gallery.length
    )
      throw new UnprocessableEntityException('Invalid galleryAssetIds');
    if (
      !Array.isArray(tags) ||
      !tags.every((tag) => typeof tag === 'string') ||
      new Set(tags).size !== tags.length
    )
      throw new UnprocessableEntityException('Invalid fitTagValues');
    if (
      body.coverAssetId !== undefined &&
      body.coverAssetId !== null &&
      !isResortAssetId(body.coverAssetId)
    )
      throw new UnprocessableEntityException('Invalid coverAssetId');
    const optionalString = (key: keyof MerchantResortInput, max: number) => {
      const v = value(key);
      if (v === undefined || v === null) return v;
      if (typeof v !== 'string' || v.length > max)
        throw new UnprocessableEntityException(`Invalid ${String(key)}`);
      return v.trim();
    };
    const coordinate = (
      key: 'longitude' | 'latitude',
      min: number,
      max: number,
    ) => {
      const v = value(key);
      if (v === undefined || v === null) return v;
      if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max)
        throw new UnprocessableEntityException(`Invalid ${key}`);
      return v;
    };
    return {
      name: name.trim(),
      province: optionalString('province', 50),
      city: optionalString('city', 50),
      district: optionalString('district', 50),
      address: optionalString('address', 300),
      longitude: coordinate('longitude', -180, 180),
      latitude: coordinate('latitude', -90, 90),
      coverAssetId:
        body.coverAssetId == null ? null : (body.coverAssetId as string),
      price: price as number,
      openStatus: openStatus as string,
      snowCondition: (snowCondition as string).trim(),
      openingHours: optionalString('openingHours', 200),
      trailSummary: optionalString('trailSummary', 10000),
      facilitySummary: optionalString('facilitySummary', 10000),
      officialUrl: optionalString('officialUrl', 500),
      description: (description as string).trim(),
      customFields: fieldResult.values,
    };
  }

  private async toVO(
    resort: MerchantResortRecord,
    policies: ReadonlyMap<string, { canRead: boolean; canWrite: boolean }>,
  ) {
    const [coverUrl, gallery] = await Promise.all([
      resort.coverStorageKey
        ? this.storage.createReadUrl(resort.coverStorageKey, 900)
        : Promise.resolve(null),
      Promise.all(
        resort.gallery.map(async (image) => ({
          assetId: image.assetId,
          sortOrder: image.sortOrder,
          url: await this.storage.createReadUrl(image.storageKey, 900),
        })),
      ),
    ]);
    const schema = await this.customFields.findActiveSchema('ski_resort');
    const definitions = schema
      .flatMap((group) => group.fields)
      .map((field) => ({
        ...field,
        dataType: field.dataType as CustomFieldDataType,
      }));
    return {
      resortId: resort.resortId,
      name: resort.name,
      province: resort.province,
      city: resort.city,
      district: resort.district,
      address: resort.address,
      longitude: resort.longitude?.toString() ?? null,
      latitude: resort.latitude?.toString() ?? null,
      coverAssetId: resort.coverAssetId?.toString() ?? null,
      coverUrl,
      gallery,
      rating: resort.rating?.toString() ?? null,
      ratingCount: resort.ratingCount,
      fitTags: resort.fitTags,
      price: resort.price,
      openStatus: resort.openStatus,
      snowCondition: resort.snowCondition,
      snowConditionUpdatedAt:
        resort.snowConditionUpdatedAt?.toISOString() ?? null,
      openingHours: resort.openingHours,
      trailSummary: resort.trailSummary,
      facilitySummary: resort.facilitySummary,
      officialUrl: resort.officialUrl,
      description: resort.description,
      customFields: filterReadableCustomFields({
        definitions,
        policies,
        values: resort.customFields,
      }),
      status: resort.status,
      updatedAt: resort.updatedAt.toISOString(),
    };
  }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function assertAccess(access: MerchantResortAccess) {
  if (!permitsMerchantResortAccess(access))
    throw new ForbiddenException('A valid merchant resort scope is required');
}
function assertResortId(id: number) {
  if (!Number.isSafeInteger(id) || id < 1 || id > 2_147_483_647)
    throw new BadRequestException('Invalid resort ID');
}
function requireRecord(
  record: MerchantResortRecord | null,
): MerchantResortRecord {
  if (!record) throw new NotFoundException('Resort not found');
  return record;
}
function relations(
  body: MerchantResortInput,
  includeCover = true,
): ResortRelations {
  return {
    ...(includeCover && body.coverAssetId !== undefined
      ? { coverAssetId: body.coverAssetId as string | null }
      : {}),
    ...(body.galleryAssetIds !== undefined
      ? { galleryAssetIds: body.galleryAssetIds as string[] }
      : {}),
    ...(body.fitTagValues !== undefined
      ? { fitTagValues: body.fitTagValues as string[] }
      : {}),
  };
}
async function updateOrConflict(
  tx: MerchantResortTransaction,
  input: MerchantResortAccess & { resortId: number },
  expected: Date,
  change: Parameters<MerchantResortTransaction['update']>[3],
) {
  if (!(await tx.update(input, input.resortId, expected, change)))
    throw new ConflictException('Resort changed concurrently');
}
