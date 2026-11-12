import { PrismaPublicArticleReader } from './prisma-public-article.reader.js';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';
import type { AssetStorage } from '../../assets/application/ports/asset-storage.js';
import { PublicArticleQueries } from '../application/public-article-queries.js';

const article = {
  ArticleId: 17,
  Title: '安全入门',
  Summary: '雪道基础知识',
  Body: '# 安全入门',
  AuthorName: null,
  PublishTime: new Date('2026-10-01T00:00:00.000Z'),
  Category: { Value: 'basics', Label: '基础' },
  CoverAsset: { StorageKey: 'assets/article-cover.webp' },
  Favorites: [],
};

describe('PublicArticleQueries', () => {
  const findMany = vi.fn();
  const count = vi.fn();
  const findFirst = vi.fn();
  const categoriesFindMany = vi.fn();
  const transaction = vi.fn();
  const createReadUrl = vi.fn(async () => 'https://assets.example/cover');
  let queries: PublicArticleQueries;

  beforeEach(() => {
    vi.clearAllMocks();
    const prisma = {
      article: { findMany, count, findFirst },
      dictionaryItem: { findMany: categoriesFindMany },
      $transaction: transaction,
    } as unknown as PrismaService;
    transaction.mockImplementation((operations: Promise<unknown>[]) =>
      Promise.all(operations),
    );
    queries = new PublicArticleQueries(new PrismaPublicArticleReader(prisma), {
      createReadUrl,
    } as unknown as AssetStorage);
  });

  it('returns only public categories in stable dictionary order', async () => {
    categoriesFindMany.mockResolvedValue([{ Value: 'basics', Label: '基础' }]);

    await expect(queries.categories()).resolves.toEqual([
      { value: 'basics', label: '基础' },
    ]);
    expect(categoriesFindMany).toHaveBeenCalledWith({
      where: {
        DictType: 'knowledge.article_category',
        Status: 'active',
        Type: { is: { Status: 'active', PubliclyReadable: true } },
      },
      orderBy: [{ SortOrder: 'asc' }, { ItemId: 'asc' }],
      select: { Value: true, Label: true },
    });
  });

  it('filters to published articles and applies the confirmed page contract', async () => {
    findMany.mockResolvedValue([article]);
    count.mockResolvedValue(21);

    await expect(
      queries.list({
        page: 2,
        pageSize: 10,
        keyword: '  snow ',
        categoryValue: 'basics',
      }),
    ).resolves.toEqual({
      items: [
        {
          articleId: 17,
          title: '安全入门',
          summary: '雪道基础知识',
          coverUrl: 'https://assets.example/cover',
          category: { value: 'basics', label: '基础' },
          authorName: null,
          publishTime: '2026-10-01T00:00:00.000Z',
          favoriteByMe: false,
        },
      ],
      page: 2,
      pageSize: 10,
      total: 21,
      hasNext: true,
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          Status: 'published',
          DeletedAt: null,
          PublishTime: { not: null },
          Category: {
            is: {
              DictType: 'knowledge.article_category',
              Status: 'active',
              Type: { is: { Status: 'active', PubliclyReadable: true } },
            },
          },
          CategoryValue: 'basics',
          OR: [
            { Title: { contains: 'snow', mode: 'insensitive' } },
            { Summary: { contains: 'snow', mode: 'insensitive' } },
          ],
        }),
        skip: 10,
        take: 10,
        orderBy: [{ PublishTime: 'desc' }, { ArticleId: 'desc' }],
      }),
    );
  });

  it('does not expose a detail when it is not publicly readable', async () => {
    findFirst.mockResolvedValue(null);

    await expect(queries.get(999)).rejects.toBeInstanceOf(NotFoundException);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          ArticleId: 999,
          Status: 'published',
          DeletedAt: null,
          Category: expect.any(Object),
        }),
      }),
    );
  });
  it('always projects false for guests even if an adapter supplies a favorite row', async () => {
    findFirst.mockResolvedValue({ ...article, Favorites: [{ UserId: 42 }] });
    await expect(queries.get(17)).resolves.toMatchObject({
      favoriteByMe: false,
    });
    await expect(queries.get(17, 42)).resolves.toMatchObject({
      favoriteByMe: true,
    });
  });
});
