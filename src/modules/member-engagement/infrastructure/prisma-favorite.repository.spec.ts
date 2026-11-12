import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../shared/persistence/prisma.service.js';
import { PrismaFavoriteRepository } from './prisma-favorite.repository.js';

function setup() {
  const tx = {
    skiResort: { findFirst: vi.fn().mockResolvedValue({ ResortId: 8 }) },
    article: { findFirst: vi.fn().mockResolvedValue({ ArticleId: 9 }) },
    dynamic: { findFirst: vi.fn().mockResolvedValue({ DynamicId: 8 }) },
    favorite: {
      upsert: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
  const prisma = {
    ...tx,
    $transaction: vi.fn((work: unknown) =>
      typeof work === 'function'
        ? (work(tx) as Promise<unknown>)
        : Promise.all(work as Promise<unknown>[]),
    ),
  };
  return {
    tx,
    prisma,
    repository: new PrismaFavoriteRepository(
      prisma as unknown as PrismaService,
    ),
  };
}

const category = {
  is: {
    DictType: 'knowledge.article_category',
    Status: 'active',
    Type: { is: { Status: 'active', PubliclyReadable: true } },
  },
};

describe('PrismaFavoriteRepository', () => {
  it('only favorites an approved, undeleted dynamic and scopes removal to its owner', async () => {
    const { repository, tx } = setup();
    await expect(repository.addPublicTarget(12, 'dynamic', 8)).resolves.toBe(
      true,
    );
    expect(tx.dynamic.findFirst).toHaveBeenCalledWith({
      where: { Status: 'published', DeletedAt: null, DynamicId: 8 },
      select: { DynamicId: true },
    });
    expect(tx.favorite.upsert).toHaveBeenCalledWith({
      where: { UserId_DynamicId: { UserId: 12, DynamicId: 8 } },
      create: { UserId: 12, DynamicId: 8 },
      update: {},
    });
    tx.dynamic.findFirst.mockResolvedValue(null);
    tx.favorite.upsert.mockClear();
    await expect(repository.addPublicTarget(12, 'dynamic', 8)).resolves.toBe(
      false,
    );
    expect(tx.favorite.upsert).not.toHaveBeenCalled();
    await repository.remove(12, 'dynamic', 8);
    expect(tx.favorite.deleteMany).toHaveBeenCalledWith({
      where: { UserId: 12, DynamicId: 8 },
    });
  });
  it('excludes unpublished dynamics from both collection count and page and strips Markdown in summaries', async () => {
    const { repository, tx } = setup();
    const time = new Date('2026-11-07T00:00:00Z');
    tx.favorite.findMany.mockResolvedValue([
      {
        FavoriteId: 4n,
        CreateTime: time,
        Resort: null,
        Article: null,
        Dynamic: {
          DynamicId: 8,
          Content: '# 山上的一天\n\n**雪友**',
          ContentFormat: 'markdown_v1',
          CreateTime: time,
          Author: { Nickname: '雪友' },
        },
      },
    ]);
    const result = await repository.findPage({
      userId: 12,
      targetType: 'dynamic',
      skip: 0,
      take: 20,
    });
    const where = tx.favorite.count.mock.calls[0]![0].where;
    expect(where).toMatchObject({
      UserId: 12,
      DynamicId: { not: null },
      OR: expect.arrayContaining([
        { Dynamic: { is: { Status: 'published', DeletedAt: null } } },
      ]),
    });
    expect(tx.favorite.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where }),
    );
    expect(result.items[0]?.target).toEqual({
      targetType: 'dynamic',
      id: 8,
      summary: '山上的一天 \n 雪友',
      authorNickname: '雪友',
      createdAt: time,
    });
  });
  it.each(['resort', 'article'] as const)(
    'checks %s visibility inside the serializable upsert transaction',
    async (type) => {
      const { repository, tx, prisma } = setup();
      await expect(repository.addPublicTarget(12, type, 8)).resolves.toBe(true);
      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: 'Serializable',
      });
      const query =
        type === 'resort' ? tx.skiResort.findFirst : tx.article.findFirst;
      expect(query).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            Status: 'published',
            DeletedAt: null,
            ...(type === 'article'
              ? { Category: category, PublishTime: { not: null } }
              : {}),
          }),
        }),
      );
      expect(tx.favorite.upsert).toHaveBeenCalledWith({
        where:
          type === 'resort'
            ? { UserId_ResortId: { UserId: 12, ResortId: 8 } }
            : { UserId_ArticleId: { UserId: 12, ArticleId: 8 } },
        create:
          type === 'resort'
            ? { UserId: 12, ResortId: 8 }
            : { UserId: 12, ArticleId: 8 },
        update: {},
      });
      expect(query.mock.invocationCallOrder[0]).toBeLessThan(
        tx.favorite.upsert.mock.invocationCallOrder[0]!,
      );
    },
  );
  it.each(['resort', 'article'] as const)(
    'does not write an unavailable %s target',
    async (type) => {
      const { repository, tx } = setup();
      tx.article.findFirst.mockResolvedValue(null);
      tx.skiResort.findFirst.mockResolvedValue(null);
      await expect(repository.addPublicTarget(12, type, 8)).resolves.toBe(
        false,
      );
      expect(tx.favorite.upsert).not.toHaveBeenCalled();
    },
  );
  it.each(['P2034', 'P2002'])(
    'maps transaction conflict %s to 409 without retrying',
    async (code) => {
      const { repository, prisma } = setup();
      prisma.$transaction.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('conflict', {
          code,
          clientVersion: '6.19.0',
        }),
      );
      await expect(
        repository.addPublicTarget(12, 'article', 9),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    },
  );
  it('preserves unknown database failures', async () => {
    const { repository, tx } = setup();
    const failure = new Error('write failed');
    tx.favorite.upsert.mockRejectedValue(failure);
    await expect(repository.addPublicTarget(12, 'resort', 8)).rejects.toBe(
      failure,
    );
  });
  it.each(['resort', 'article'] as const)(
    'deletes only owner %s relations without requiring a public target',
    async (type) => {
      const { repository, tx } = setup();
      await repository.remove(12, type, 8);
      expect(tx.favorite.deleteMany).toHaveBeenCalledWith({
        where: {
          UserId: 12,
          ...(type === 'resort' ? { ResortId: 8 } : { ArticleId: 8 }),
        },
      });
      expect(tx.skiResort.findFirst).not.toHaveBeenCalled();
      expect(tx.article.findFirst).not.toHaveBeenCalled();
    },
  );
  it('shares owner/public filters between count and page under RepeatableRead', async () => {
    const { repository, tx, prisma } = setup();
    await repository.findPage({
      userId: 12,
      skip: 10,
      take: 10,
      targetType: 'article',
    });
    const where = tx.favorite.count.mock.calls[0]![0].where;
    expect(where).toMatchObject({
      UserId: 12,
      ArticleId: { not: null },
      OR: expect.arrayContaining([
        {
          Article: {
            is: expect.objectContaining({
              Category: category,
              PublishTime: { not: null },
            }),
          },
        },
      ]),
    });
    expect(tx.favorite.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where,
        skip: 10,
        take: 10,
        orderBy: [{ CreateTime: 'desc' }, { FavoriteId: 'desc' }],
      }),
    );
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Array), {
      isolationLevel: 'RepeatableRead',
    });
  });
  it('maps only the allowlisted public summary, preserving large IDs and null ratings', async () => {
    const { repository, tx } = setup();
    const time = new Date();
    tx.favorite.findMany.mockResolvedValue([
      {
        FavoriteId: 9007199254740993n,
        CreateTime: time,
        Resort: {
          ResortId: 8,
          Name: 'Snow',
          Province: null,
          City: 'City',
          District: null,
          Rating: null,
          Price: 120,
          MerchantId: 999,
        },
        Article: null,
      },
      {
        FavoriteId: 2n,
        CreateTime: time,
        Resort: null,
        Article: {
          ArticleId: 9,
          Title: 'Ski',
          Summary: 'Learn',
          CategoryValue: 'skills',
          PublishTime: time,
          Body: 'private excess',
        },
      },
    ]);
    const result = await repository.findPage({ userId: 12, skip: 0, take: 20 });
    expect(result.items[0]).toMatchObject({
      favoriteId: '9007199254740993',
      target: { rating: null, startingPrice: '120' },
    });
    expect(result.items[0]!.target).not.toHaveProperty('MerchantId');
    expect(result.items[1]!.target).not.toHaveProperty('Body');
  });
});
