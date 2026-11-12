import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../shared/persistence/prisma.service.js';
import { PrismaPublicResortReader } from './prisma-public-resort.reader.js';
import { normalizePublicResortQuery } from '../domain/public-resort-query.js';

function row(id: number) {
  return {
    ResortId: id,
    Name: `Alpine ${id}`,
    Province: null,
    City: null,
    District: null,
    Address: null,
    Longitude: null,
    Latitude: null,
    Rating: null,
    RatingCount: 0,
    Price: 100,
    OpenStatus: 'open',
    SnowCondition: 'powder',
    SnowConditionUpdatedAt: null,
    OpeningHours: null,
    TrailSummary: null,
    FacilitySummary: null,
    OfficialUrl: null,
    Description: 'resort',
    CustomFields: {},
    CoverAsset: null,
    Gallery: [],
    FitTags: [],
    UpdateTime: new Date(0),
  };
}
function setup() {
  const sql: Prisma.Sql[] = [];
  const dictionaryItem = {
    findMany: vi.fn(async () => [
      { Value: 'beginner', Label: '新手友好' },
      { Value: 'family', Label: '亲子' },
    ]),
  };
  const tx = {
    $queryRaw: vi.fn(async (query: Prisma.Sql) => {
      sql.push(query);
      return sql.length === 1
        ? [{ total: 8n }]
        : [
            { resortId: 2, distanceMeters: 20 },
            { resortId: 1, distanceMeters: 30 },
          ];
    }),
    skiResort: {
      findMany: vi.fn(async () => [row(1), row(2)]),
      findFirst: vi.fn(async () => row(1)),
    },
    favorite: { findMany: vi.fn(async () => [{ ResortId: 2 }]) },
  };
  const prisma = {
    dictionaryItem,
    $transaction: vi.fn(async (work: (tx: unknown) => unknown) => work(tx)),
  };
  return {
    reader: new PrismaPublicResortReader(prisma as unknown as PrismaService),
    tx,
    dictionaryItem,
    prisma,
    sql,
  };
}
describe('PrismaPublicResortReader', () => {
  it('exposes only active fit tags referenced by public resorts in stable dictionary order', async () => {
    const { reader, dictionaryItem } = setup();
    await expect(reader.findPublicFitTags()).resolves.toEqual([
      { value: 'beginner', label: '新手友好' },
      { value: 'family', label: '亲子' },
    ]);
    expect(dictionaryItem.findMany).toHaveBeenCalledWith({
      where: {
        DictType: 'resort.fit_tag',
        Status: 'active',
        Type: { Status: 'active' },
        ResortTags: {
          some: { Resort: { Status: 'published', DeletedAt: null } },
        },
      },
      orderBy: [{ SortOrder: 'asc' }, { ItemId: 'asc' }],
      select: { Value: true, Label: true },
    });
  });
  it('binds all filter values and applies every tag before database pagination', async () => {
    const { reader, tx, prisma, sql } = setup();
    const keyword = "%' OR 1=1 --";
    const result = await reader.findPage(
      normalizePublicResortQuery({
        keyword,
        fitTags: ['beginner', 'family'],
        latitude: 43.8,
        longitude: 116.4,
        sortBy: 'distance',
        sortOrder: 'desc',
        page: 3,
        pageSize: 2,
      }),
      9,
    );
    expect(result).toMatchObject({
      total: 8,
      items: [
        { resortId: 2, distanceMeters: 20, favoriteByMe: true },
        { resortId: 1, distanceMeters: 30, favoriteByMe: false },
      ],
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
    for (const query of sql) {
      expect(query.text).not.toContain(keyword);
      expect(query.values).toContain(keyword);
      expect(query.values).toEqual(
        expect.arrayContaining(['beginner', 'family']),
      );
      expect(query.text.match(/EXISTS/g)).toHaveLength(2);
      expect(query.text).toContain('r."Status" = \'published\'');
      expect(query.text).toContain('r."DeletedAt" IS NULL');
      expect(query.text).toContain(
        'di."Status"=\'active\' AND dt."Status"=\'active\'',
      );
    }
    expect(sql[1]!.text).toContain(
      'ORDER BY "distanceMeters" DESC NULLS LAST, r."ResortId" ASC',
    );
    expect(sql[1]!.text).toMatch(/LIMIT \$\d+ OFFSET \$\d+/);
    expect(sql[1]!.values.slice(-2)).toEqual([2, 4]);
    expect(sql[1]!.text).toContain('asin(sqrt(');
    expect(tx.skiResort.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          ResortId: { in: [2, 1] },
          Status: 'published',
          DeletedAt: null,
        },
      }),
    );
    expect(tx.favorite.findMany).toHaveBeenCalledWith({
      where: { UserId: 9, ResortId: { in: [2, 1] } },
      select: { ResortId: true },
    });
  });
  it('returns an empty page with its total without hydrating all resorts or querying favorites', async () => {
    const { reader, tx } = setup();
    tx.$queryRaw
      .mockResolvedValueOnce([{ total: 8n }])
      .mockResolvedValueOnce([]);
    await expect(
      reader.findPage(normalizePublicResortQuery({ page: 10 }), 9),
    ).resolves.toEqual({ items: [], total: 8 });
    expect(tx.skiResort.findMany).not.toHaveBeenCalled();
    expect(tx.favorite.findMany).not.toHaveBeenCalled();
  });
  it('does not query favorites for guests or return ORM ownership fields', async () => {
    const { reader, tx } = setup();
    const result = await reader.findPage(normalizePublicResortQuery({}));
    expect(tx.favorite.findMany).not.toHaveBeenCalled();
    expect(result.items[0]).not.toHaveProperty('merchantId');
    expect(result.items[0]).not.toHaveProperty('status');
  });
  it('reads published non-deleted details and favorites in one snapshot', async () => {
    const { reader, tx, prisma } = setup();
    await expect(reader.find(1, 9)).resolves.toMatchObject({
      resortId: 1,
      distanceMeters: null,
      favoriteByMe: true,
    });
    expect(tx.skiResort.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ResortId: 1, Status: 'published', DeletedAt: null },
      }),
    );
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
    tx.skiResort.findFirst.mockResolvedValueOnce(null as never);
    tx.favorite.findMany.mockClear();
    await expect(reader.find(9, 9)).resolves.toBeNull();
    expect(tx.favorite.findMany).not.toHaveBeenCalled();
  });
  it('rejects untrusted sort fragments before issuing SQL', async () => {
    const { reader, prisma } = setup();
    await expect(
      reader.findPage({
        ...normalizePublicResortQuery({}),
        sortBy: 'name; DROP TABLE' as never,
      }),
    ).rejects.toThrow(RangeError);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
