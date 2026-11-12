import { articleActor } from '../../../../test/fixtures/article-actor.js';
import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { PrismaArticleRepository } from './prisma-article.repository.js';
import type { PrismaService } from '../../../shared/persistence/prisma.service.js';
import type { OutboxStore } from '../../integration-events/application/ports/outbox-store.js';
import type { ArticleAccess } from '../domain/article-scope.js';
import { articleWhere } from './article-scope.js';

function setup(access: ArticleAccess = { kind: 'all' }) {
  const tx = {
    $queryRaw: vi.fn(async () => []),
    article: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 4),
      updateMany: vi.fn(async () => ({ count: 1 })),
      create: vi.fn(),
    },
    dictionaryItem: { findFirst: vi.fn(async () => ({ ItemId: 1 })) },
    asset: { findFirst: vi.fn(async () => ({ AssetId: 91n })) },
    user: {
      findUnique: vi.fn(async () => articleActor(access)),
    },
    customFieldDefinition: { findMany: vi.fn(async () => []) },
    roleFieldPermission: { findMany: vi.fn(async () => []) },
    operationLog: { create: vi.fn(async () => ({})) },
  };
  const prisma = {
    article: tx.article,
    $transaction: vi.fn(async (work: unknown) =>
      typeof work === 'function'
        ? work(tx)
        : Promise.all(work as Promise<unknown>[]),
    ),
  };
  const outbox = { append: vi.fn(async () => {}) };
  return {
    repo: new PrismaArticleRepository(
      prisma as unknown as PrismaService,
      outbox as unknown as OutboxStore,
    ),
    tx,
    prisma,
    outbox,
  };
}
describe('Prisma article scope and transaction adapter', () => {
  it('applies self before pagination/count in one RepeatableRead snapshot', async () => {
    const { repo, tx, prisma } = setup({ kind: 'self', userId: 3 });
    await repo.runRead({ kind: 'self', userId: 3 }, 3, (tx) =>
      tx.findPage({ skip: 6, take: 3, keyword: 'snow' }),
    );
    const where = {
      DeletedAt: null,
      AuthorId: 3,
      OR: [
        { Title: { contains: 'snow', mode: 'insensitive' } },
        { Summary: { contains: 'snow', mode: 'insensitive' } },
      ],
    };
    expect(tx.article.count).toHaveBeenCalledWith({ where });
    expect(tx.article.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where, skip: 6, take: 3 }),
    );
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
  });
  it('preserves the selected set when a specific target is requested or updated', async () => {
    const access = { kind: 'selected', ids: [19, 20] } as const;
    const { repo, tx } = setup(access);
    await repo.runRead(access, 3, (tx) => tx.find(99));
    expect(tx.article.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          DeletedAt: null,
          ArticleId: { in: [19, 20] },
          AND: [{ ArticleId: 99 }],
        },
      }),
    );
    await repo.runWrite(access, 3, (tx) =>
      tx.update(99, 2, { status: 'withdrawn' }),
    );
    expect(tx.article.updateMany).toHaveBeenCalledWith({
      where: {
        DeletedAt: null,
        ArticleId: { in: [19, 20] },
        AND: [{ ArticleId: 99 }],
        Version: 2,
      },
      data: { Status: 'withdrawn', Version: { increment: 1 } },
    });
  });
  it('refuses malformed or merchant scope even when a caller defeats the static type', async () => {
    const { repo, tx, prisma } = setup();
    expect(() =>
      articleWhere({
        kind: 'merchant',
        merchantId: 4,
      } as unknown as ArticleAccess),
    ).toThrow();
    expect(() =>
      repo.runWrite(
        { kind: 'merchant', merchantId: 4 } as unknown as ArticleAccess,
        3,
        (tx) => tx.find(1),
      ),
    ).toThrow();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.article.findFirst).not.toHaveBeenCalled();
  });
  it('does not let a selected transaction create a new target', async () => {
    const { repo, tx } = setup({ kind: 'selected', ids: [19] });
    await expect(
      repo.runWrite({ kind: 'selected', ids: [19] }, 3, (tx) =>
        tx.create(
          {
            title: 'Title',
            summary: 'Summary',
            body: 'Body',
            coverAssetId: null,
            categoryValue: 'basics',
            customFields: {},
            schemaVersion: 1,
          },
          3,
        ),
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(tx.article.create).not.toHaveBeenCalled();
    expect(tx.article.create).not.toHaveBeenCalled();
  });
  it('checks category/type visibility and ready cover through the same transaction client', async () => {
    const { repo, tx } = setup();
    const values = {
      title: 'Title',
      summary: 'Summary',
      body: 'Body',
      coverAssetId: '91',
      categoryValue: 'basics',
      customFields: {},
      schemaVersion: 1,
    };
    await repo.runWrite({ kind: 'all' }, 3, (tx) =>
      tx.assertReferences(values),
    );
    expect(tx.dictionaryItem.findFirst).toHaveBeenCalledWith({
      where: {
        DictType: 'knowledge.article_category',
        Value: 'basics',
        Status: 'active',
        Type: { Status: 'active', PubliclyReadable: true },
      },
      select: { ItemId: true },
    });
    expect(tx.asset.findFirst).toHaveBeenCalledWith({
      where: {
        AssetId: 91n,
        Status: 'ready',
        MimeType: { in: ['image/jpeg', 'image/png', 'image/webp'] },
      },
      select: { AssetId: true },
    });
    tx.asset.findFirst.mockResolvedValueOnce(null as never);
    await expect(
      repo.runWrite({ kind: 'all' }, 3, (tx) => tx.assertReferences(values)),
    ).rejects.toMatchObject({ status: 422 });
  });
  it('maps serialization conflicts to 409 without replaying work', async () => {
    const { repo, prisma, outbox } = setup();
    prisma.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('serialization', {
        code: 'P2034',
        clientVersion: '6.19.0',
      }),
    );
    await expect(
      repo.runWrite({ kind: 'all' }, 3, (tx) =>
        tx.appendChanged(19, 'published'),
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(prisma.$transaction).toHaveBeenCalledExactlyOnceWith(
      expect.any(Function),
      { isolationLevel: 'Serializable' },
    );
    expect(outbox.append).not.toHaveBeenCalled();
  });
  it.each(['40001', '40P01'])(
    'maps raw PostgreSQL %s to 409 without replaying work',
    async (code) => {
      const { repo, prisma, outbox } = setup();
      prisma.$transaction.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('raw conflict', {
          code: 'P2010',
          clientVersion: '6.19.0',
          meta: { code },
        }),
      );
      await expect(
        repo.runWrite({ kind: 'all' }, 3, (tx) =>
          tx.appendChanged(19, 'published'),
        ),
      ).rejects.toMatchObject({ status: 409 });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(outbox.append).not.toHaveBeenCalled();
    },
  );
});
