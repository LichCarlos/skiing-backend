import { describe, expect, it, vi } from 'vitest';
import { PublicResortService } from './public-resort-service.js';
import type { PublicResortReader } from './ports/public-resort-reader.js';
import type { AssetStorage } from '../../assets/application/ports/asset-storage.js';
import type { CustomFieldRepository } from '../../platform-administration/application/ports/custom-field-repository.js';
import type { PublicResortQuery } from '../domain/public-resort-query.js';

const resort = (id: number, longitude: number | null = 116.4) => ({
  resortId: id,
  name: `雪场 ${id}`,
  province: '吉林省',
  city: '吉林市',
  district: null,
  address: null,
  longitude: longitude === null ? null : String(longitude),
  latitude: longitude === null ? null : '43.8',
  rating: '4.5',
  ratingCount: 20,
  price: 520,
  openStatus: 'open',
  snowCondition: '粉雪',
  snowConditionUpdatedAt: null,
  openingHours: null,
  trailSummary: null,
  facilitySummary: null,
  officialUrl: null,
  description: '公开介绍',
  customFields: { publicField: '展示', internalField: '不可公开' },
  updatedAt: new Date('2026-10-27T00:00:00.000Z'),
  fitTags: [{ value: 'beginner', label: '新手友好' }],
  coverStorageKey: null,
  galleryStorageKeys: [],
  distanceMeters: 0,
  favoriteByMe: false,
});

function setup(records = [resort(1)]) {
  const reader = {
    findPublicFitTags: vi.fn(async () => []),
    findPage: vi.fn(async () => ({ items: records, total: records.length })),
    find: vi.fn(async () => records[0] ?? null),
  };
  const storage = { createReadUrl: vi.fn() };
  const customFields = {
    findActiveSchema: vi.fn().mockResolvedValue([
      {
        entityType: 'ski_resort',
        groupKey: 'public',
        label: '公开信息',
        sortOrder: 0,
        visibilityRule: null,
        status: 'active',
        createTime: new Date(0),
        updateTime: new Date(0),
        fields: [
          {
            fieldDefinitionId: 1,
            entityType: 'ski_resort',
            fieldKey: 'publicField',
            label: '公开字段',
            dataType: 'text',
            groupKey: 'public',
            sortOrder: 0,
            required: false,
            defaultValue: null,
            optionsDictType: null,
            validation: null,
            searchable: false,
            filterable: false,
            sortable: false,
            isPublic: true,
            status: 'active',
            schemaVersion: 1,
            createTime: new Date(0),
            updateTime: new Date(0),
          },
          {
            fieldDefinitionId: 2,
            entityType: 'ski_resort',
            fieldKey: 'internalField',
            label: '内部字段',
            dataType: 'text',
            groupKey: 'public',
            sortOrder: 1,
            required: false,
            defaultValue: null,
            optionsDictType: null,
            validation: null,
            searchable: false,
            filterable: false,
            sortable: false,
            isPublic: false,
            status: 'active',
            schemaVersion: 1,
            createTime: new Date(0),
            updateTime: new Date(0),
          },
        ],
      },
    ]),
  };
  return {
    service: new PublicResortService(
      reader as PublicResortReader,
      storage as unknown as AssetStorage,
      customFields as unknown as CustomFieldRepository,
    ),
    reader,
  };
}

describe('PublicResortService', () => {
  it('delegates the public fit-tag directory read', async () => {
    const { service, reader } = setup();
    await expect(service.fitTags()).resolves.toEqual([]);
    expect(reader.findPublicFitTags).toHaveBeenCalledOnce();
  });

  it.each([0, -1, 1.5, 2147483648, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid public detail ID %s before repository access',
    async (id) => {
      const { service, reader } = setup();
      await expect(service.get(id)).rejects.toMatchObject({ status: 400 });
      expect(reader.find).not.toHaveBeenCalled();
    },
  );
  it('delegates normalized tags and distance sorting, and hides private fields in the projection', async () => {
    const { service, reader } = setup();
    const query = {
      page: 1,
      pageSize: 20,
      fitTags: ['beginner', 'family'],
      latitude: 43.8,
      longitude: 116.4,
      sortBy: 'distance',
      sortOrder: 'asc',
    } as PublicResortQuery;

    const result = await service.list(query);

    expect(reader.findPage).toHaveBeenCalledWith(
      expect.objectContaining({
        fitTags: ['beginner', 'family'],
        sortBy: 'distance',
      }),
      undefined,
    );
    expect(result.items[0]).toMatchObject({
      distanceMeters: 0,
      favoriteByMe: false,
      customFields: [
        { fieldKey: 'publicField', label: '公开字段', value: '展示' },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('不可公开');
  });

  it('rejects half-specified coordinates and distance sort without coordinates', async () => {
    const { service, reader } = setup();

    await expect(
      service.list({
        page: 1,
        pageSize: 20,
        latitude: 43.8,
      } as PublicResortQuery),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.list({
        page: 1,
        pageSize: 20,
        sortBy: 'distance',
      } as PublicResortQuery),
    ).rejects.toMatchObject({ status: 400 });
    expect(reader.findPage).not.toHaveBeenCalled();
  });

  it('returns not found for unpublished and deleted resorts', async () => {
    const { service } = setup([]);
    await expect(service.get(9)).rejects.toMatchObject({ status: 404 });
  });
});
