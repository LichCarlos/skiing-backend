import { randomUUID } from 'node:crypto';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../src/shared/persistence/prisma.service.js';
import { MemberFavoritesService } from '../src/modules/member-engagement/application/member-favorites-service.js';
import { PrismaFavoriteRepository } from '../src/modules/member-engagement/infrastructure/prisma-favorite.repository.js';

describe('Member favorites (dedicated migrated PostgreSQL)', () => {
  const prisma = new PrismaService();
  const service = new MemberFavoritesService(
    new PrismaFavoriteRepository(prisma),
  );
  const suffix = randomUUID(),
    categoryValue = `fav-${suffix}`,
    foreignType = `test.favorite.${suffix}`;
  const userIds: number[] = [],
    resortIds: number[] = [],
    articleIds: number[] = [],
    itemIds: number[] = [];
  let categoryTypeCreated = false,
    foreignTypeCreated = false;
  let ownerId: number,
    otherId: number,
    resortId: number,
    secondResortId: number,
    articleId: number,
    foreignArticleId: number;
  let dynamicId: number;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL)
      throw new Error(
        'DATABASE_URL must explicitly identify a migrated test database',
      );
    await prisma.$connect();
    const type = await prisma.dictionaryType.findUnique({
      where: { DictType: 'knowledge.article_category' },
    });
    if (type)
      expect(type).toMatchObject({ Status: 'active', PubliclyReadable: true });
    else {
      await prisma.dictionaryType.create({
        data: {
          DictType: 'knowledge.article_category',
          DictName: 'Categories',
          GroupKey: 'knowledge',
          PubliclyReadable: true,
        },
      });
      categoryTypeCreated = true;
    }
    await prisma.dictionaryType.create({
      data: {
        DictType: foreignType,
        DictName: 'Other public dictionary',
        GroupKey: 'test',
        PubliclyReadable: true,
      },
    });
    foreignTypeCreated = true;
    for (const dictType of ['knowledge.article_category', foreignType]) {
      const item = await prisma.dictionaryItem.create({
        data: {
          DictType: dictType,
          Value: categoryValue,
          Label: 'Test category',
        },
      });
      itemIds.push(item.ItemId);
    }
    for (const prefix of ['a', 'b']) {
      const user = await prisma.user.create({
        data: {
          Account: `favorites-${prefix}-${suffix}`,
          PasswordHash: 'disabled',
          Nickname: 'Favorite fixture',
        },
      });
      userIds.push(user.UserId);
    }
    [ownerId, otherId] = userIds as [number, number];
    const dynamic = await prisma.dynamic.create({
      data: {
        AuthorId: ownerId,
        Content: '# 山上的一天\n\n**新雪**很好',
        ContentFormat: 'markdown_v1',
        Status: 'published',
      },
    });
    dynamicId = dynamic.DynamicId;
    for (const name of ['First', 'Second']) {
      const resort = await prisma.skiResort.create({
        data: {
          Name: `${name} ${suffix}`,
          Price: 120,
          SnowCondition: 'snow',
          Description: 'Fixture',
          LegacyDistance: 0,
          Status: 'published',
        },
      });
      resortIds.push(resort.ResortId);
    }
    [resortId, secondResortId] = resortIds as [number, number];
    for (const dictType of ['knowledge.article_category', foreignType]) {
      const article = await prisma.article.create({
        data: {
          Title: `Favorite ${suffix}`,
          Summary: 'Public summary',
          Body: 'Ski knowledge',
          CategoryDictType: dictType,
          CategoryValue: categoryValue,
          Status: 'published',
          PublishTime: new Date(),
        },
      });
      articleIds.push(article.ArticleId);
    }
    [articleId, foreignArticleId] = articleIds as [number, number];
  });

  beforeEach(async () => {
    await prisma.favorite.deleteMany({ where: { UserId: { in: userIds } } });
    await prisma.dynamic.update({
      where: { DynamicId: dynamicId },
      data: { Status: 'published', DeletedAt: null },
    });
    await prisma.skiResort.updateMany({
      where: { ResortId: { in: resortIds } },
      data: { Status: 'published', DeletedAt: null },
    });
    await prisma.article.updateMany({
      where: { ArticleId: { in: articleIds } },
      data: { Status: 'published', DeletedAt: null },
    });
    await prisma.dictionaryItem.updateMany({
      where: { ItemId: { in: itemIds } },
      data: { Status: 'active' },
    });
  });

  afterAll(async () => {
    try {
      if (userIds.length)
        await prisma.favorite.deleteMany({
          where: { UserId: { in: userIds } },
        });
      if (dynamicId)
        await prisma.dynamic.delete({ where: { DynamicId: dynamicId } });
      if (articleIds.length)
        await prisma.article.deleteMany({
          where: { ArticleId: { in: articleIds } },
        });
      if (resortIds.length)
        await prisma.skiResort.deleteMany({
          where: { ResortId: { in: resortIds } },
        });
      if (itemIds.length)
        await prisma.dictionaryItem.deleteMany({
          where: { ItemId: { in: itemIds } },
        });
      if (foreignTypeCreated)
        await prisma.dictionaryType.delete({
          where: { DictType: foreignType },
        });
      if (categoryTypeCreated)
        await prisma.dictionaryType.delete({
          where: { DictType: 'knowledge.article_category' },
        });
      if (userIds.length)
        await prisma.user.deleteMany({ where: { UserId: { in: userIds } } });
    } finally {
      await prisma.$disconnect();
    }
  });

  it('keeps repeated upserts unique and exposes only owner public summaries', async () => {
    for (let index = 0; index < 2; index++) {
      await service.add(ownerId, 'resort', resortId);
      await service.add(ownerId, 'article', articleId);
    }
    await service.add(otherId, 'resort', secondResortId);
    expect(await prisma.favorite.count({ where: { UserId: ownerId } })).toBe(2);
    const page = await service.list(ownerId, 1, 20);
    expect(page.total).toBe(2);
    expect(
      page.items
        .map((item) => item.target.id)
        .sort((left, right) => left - right),
    ).toEqual([resortId, articleId].sort((left, right) => left - right));
    const article = page.items.find((item) => item.targetType === 'article')!;
    expect(article.target).not.toHaveProperty('Body');
    expect((await service.list(otherId, 1, 20)).items[0]!.target).toMatchObject(
      { id: secondResortId },
    );
    expect((await service.list(ownerId, 1, 20, 'article')).total).toBe(1);
  });

  it('only exposes public dynamic favorites, preserves legacy all-type lists and isolates owners', async () => {
    await service.add(ownerId, 'dynamic', dynamicId);
    await service.add(ownerId, 'dynamic', dynamicId);
    expect((await service.state(ownerId, 'dynamic', dynamicId)).favorited).toBe(
      true,
    );
    expect((await service.state(otherId, 'dynamic', dynamicId)).favorited).toBe(
      false,
    );
    expect((await service.list(ownerId, 1, 12)).total).toBe(0);
    const page = await service.list(ownerId, 1, 12, 'dynamic');
    expect(page.total).toBe(1);
    expect(page.items[0]!.target).toMatchObject({
      id: dynamicId,
      targetType: 'dynamic',
      authorNickname: 'Favorite fixture',
    });
    expect(page.items[0]!.target).not.toHaveProperty('Content');
    for (const state of [
      { Status: 'pending' },
      { Status: 'hidden' },
      { DeletedAt: new Date() },
    ]) {
      await prisma.dynamic.update({
        where: { DynamicId: dynamicId },
        data: state,
      });
      expect((await service.list(ownerId, 1, 12, 'dynamic')).total).toBe(0);
      expect(
        (await service.state(ownerId, 'dynamic', dynamicId)).favorited,
      ).toBe(false);
      await expect(
        service.add(otherId, 'dynamic', dynamicId),
      ).rejects.toBeInstanceOf(NotFoundException);
    }
    await service.remove(otherId, 'dynamic', dynamicId);
    expect(
      await prisma.favorite.count({
        where: { UserId: ownerId, DynamicId: dynamicId },
      }),
    ).toBe(1);
    await service.remove(ownerId, 'dynamic', dynamicId);
    await service.remove(ownerId, 'dynamic', dynamicId);
  });

  it('enforces exactly one favorite target in PostgreSQL', async () => {
    await expect(
      prisma.favorite.create({ data: { UserId: ownerId } }),
    ).rejects.toThrow();
    await expect(
      prisma.favorite.create({
        data: { UserId: ownerId, ResortId: resortId, DynamicId: dynamicId },
      }),
    ).rejects.toThrow();
  });

  it('hides withdrawn/deleted targets and permits idempotent owner removal afterward', async () => {
    await service.add(ownerId, 'resort', resortId);
    await service.add(otherId, 'resort', resortId);
    await service.add(ownerId, 'article', articleId);
    await prisma.skiResort.update({
      where: { ResortId: resortId },
      data: { DeletedAt: new Date() },
    });
    await prisma.article.update({
      where: { ArticleId: articleId },
      data: { Status: 'withdrawn' },
    });
    expect(await service.list(ownerId, 1, 20)).toMatchObject({
      items: [],
      total: 0,
    });
    await expect(
      service.add(ownerId, 'resort', resortId),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.add(ownerId, 'article', articleId),
    ).rejects.toBeInstanceOf(NotFoundException);
    await service.remove(ownerId, 'resort', resortId);
    await service.remove(ownerId, 'resort', resortId);
    expect(
      await prisma.favorite.count({
        where: { UserId: otherId, ResortId: resortId },
      }),
    ).toBe(1);
  });

  it('hides disabled/private or unrelated article categories in both add and list', async () => {
    await service.add(ownerId, 'article', articleId);
    await prisma.favorite.create({
      data: { UserId: ownerId, ArticleId: foreignArticleId },
    });
    await expect(
      service.add(ownerId, 'article', foreignArticleId),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect((await service.list(ownerId, 1, 20)).total).toBe(1);
    await prisma.dictionaryItem.update({
      where: { ItemId: itemIds[0]! },
      data: { Status: 'disabled' },
    });
    expect((await service.list(ownerId, 1, 20)).total).toBe(0);
    await expect(
      service.add(ownerId, 'article', articleId),
    ).rejects.toBeInstanceOf(NotFoundException);
    await prisma.dictionaryItem.update({
      where: { ItemId: itemIds[0]! },
      data: { Status: 'active' },
    });
    for (const data of [{ PubliclyReadable: false }, { Status: 'disabled' }]) {
      try {
        await prisma.dictionaryType.update({
          where: { DictType: 'knowledge.article_category' },
          data,
        });
        expect((await service.list(ownerId, 1, 20)).total).toBe(0);
        await expect(
          service.add(ownerId, 'article', articleId),
        ).rejects.toBeInstanceOf(NotFoundException);
      } finally {
        await prisma.dictionaryType.update({
          where: { DictType: 'knowledge.article_category' },
          data: { Status: 'active', PubliclyReadable: true },
        });
      }
    }
  });

  it('orders equal timestamps by favorite ID and counts only the selected target type', async () => {
    await service.add(ownerId, 'resort', resortId);
    await service.add(ownerId, 'article', articleId);
    await service.add(ownerId, 'resort', secondResortId);
    await prisma.favorite.updateMany({
      where: { UserId: ownerId },
      data: { CreateTime: new Date('2026-10-29T00:00:00Z') },
    });
    const first = await service.list(ownerId, 1, 1),
      second = await service.list(ownerId, 2, 1);
    expect(first.total).toBe(3);
    expect(second.total).toBe(3);
    expect(BigInt(first.items[0]!.favoriteId)).toBeGreaterThan(
      BigInt(second.items[0]!.favoriteId),
    );
    expect((await service.list(ownerId, 1, 20, 'resort')).total).toBe(2);
  });

  it('keeps one relation after concurrent adds and permits retry after an explicit conflict', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => service.add(ownerId, 'resort', resortId)),
    );
    expect(results.some((result) => result.status === 'fulfilled')).toBe(true);
    for (const result of results)
      if (result.status === 'rejected')
        expect(result.reason).toBeInstanceOf(ConflictException);
    await service.add(ownerId, 'resort', resortId);
    expect(
      await prisma.favorite.count({
        where: { UserId: ownerId, ResortId: resortId },
      }),
    ).toBe(1);
  });
});
