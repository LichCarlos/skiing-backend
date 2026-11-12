import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Inject,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  ASSET_STORAGE,
  type AssetStorage,
} from '../../assets/application/ports/asset-storage.js';
import { validateCustomFieldWrite } from '../../platform-administration/domain/custom-field-validation.js';
import {
  isResortAssetId,
  parseMerchantResortPage,
} from '../domain/merchant-resort.js';
import type { ResolvedDataScope } from '../../identity-access/domain/authorization.js';
import { permitsGlobalResortManagement } from '../domain/resort-management-scope.js';
import { canAdminTransitionResort } from '../domain/resort-lifecycle.js';
import {
  ADMIN_RESORT_REPOSITORY,
  type AdminResortRepository,
  type AdminResortTransaction,
} from './ports/admin-resort-repository.js';
import type {
  AdminResortInput,
  AdminResortRecord,
  AdminResortValues,
  AdminResortAuditContext,
} from './admin-resort-models.js';
import type { ResortRelations } from './merchant-resort-models.js';
export type {
  AdminResortInput,
  AdminResortAuditContext,
} from './admin-resort-models.js';
@Injectable()
export class AdminResortService {
  constructor(
    @Inject(ADMIN_RESORT_REPOSITORY)
    private readonly resorts: AdminResortRepository,
    @Inject(ASSET_STORAGE) private readonly storage: AssetStorage,
  ) {}
  async list(
    input: {
      page?: unknown;
      pageSize?: unknown;
      keyword?: unknown;
      status?: unknown;
      merchantId?: unknown;
    },
    scope: ResolvedDataScope | undefined,
    actorUserId: number,
  ) {
    assertGlobalScope(scope);
    let paging: ReturnType<typeof parseMerchantResortPage>;
    try {
      paging = parseMerchantResortPage(input);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid pagination',
      );
    }
    const { items, total } = await this.resorts.findPage({
      merchantId: parseOptionalPositiveInt(input.merchantId, 'merchantId'),
      status: parseOptionalString(input.status, 20),
      keyword: parseOptionalString(input.keyword, 100),
      skip: paging.skip,
      take: paging.pageSize,
    });
    const fieldSchema = await this.resorts.findCustomFieldSchema(actorUserId);
    return {
      items: await Promise.all(
        items.map((item) => this.toVO(item, fieldSchema)),
      ),
      total,
      page: paging.page,
      pageSize: paging.pageSize,
      hasNext: paging.skip + items.length < total,
    };
  }
  async get(
    resortId: number,
    scope: ResolvedDataScope | undefined,
    actorUserId: number,
  ) {
    assertGlobalScope(scope);
    assertResortId(resortId);
    const [record, fieldSchema] = await Promise.all([
      this.resorts.find(resortId),
      this.resorts.findCustomFieldSchema(actorUserId),
    ]);
    return this.toVO(requireRecord(record), fieldSchema);
  }
  async customFieldSchema(
    actorUserId: number,
    scope: ResolvedDataScope | undefined,
  ) {
    assertGlobalScope(scope);
    const schema = await this.resorts.findCustomFieldSchema(actorUserId);
    return {
      entityType: 'ski_resort',
      groups: schema.groups
        .map((group) => ({
          ...group,
          fields: group.fields.flatMap((field) => {
            const access = schema.policies.get(field.fieldKey) ?? {
              canRead: false,
              canWrite: false,
            };
            return access.canRead || access.canWrite
              ? [{ ...field, ...access }]
              : [];
          }),
        }))
        .filter((group) => group.fields.length > 0),
    };
  }
  async create(
    body: AdminResortInput,
    audit: AdminResortAuditContext,
    scope: ResolvedDataScope | undefined,
  ) {
    assertGlobalScope(scope);
    const created = await this.resorts.runWrite(async (tx) => {
      await tx.authorize(audit.actorUserId, 'content:resort:create-all');
      const values = await this.validateWrite(audit.actorUserId, body, {}, tx);
      await tx.assertReferences(
        audit.actorUserId,
        values.merchantId,
        relations(body),
      );
      const resortId = await tx.create(values);
      await tx.replaceRelations(resortId, relations(body));
      await tx.appendChanged(resortId, values.merchantId, 'draft');
      const result = requireRecord(await tx.find(resortId));
      await tx.audit(audit, {
        actionKey: 'content:resort:create-all',
        resortId,
        metadata: {
          after: {
            name: result.name,
            merchantId: result.merchantId,
            status: result.status,
          },
        },
      });
      return result;
    });
    return this.toVO(
      created,
      await this.resorts.findCustomFieldSchema(audit.actorUserId),
    );
  }
  async update(
    resortId: number,
    body: AdminResortInput,
    audit: AdminResortAuditContext,
    scope: ResolvedDataScope | undefined,
  ) {
    assertGlobalScope(scope);
    assertResortId(resortId);
    const existing = requireRecord(await this.resorts.find(resortId));
    const merged: AdminResortInput = {
      name: existing.name,
      merchantId: existing.merchantId,
      province: existing.province,
      city: existing.city,
      district: existing.district,
      address: existing.address,
      longitude:
        existing.longitude === null ? null : Number(existing.longitude),
      latitude: existing.latitude === null ? null : Number(existing.latitude),
      coverAssetId: existing.coverAssetId,
      galleryAssetIds: existing.gallery.map((item) => item.assetId),
      fitTagValues: existing.fitTags.map((item) => item.value),
      rating: existing.rating === null ? null : Number(existing.rating),
      ratingCount: existing.ratingCount,
      price: existing.price,
      openStatus: existing.openStatus,
      snowCondition: existing.snowCondition,
      openingHours: existing.openingHours,
      trailSummary: existing.trailSummary,
      facilitySummary: existing.facilitySummary,
      officialUrl: existing.officialUrl,
      description: existing.description,
      customFields: {},
      ...body,
    };
    const updated = await this.resorts.runWrite(async (tx) => {
      await tx.authorize(audit.actorUserId, 'content:resort:update-all');
      const values = await this.validateWrite(
        audit.actorUserId,
        merged,
        existing.customFields,
        tx,
      );
      await tx.assertReferences(
        audit.actorUserId,
        values.merchantId,
        relations(merged),
        {
          requireAssetAssociationPermission:
            Boolean(body.coverAssetId) ||
            (Array.isArray(body.galleryAssetIds) &&
              body.galleryAssetIds.length > 0),
        },
      );
      await updateOrConflict(tx, resortId, existing.updatedAt, { values });
      await tx.replaceRelations(resortId, relations(merged));
      await tx.appendChanged(resortId, values.merchantId, existing.status);
      const result = requireRecord(await tx.find(resortId));
      await tx.audit(audit, {
        actionKey: 'content:resort:update-all',
        resortId,
        metadata: {
          before: {
            name: existing.name,
            merchantId: existing.merchantId,
            status: existing.status,
          },
          after: {
            name: result.name,
            merchantId: result.merchantId,
            status: result.status,
          },
          changedFields: Object.keys(body).sort(),
        },
      });
      return result;
    });
    return this.toVO(
      updated,
      await this.resorts.findCustomFieldSchema(audit.actorUserId),
    );
  }
  async remove(
    resortId: number,
    audit: AdminResortAuditContext,
    scope: ResolvedDataScope | undefined,
  ) {
    assertGlobalScope(scope);
    assertResortId(resortId);
    await this.resorts.runWrite(async (tx) => {
      await tx.authorize(audit.actorUserId, 'content:resort:delete-all');
      const existing = requireRecord(await tx.find(resortId));
      await updateOrConflict(tx, resortId, existing.updatedAt, {
        deletedAt: new Date(),
      });
      await tx.appendChanged(resortId, existing.merchantId, 'deleted');
      await tx.audit(audit, {
        actionKey: 'content:resort:delete-all',
        resortId,
        metadata: {
          before: {
            name: existing.name,
            merchantId: existing.merchantId,
            status: existing.status,
          },
          after: { deleted: true },
        },
      });
    });
  }
  async publish(
    resortId: number,
    audit: AdminResortAuditContext,
    scope: ResolvedDataScope | undefined,
    reason?: string,
  ) {
    assertGlobalScope(scope);
    return this.transition(
      resortId,
      'published',
      'content:resort:publish',
      audit,
      reason,
    );
  }
  async offline(
    resortId: number,
    audit: AdminResortAuditContext,
    scope: ResolvedDataScope | undefined,
    reason?: string,
  ) {
    assertGlobalScope(scope);
    return this.transition(
      resortId,
      'offline',
      'content:resort:offline',
      audit,
      reason,
    );
  }
  private async transition(
    resortId: number,
    to: 'published' | 'offline',
    actionKey: string,
    audit: AdminResortAuditContext,
    reason?: string,
  ) {
    assertResortId(resortId);
    if (
      reason !== undefined &&
      (typeof reason !== 'string' ||
        !reason.trim() ||
        Array.from(reason.trim()).length > 500)
    )
      throw new BadRequestException('Invalid reason');
    const updated = await this.resorts.runWrite(async (tx) => {
      await tx.authorize(audit.actorUserId, actionKey);
      const existing = await tx.find(resortId);
      if (!existing || !canAdminTransitionResort(existing.status, to))
        throw new ConflictException(`Resort cannot transition to ${to}`);
      await updateOrConflict(tx, resortId, existing.updatedAt, { status: to });
      await tx.appendChanged(resortId, existing.merchantId, to);
      const result = requireRecord(await tx.find(resortId));
      await tx.audit(audit, {
        actionKey,
        reason: reason?.trim() ?? null,
        resortId,
        metadata: {
          before: { name: existing.name, status: existing.status },
          after: { name: result.name, status: result.status },
        },
      });
      return result;
    });
    return this.toVO(
      updated,
      await this.resorts.findCustomFieldSchema(audit.actorUserId),
    );
  }
  private async validateWrite(
    actorUserId: number,
    body: AdminResortInput,
    existingFields: unknown,
    transaction: AdminResortTransaction,
  ): Promise<AdminResortValues> {
    const name = requiredString(body.name, 'name', 100);
    const snowCondition = requiredString(
      body.snowCondition,
      'snowCondition',
      50,
    );
    const description = requiredString(body.description, 'description', 1000);
    const price = integer(body.price, 'price', 0);
    const rating =
      body.rating === null || body.rating === undefined
        ? null
        : decimal(body.rating, 'rating', 0, 5);
    const ratingCount = integer(body.ratingCount ?? 0, 'ratingCount', 0);
    const openStatus =
      body.openStatus === undefined || body.openStatus === null
        ? 'unknown'
        : typeof body.openStatus === 'string'
          ? body.openStatus
          : '';
    if (!['open', 'closed', 'limited', 'unknown'].includes(openStatus))
      throw new UnprocessableEntityException('Invalid openStatus');
    const { definitions, dictionaryValues, policies } =
      await transaction.fieldContext(actorUserId);
    const fields = validateCustomFieldWrite({
      definitions,
      policies,
      dictionaryValues,
      existingValues: isRecord(existingFields) ? existingFields : {},
      submittedValues: body.customFields ?? {},
    });
    if (!fields.ok)
      throw new UnprocessableEntityException({
        message: 'Invalid custom fields',
        details: fields.issues,
      });
    const assets = await this.parseAssets(body);
    this.parseTags(body.fitTagValues);
    return {
      name: name,
      merchantId: parseOptionalPositiveInt(body.merchantId, 'merchantId'),
      province: optionalString(body.province, 'province', 50),
      city: optionalString(body.city, 'city', 50),
      district: optionalString(body.district, 'district', 50),
      address: optionalString(body.address, 'address', 300),
      longitude: coordinate(body.longitude, 'longitude', -180, 180),
      latitude: coordinate(body.latitude, 'latitude', -90, 90),
      coverAssetId: assets.coverAssetId,
      price: price,
      rating: rating,
      ratingCount: ratingCount,
      openStatus: openStatus,
      snowCondition: snowCondition,
      openingHours: optionalString(body.openingHours, 'openingHours', 200),
      trailSummary: optionalString(body.trailSummary, 'trailSummary', 10000),
      facilitySummary: optionalString(
        body.facilitySummary,
        'facilitySummary',
        10000,
      ),
      officialUrl: optionalString(body.officialUrl, 'officialUrl', 500),
      description: description,
      customFields: fields.values,
    };
  }

  private async parseAssets(body: AdminResortInput) {
    const cover = body.coverAssetId;
    if (cover !== undefined && cover !== null && !isResortAssetId(cover))
      throw new UnprocessableEntityException('Invalid coverAssetId');
    const gallery = body.galleryAssetIds ?? [];
    if (
      !Array.isArray(gallery) ||
      gallery.length > 30 ||
      !gallery.every(isResortAssetId) ||
      new Set(gallery).size !== gallery.length
    )
      throw new UnprocessableEntityException('Invalid galleryAssetIds');
    return {
      coverAssetId: cover == null ? null : String(cover),
      galleryAssetIds: gallery.map(String),
    };
  }

  private parseTags(value: unknown): string[] {
    const tags = value ?? [];
    if (
      !Array.isArray(tags) ||
      !tags.every((item) => typeof item === 'string') ||
      new Set(tags).size !== tags.length
    )
      throw new UnprocessableEntityException('Invalid fitTagValues');
    return tags;
  }

  private async toVO(
    resort: AdminResortRecord,
    schema: Awaited<ReturnType<AdminResortRepository['findCustomFieldSchema']>>,
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
    const customFields = schema.groups
      .flatMap((group) => group.fields)
      .filter((field) => field.status === 'active')
      .filter((field) => schema.policies.get(field.fieldKey)?.canRead)
      .flatMap((field) =>
        Object.hasOwn(
          isRecord(resort.customFields) ? resort.customFields : {},
          field.fieldKey,
        )
          ? [
              {
                fieldKey: field.fieldKey,
                label: field.label,
                value: (resort.customFields as Record<string, unknown>)[
                  field.fieldKey
                ],
              },
            ]
          : [],
      );
    return {
      resortId: resort.resortId,
      merchantId: resort.merchantId,
      merchantName: resort.merchantName,
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
      customFields,
      status: resort.status,
      updatedAt: resort.updatedAt.toISOString(),
    };
  }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertGlobalScope(scope: ResolvedDataScope | undefined): void {
  if (!permitsGlobalResortManagement(scope)) {
    throw new ForbiddenException('Global resort management requires all scope');
  }
}
function assertResortId(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647)
    throw new BadRequestException('Invalid resortId');
}
function parseOptionalString(value: unknown, max: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.trim().length > max)
    throw new BadRequestException('Invalid query value');
  return value.trim();
}
function parseOptionalPositiveInt(value: unknown, name: string): number | null {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > 2_147_483_647)
    throw new UnprocessableEntityException(`Invalid ${name}`);
  return number;
}
function requiredString(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new UnprocessableEntityException(`Invalid ${name}`);
  return value.trim();
}
function optionalString(
  value: unknown,
  name: string,
  max: number,
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length > max)
    throw new UnprocessableEntityException(`Invalid ${name}`);
  return value.trim();
}
function integer(value: unknown, name: string, min: number): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < min ||
    (value as number) > 2_147_483_647
  )
    throw new UnprocessableEntityException(`Invalid ${name}`);
  return value as number;
}
function decimal(
  value: unknown,
  name: string,
  min: number,
  max: number,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw new UnprocessableEntityException(`Invalid ${name}`);
  return value;
}
function coordinate(
  value: unknown,
  name: string,
  min: number,
  max: number,
): number | null {
  if (value === undefined || value === null) return null;
  return decimal(value, name, min, max);
}

function requireRecord(record: AdminResortRecord | null): AdminResortRecord {
  if (!record) throw new NotFoundException('Resort not found');
  return record;
}
function relations(body: AdminResortInput): ResortRelations {
  return {
    coverAssetId:
      typeof body.coverAssetId === 'string' ? body.coverAssetId : null,
    galleryAssetIds: Array.isArray(body.galleryAssetIds)
      ? (body.galleryAssetIds as string[])
      : [],
    fitTagValues: Array.isArray(body.fitTagValues)
      ? (body.fitTagValues as string[])
      : [],
  };
}
async function updateOrConflict(
  tx: AdminResortTransaction,
  id: number,
  version: Date,
  change: Parameters<AdminResortTransaction['update']>[2],
) {
  if (!(await tx.update(id, version, change)))
    throw new ConflictException('Resort changed concurrently');
}
