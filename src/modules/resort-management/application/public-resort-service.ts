import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ASSET_STORAGE,
  type AssetStorage,
} from '../../assets/application/ports/asset-storage.js';
import {
  CUSTOM_FIELD_REPOSITORY,
  type CustomFieldRepository,
} from '../../platform-administration/application/ports/custom-field-repository.js';
import { filterReadableCustomFields } from '../../platform-administration/domain/custom-field-validation.js';
import {
  normalizePublicResortQuery,
  type PublicResortQuery,
} from '../domain/public-resort-query.js';
import {
  PUBLIC_RESORT_READER,
  type PublicResortReader,
} from './ports/public-resort-reader.js';
import type { PublicResortRecord } from './public-resort-models.js';
@Injectable()
export class PublicResortService {
  constructor(
    @Inject(PUBLIC_RESORT_READER) private readonly resorts: PublicResortReader,
    @Inject(ASSET_STORAGE) private readonly storage: AssetStorage,
    @Inject(CUSTOM_FIELD_REPOSITORY)
    private readonly customFields: CustomFieldRepository,
  ) {}
  async fitTags() {
    return this.resorts.findPublicFitTags();
  }
  async list(input: PublicResortQuery, userId?: number) {
    let query: ReturnType<typeof normalizePublicResortQuery>;
    try {
      query = normalizePublicResortQuery(input);
    } catch (error) {
      if (error instanceof RangeError)
        throw new BadRequestException(error.message);
      throw error;
    }
    const { items, total } = await this.resorts.findPage(query, userId);
    const { definitions, policies } = await this.publicFields();
    return {
      items: await Promise.all(
        items.map((item) => this.toCard(item, policies, definitions)),
      ),
      page: query.page,
      pageSize: query.pageSize,
      total,
      hasNext: query.skip + items.length < total,
    };
  }
  async get(resortId: number, userId?: number) {
    if (
      !Number.isSafeInteger(resortId) ||
      resortId < 1 ||
      resortId > 2147483647
    )
      throw new BadRequestException('Invalid resort ID');
    const record = await this.resorts.find(resortId, userId);
    if (!record) throw new NotFoundException('Resort not found');
    const { definitions, policies } = await this.publicFields();
    return this.toCard(record, policies, definitions, true);
  }
  private async publicFields() {
    const schema = await this.customFields.findActiveSchema('ski_resort');
    const definitions = schema
      .flatMap((group) => group.fields)
      .filter((field) => field.isPublic)
      .map((field) => ({ ...field, dataType: field.dataType as never }));
    const policies = new Map(
      definitions.map((field) => [
        field.fieldKey,
        { canRead: true, canWrite: false },
      ]),
    );
    return { definitions, policies };
  }
  private async toCard(
    resort: PublicResortRecord,
    policies: ReadonlyMap<string, { canRead: boolean; canWrite: boolean }>,
    publicDefinitions: Awaited<
      ReturnType<CustomFieldRepository['findActiveSchema']>
    >[number]['fields'],
    detail = false,
  ) {
    const coverUrl = resort.coverStorageKey
      ? await this.storage.createReadUrl(resort.coverStorageKey, 900)
      : null;
    const definitions = publicDefinitions
      .filter((field) => field.isPublic)
      .map((field) => ({ ...field, dataType: field.dataType as never }));
    const values = filterReadableCustomFields({
      definitions,
      policies,
      values: resort.customFields,
    });
    const customFields = definitions.flatMap((field) =>
      Object.hasOwn(values, field.fieldKey)
        ? [
            {
              fieldKey: field.fieldKey,
              label: field.label,
              value: values[field.fieldKey],
            },
          ]
        : [],
    );
    return {
      resortId: resort.resortId,
      name: resort.name,
      region: {
        province: resort.province ?? '',
        city: resort.city ?? '',
        district: resort.district,
      },
      coverUrl,
      rating: resort.rating === null ? null : Number(resort.rating),
      ratingCount: resort.ratingCount,
      distanceMeters: resort.distanceMeters,
      startingPrice: String(resort.price),
      fitTags: resort.fitTags,
      openStatus: resort.openStatus,
      favoriteByMe: resort.favoriteByMe,
      customFields,
      ...(detail
        ? {
            address: resort.address,
            longitude:
              resort.longitude === null ? null : Number(resort.longitude),
            latitude: resort.latitude === null ? null : Number(resort.latitude),
            description: resort.description,
            galleryUrls: await Promise.all(
              resort.galleryStorageKeys.map((storageKey) =>
                this.storage.createReadUrl(storageKey, 900),
              ),
            ),
            snowCondition: {
              value: resort.snowCondition,
              label: resort.snowCondition,
              verifiedAt: resort.snowConditionUpdatedAt?.toISOString() ?? null,
            },
            openingHours: resort.openingHours,
            trailSummary: resort.trailSummary,
            facilitySummary: resort.facilitySummary,
            officialUrl: resort.officialUrl,
            updatedAt: resort.updatedAt.toISOString(),
          }
        : {}),
    };
  }
}
