import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { IdentityAccessModule } from '../src/modules/identity-access/identity-access.module.js';
import { PublicResortsController } from '../src/modules/resort-management/presentation/http/public-resorts.controller.js';
import { PublicResortService } from '../src/modules/resort-management/application/public-resort-service.js';
import { PUBLIC_RESORT_READER } from '../src/modules/resort-management/application/ports/public-resort-reader.js';
import { ASSET_STORAGE } from '../src/modules/assets/application/ports/asset-storage.js';
import { CUSTOM_FIELD_REPOSITORY } from '../src/modules/platform-administration/application/ports/custom-field-repository.js';
import { PrismaCustomFieldRepository } from '../src/modules/platform-administration/infrastructure/prisma-custom-field.repository.js';
import { configureHttp } from '../src/shared/http/configure-http.js';
import { PrismaService } from '../src/shared/persistence/prisma.service.js';
import { PrismaPublicResortReader } from '../src/modules/resort-management/infrastructure/prisma-public-resort.reader.js';
import { normalizePublicResortQuery } from '../src/modules/resort-management/domain/public-resort-query.js';

describe('Public resort SQL queries (dedicated migrated PostgreSQL)', () => {
  const prisma = new PrismaService();
  const reader = new PrismaPublicResortReader(prisma);
  const suffix = randomUUID();
  const ids: number[] = [],
    itemIds: number[] = [];
  const tags = [`a-${suffix}`, `b-${suffix}`, `inactive-${suffix}`];
  let createdType = false,
    userId: number | undefined;
  let near: number, far: number, unknown: number;
  let app: INestApplication<App>, http: App;
  beforeAll(async () => {
    if (!process.env.DATABASE_URL)
      throw new Error(
        'DATABASE_URL must explicitly identify a migrated test database',
      );
    await prisma.$connect();
    vi.stubEnv(
      'JWT_ACCESS_SECRET',
      'public-resort-validation-secret-at-least-32-characters',
    );
    const module = await Test.createTestingModule({
      imports: [IdentityAccessModule],
      controllers: [PublicResortsController],
      providers: [
        PublicResortService,
        { provide: PUBLIC_RESORT_READER, useValue: reader },
        {
          provide: CUSTOM_FIELD_REPOSITORY,
          useClass: PrismaCustomFieldRepository,
        },
        {
          provide: ASSET_STORAGE,
          useValue: {
            createReadUrl: async () => {
              throw new Error('Fixture must have no image assets');
            },
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.init();
    http = app.getHttpServer();
    const existing = await prisma.dictionaryType.findUnique({
      where: { DictType: 'resort.fit_tag' },
    });
    if (existing) expect(existing.Status).toBe('active');
    else {
      await prisma.dictionaryType.create({
        data: {
          DictType: 'resort.fit_tag',
          DictName: 'Fit tags',
          GroupKey: 'resort',
        },
      });
      createdType = true;
    }
    for (let i = 0; i < tags.length; i++) {
      const item = await prisma.dictionaryItem.create({
        data: {
          DictType: 'resort.fit_tag',
          Value: tags[i]!,
          Label: tags[i]!,
          Status: i === 2 ? 'disabled' : 'active',
        },
      });
      itemIds.push(item.ItemId);
    }
    for (const fixture of [
      {
        Name: `${suffix} A`,
        Latitude: 0,
        Longitude: 0,
        Price: 100,
        Rating: 4.5,
      },
      {
        Name: `${suffix} %' OR 1=1 --`,
        Latitude: 0,
        Longitude: 1,
        Price: 200,
        Rating: 4,
      },
      { Name: `${suffix} C`, Price: 300 },
      { Name: `${suffix} hidden`, Price: 1, Status: 'draft' },
      { Name: `${suffix} deleted`, Price: 1, DeletedAt: new Date() },
    ]) {
      const resort = await prisma.skiResort.create({
        data: {
          Status: 'published',
          SnowCondition: 'powder',
          Description: 'SQL test',
          LegacyDistance: 0,
          Province: `province-${suffix}`,
          City: `city-${suffix}`,
          District: 'district',
          OpenStatus: 'open',
          ...fixture,
        },
      });
      ids.push(resort.ResortId);
    }
    [near, far, unknown] = ids as [number, number, number];
    await prisma.resortFitTag.createMany({
      data: [
        { ResortId: near, ItemId: itemIds[0]! },
        { ResortId: near, ItemId: itemIds[1]! },
        { ResortId: far, ItemId: itemIds[0]! },
        { ResortId: unknown, ItemId: itemIds[2]! },
      ],
    });
    const user = await prisma.user.create({
      data: {
        Account: `pubtest-${suffix}`,
        PasswordHash: 'disabled',
        Nickname: 'Public SQL test',
      },
    });
    userId = user.UserId;
    await prisma.favorite.create({ data: { UserId: userId, ResortId: near } });
  });
  afterAll(async () => {
    try {
      if (userId !== undefined)
        await prisma.user.delete({ where: { UserId: userId } });
      if (ids.length)
        await prisma.skiResort.deleteMany({ where: { ResortId: { in: ids } } });
      if (itemIds.length)
        await prisma.dictionaryItem.deleteMany({
          where: { ItemId: { in: itemIds } },
        });
      if (createdType)
        await prisma.dictionaryType.delete({
          where: { DictType: 'resort.fit_tag' },
        });
    } finally {
      await app?.close();
      await prisma.$disconnect();
      vi.unstubAllEnvs();
    }
  });
  it('executes distance math and page sorting, puts missing coordinates last, and scopes favorites', async () => {
    const page = await reader.findPage(
      normalizePublicResortQuery({
        keyword: suffix,
        latitude: 0,
        longitude: 0,
        sortBy: 'distance',
        pageSize: 2,
      }),
      userId,
    );
    expect(page.total).toBe(3);
    expect(page.items.map((item) => item.resortId)).toEqual([near, far]);
    expect(page.items[0]).toMatchObject({
      distanceMeters: 0,
      favoriteByMe: true,
    });
    expect(page.items[1]!.distanceMeters).toBeGreaterThan(111_000);
    expect(page.items[1]!.distanceMeters).toBeLessThan(112_000);
    const desc = await reader.findPage(
      normalizePublicResortQuery({
        keyword: suffix,
        latitude: 0,
        longitude: 0,
        sortBy: 'distance',
        sortOrder: 'desc',
      }),
    );
    expect(desc.items.map((item) => item.resortId)).toEqual([
      far,
      near,
      unknown,
    ]);
    expect(desc.items[2]!.distanceMeters).toBeNull();
  });
  it('requires all selected active tags and ignores inactive tags', async () => {
    const result = await reader.findPage(
      normalizePublicResortQuery({
        keyword: suffix,
        fitTags: tags.slice(0, 2),
      }),
    );
    expect(result.total).toBe(1);
    expect(result.items[0]!.resortId).toBe(near);
    const inactive = await reader.findPage(
      normalizePublicResortQuery({ keyword: suffix, fitTags: [tags[2]!] }),
    );
    expect(inactive).toEqual({ total: 0, items: [] });
  });
  it('returns total for out-of-range pages and applies price/rating filters in SQL', async () => {
    await expect(
      reader.findPage(
        normalizePublicResortQuery({ keyword: suffix, page: 100, pageSize: 2 }),
      ),
    ).resolves.toEqual({ total: 3, items: [] });
    const result = await reader.findPage(
      normalizePublicResortQuery({
        keyword: suffix,
        minPrice: 150,
        maxPrice: 250,
        minRating: 4,
        sortBy: 'price',
      }),
    );
    expect(result.total).toBe(1);
    expect(result.items[0]!.resortId).toBe(far);
  });
  it('treats quotes, percent and SQL fragments as literal search text', async () => {
    const result = await reader.findPage(
      normalizePublicResortQuery({ keyword: `${suffix} %' OR 1=1 --` }),
    );
    expect(result.total).toBe(1);
    expect(result.items[0]!.resortId).toBe(far);
  });
  it('does not expose unpublished or soft-deleted details', async () => {
    await expect(reader.find(ids[3]!)).resolves.toBeNull();
    await expect(reader.find(ids[4]!)).resolves.toBeNull();
    await expect(reader.find(near, userId)).resolves.toMatchObject({
      favoriteByMe: true,
    });
  });
  it('serves combined website/app filters through real HTTP, DTO, application and SQL', async () => {
    const query = new URLSearchParams({
      keyword: suffix,
      province: `province-${suffix}`,
      city: `city-${suffix}`,
      district: 'district',
      minPrice: '100',
      maxPrice: '200',
      minRating: '4.5',
      openStatus: 'open',
      latitude: '0',
      longitude: '0',
      sortBy: 'distance',
      sortOrder: 'asc',
      page: '1',
      pageSize: '12',
    });
    query.append('fitTags', tags[0]!);
    query.append('fitTags', tags[1]!);
    const response = await request(http)
      .get(`/api/v1/resorts?${query}`)
      .expect(200);
    expect(response.body.data).toMatchObject({
      page: 1,
      pageSize: 12,
      total: 1,
      hasNext: false,
      items: [
        {
          resortId: near,
          distanceMeters: 0,
          favoriteByMe: false,
          region: { district: 'district' },
        },
      ],
    });
    expect(
      response.body.data.items[0].fitTags.map(
        (tag: { value: string }) => tag.value,
      ),
    ).toEqual(tags.slice(0, 2));
    for (const forbidden of [
      'merchantId',
      'storageKey',
      'StorageKey',
      'Contact',
      'revenueAmount',
    ])
      expect(JSON.stringify(response.body.data)).not.toContain(forbidden);
  });
  it('keeps actual total and stable page order across public HTTP pages', async () => {
    const query = {
      keyword: suffix,
      sortBy: 'price',
      sortOrder: 'desc',
      page: '2',
      pageSize: '1',
    };
    const second = await request(http)
      .get('/api/v1/resorts')
      .query(query)
      .expect(200);
    expect(second.body.data).toMatchObject({
      total: 3,
      page: 2,
      pageSize: 1,
      hasNext: true,
      items: [{ resortId: far }],
    });
    const last = await request(http)
      .get('/api/v1/resorts')
      .query({ ...query, page: '3' })
      .expect(200);
    expect(last.body.data).toMatchObject({
      total: 3,
      page: 3,
      hasNext: false,
      items: [{ resortId: near }],
    });
    const beyond = await request(http)
      .get('/api/v1/resorts')
      .query({ ...query, page: '4' })
      .expect(200);
    expect(beyond.body.data).toMatchObject({
      total: 3,
      page: 4,
      hasNext: false,
      items: [],
    });
  });
  it.each([
    { latitude: '0' },
    { longitude: '0' },
    { sortBy: 'distance' },
    { minPrice: '200', maxPrice: '100' },
    { minRating: '6' },
    { minPrice: '0.5' },
    { latitude: '91', longitude: '0' },
    { page: '2147483648', pageSize: '100' },
    { sortBy: 'revenue' },
    { openStatus: 'private' },
  ])('rejects malformed public filters with 400: %j', async (query) => {
    await request(http)
      .get('/api/v1/resorts')
      .query({ keyword: suffix, ...query })
      .expect(400);
  });
  it.each(['0', '-1', '2147483648', '1.5', 'not-a-number'])(
    'rejects invalid detail ID %s without ORM errors',
    async (id) => {
      await request(http).get(`/api/v1/resorts/${id}`).expect(400);
    },
  );
  it('keeps unpublished and deleted details hidden through public HTTP', async () => {
    await request(http).get(`/api/v1/resorts/${ids[3]}`).expect(404);
    await request(http).get(`/api/v1/resorts/${ids[4]}`).expect(404);
    await request(http).get(`/api/v1/resorts/${near}`).expect(200);
  });
});
