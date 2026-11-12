import { BadRequestException } from '@nestjs/common';
import { PublicCommunityQueries } from '../application/public-community-queries.js';
import { PrismaPublicCommunityReader } from './prisma-public-community.reader.js';
import type { PrismaService } from '../../../shared/persistence/prisma.service.js';
import type { AssetStorage } from '../../assets/application/ports/asset-storage.js';

function dynamicRow(id = 12) {
  const now = new Date('2026-10-28T00:00:00.000Z');
  return {
    DynamicId: id,
    AuthorId: 7,
    Content: 'Powder day at the north ridge',
    ResortId: null,
    CreateTime: now,
    UpdateTime: now,
    Author: { UserId: 7, Nickname: 'Skier', Avatar: null },
    Resort: null,
    Images: [],
    _count: { Comments: 2, Likes: 3 },
  };
}

function setup() {
  const tx = {
    dynamic: {
      findMany: vi.fn(async () => [dynamicRow()]),
      findFirst: vi.fn(async () => dynamicRow()),
    },
    likeRecord: { findMany: vi.fn(async () => []) },
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
    createReadUrl: vi.fn(async () => 'https://assets.test/image'),
  };
  return {
    prisma,
    storage,
    sut: new PublicCommunityQueries(
      new PrismaPublicCommunityReader(
        prisma as unknown as PrismaService,
        storage,
      ),
    ),
  };
}

describe('PublicCommunityQueries', () => {
  it('filters the public feed to published records and matches keywords case-insensitively', async () => {
    const { prisma, sut } = setup();

    const page = await sut.dynamics({ keyword: '  POWDER  ', limit: 10 });

    expect(prisma.dynamic.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          Status: 'published',
          DeletedAt: null,
          Content: { contains: 'POWDER', mode: 'insensitive' },
        },
        orderBy: [{ CreateTime: 'desc' }, { DynamicId: 'desc' }],
        take: 11,
      }),
    );
    expect(page.items[0]).toMatchObject({
      dynamicId: 12,
      status: 'published',
      likedByMe: false,
      commentCount: 2,
      likeCount: 3,
    });
    expect(prisma.likeRecord.findMany).not.toHaveBeenCalled();
  });

  it('does not include paginated comments in the dynamic detail response', async () => {
    const { prisma, sut } = setup();

    const detail = await sut.dynamic(12);

    expect(prisma.dynamic.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { DynamicId: 12, Status: 'published', DeletedAt: null },
      }),
    );
    expect(detail).toMatchObject({
      dynamicId: 12,
      status: 'published',
      imageUrls: [],
      updatedAt: '2026-10-28T00:00:00.000Z',
    });
    expect(detail).not.toHaveProperty('comments');
  });

  it('rejects malformed cursors before querying', async () => {
    const { prisma, sut } = setup();

    await expect(
      sut.dynamics({ cursor: 'not-a-cursor', limit: 20 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.dynamic.findMany).not.toHaveBeenCalled();
  });

  it('signs only ready images for 900 seconds and returns no null entries in detail images', async () => {
    const row = {
      ...dynamicRow(),
      Images: [
        {
          Asset: {
            StorageKey: 'blocked',
            Status: 'rejected',
            OwnerUserId: 7,
            MimeType: 'image/png',
          },
        },
        {
          Asset: {
            StorageKey: 'ready',
            Status: 'ready',
            OwnerUserId: 7,
            MimeType: 'image/png',
          },
        },
      ],
    };
    const tx = { dynamic: { findFirst: vi.fn().mockResolvedValue(row) } };
    const prisma = {
      $transaction: vi.fn(async (work: (client: typeof tx) => unknown) =>
        work(tx),
      ),
    };
    const createReadUrl = vi
      .fn()
      .mockResolvedValue('https://assets.test/ready');
    const storage: AssetStorage = {
      put: vi.fn(),
      remove: vi.fn(),
      createReadUrl,
    };
    const reader = new PrismaPublicCommunityReader(
      prisma as unknown as PrismaService,
      storage,
    );
    expect(await reader.dynamic(12)).toMatchObject({
      imageUrls: ['https://assets.test/ready'],
      coverUrl: null,
    });
    expect(createReadUrl).toHaveBeenCalledExactlyOnceWith('ready', 900);
  });

  it('checks the public parent and paginates visible comments in the same repeatable-read snapshot', async () => {
    const tx = {
      dynamic: { findFirst: vi.fn().mockResolvedValue({ DynamicId: 12 }) },
      comment: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
    };
    const prisma = {
      $transaction: vi.fn(
        async (work: (client: typeof tx) => Promise<unknown>) => work(tx),
      ),
    };
    const storage: AssetStorage = {
      put: vi.fn(),
      remove: vi.fn(),
      createReadUrl: vi.fn(),
    };
    const reader = new PrismaPublicCommunityReader(
      prisma as unknown as PrismaService,
      storage,
    );
    expect(await reader.comments(12, { page: 2, pageSize: 10 })).toMatchObject({
      items: [],
      page: 2,
      pageSize: 10,
      total: 0,
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
    expect(tx.dynamic.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { DynamicId: 12, Status: 'published', DeletedAt: null },
      }),
    );
    expect(tx.comment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { DynamicId: 12, Status: 'visible', DeletedAt: null },
        skip: 10,
        take: 10,
      }),
    );
    tx.dynamic.findFirst.mockResolvedValue(null);
    tx.comment.findMany.mockClear();
    expect(await reader.comments(12, {})).toBeNull();
    expect(tx.comment.findMany).not.toHaveBeenCalled();
  });
});
