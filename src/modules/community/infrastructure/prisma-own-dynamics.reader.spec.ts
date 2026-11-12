import type { PrismaService } from '../../../shared/persistence/prisma.service.js';
import { PrismaOwnDynamicsReader } from './prisma-own-dynamics.reader.js';
import { OwnCommunityQueries } from '../application/own-community-queries.js';
import { NotFoundException } from '@nestjs/common';

function setup() {
  const row = {
    DynamicId: 12,
    Content: 'Long content '.repeat(30),
    Status: 'hidden',
    CreateTime: new Date('2026-10-29T00:00:00Z'),
    UpdateTime: new Date('2026-10-29T01:00:00Z'),
    Author: { UserId: 7, Nickname: 'Skier', Avatar: null },
    Resort: null,
    Images: [
      {
        Asset: {
          AssetId: 11n,
          OwnerUserId: 7,
          StorageKey: 'ready-image',
          Status: 'ready',
          MimeType: 'image/png',
        },
      },
      {
        Asset: {
          AssetId: 12n,
          OwnerUserId: 7,
          StorageKey: 'unscanned-image',
          Status: 'pending',
          MimeType: 'image/png',
        },
      },
      {
        Asset: {
          AssetId: 13n,
          OwnerUserId: 8,
          StorageKey: 'other-owner-image',
          Status: 'ready',
          MimeType: 'image/png',
        },
      },
    ],
    _count: { Comments: 2, Likes: 3 },
  };
  const tx = {
    customFieldGroup: { findMany: vi.fn().mockResolvedValue([]) },
    roleFieldPermission: { findMany: vi.fn().mockResolvedValue([]) },
    userRole: { findFirst: vi.fn().mockResolvedValue(null) },

    dynamic: {
      findMany: vi.fn(async () => [row]),
      findFirst: vi.fn(async (): Promise<typeof row | null> => row),
      count: vi.fn(async () => 30),
    },
    likeRecord: { findMany: vi.fn(async () => [{ DynamicId: 12 }]) },
  };
  const prisma = {
    ...tx,
    $transaction: vi.fn(async (work: (client: typeof tx) => unknown) =>
      work(tx),
    ),
  };
  const storage = {
    put: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    createReadUrl: vi.fn(async (key: string) => `https://assets.test/${key}`),
  };
  const reader = new PrismaOwnDynamicsReader(
    prisma as unknown as PrismaService,
    storage,
  );
  return {
    row,
    prisma,
    storage,
    reader,
    queries: new OwnCommunityQueries(reader),
  };
}

describe('Own dynamics read model', () => {
  it('binds both list and count to the authenticated owner and uses stable offset ordering', async () => {
    const { reader, prisma } = setup();
    const result = await reader.list(7, {
      page: 2,
      pageSize: 10,
      status: 'hidden',
    });
    const where = { AuthorId: 7, DeletedAt: null, Status: 'hidden' };
    expect(prisma.dynamic.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where,
        skip: 10,
        take: 10,
        orderBy: [{ CreateTime: 'desc' }, { DynamicId: 'desc' }],
      }),
    );
    expect(prisma.dynamic.count).toHaveBeenCalledWith({ where });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
    expect(prisma.likeRecord.findMany).toHaveBeenCalledWith({
      where: { UserId: 7, DynamicId: { in: [12] } },
      select: { DynamicId: true },
    });
    expect(result).toMatchObject({
      page: 2,
      pageSize: 10,
      total: 30,
      hasNext: true,
      items: [{ status: 'hidden', likedByMe: true }],
    });
    expect(result.items[0]).not.toHaveProperty('content');
  });

  it('returns all three supported states by default and skips likes for an empty page', async () => {
    const { reader, prisma } = setup();
    prisma.dynamic.findMany.mockResolvedValueOnce([]);
    prisma.dynamic.count.mockResolvedValueOnce(0);
    expect(await reader.list(7, {})).toEqual({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
      hasNext: false,
    });
    expect(prisma.dynamic.count).toHaveBeenCalledWith({
      where: {
        AuthorId: 7,
        DeletedAt: null,
        Status: { in: ['pending', 'published', 'hidden'] },
      },
    });
    expect(prisma.likeRecord.findMany).not.toHaveBeenCalled();
  });

  it.each(['pending', 'hidden', 'published'])(
    'reads complete %s content for its owner without signing unscanned assets',
    async (status) => {
      const { queries, prisma, storage, row } = setup();
      row.Status = status;
      const result = await queries.get(7, 12);
      expect(prisma.dynamic.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            DynamicId: 12,
            AuthorId: 7,
            DeletedAt: null,
            Status: { in: ['pending', 'published', 'hidden'] },
          },
        }),
      );
      expect(result).toMatchObject({
        status,
        content: row.Content,
        imageUrls: ['https://assets.test/ready-image'],
        images: [{ assetId: '11', url: 'https://assets.test/ready-image' }],
      });
      expect(storage.createReadUrl).toHaveBeenCalledExactlyOnceWith(
        'ready-image',
        900,
      );
    },
  );

  it('treats another owner, deleted and absent records as the same 404 without signing assets', async () => {
    const { queries, prisma, storage } = setup();
    prisma.dynamic.findFirst.mockResolvedValueOnce(null);
    await expect(queries.get(8, 12)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.dynamic.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ AuthorId: 8, DeletedAt: null }),
      }),
    );
    expect(storage.createReadUrl).not.toHaveBeenCalled();
  });
});
