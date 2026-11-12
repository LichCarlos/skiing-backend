import { Prisma } from '@prisma/client';
import { ForbiddenException } from '@nestjs/common';
import { PrismaDashboardReader } from './prisma-dashboard.reader.js';
import type { PrismaService } from '../../../shared/persistence/prisma.service.js';

function setup(
  grants: string[] = [],
  scopes: {
    ResourceKey: string;
    ScopeType: string;
    ScopeConfig?: unknown;
  }[] = [],
) {
  const actor = {
    UserId: 7,
    Status: 'active',
    MerchantProfile: null as { MerchantId: number; Status: string } | null,
    UserRoles: [
      {
        Role: {
          RoleKey: 'editor',
          Status: 'active',
          DataScope: 'self',
          DataScopes: scopes,
          RolePermissions: ['management:portal:enter', ...grants].map(
            (PermissionKey) => ({
              Permission: { PermissionKey, Status: 'active' },
            }),
          ),
        },
      },
    ],
  };
  const grouped = () => ({ groupBy: vi.fn().mockResolvedValue([]) });
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(0),
    user: {
      findUnique: vi.fn().mockResolvedValue(actor),
      findFirst: vi.fn().mockResolvedValue(null),
      ...grouped(),
    },
    merchantProfile: grouped(),
    skiResort: grouped(),
    article: grouped(),
    dynamic: grouped(),
    ragDocument: { count: vi.fn().mockResolvedValue(0) },
    resortRevenueRecord: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { RevenueAmount: null } }),
    },
  };
  const transaction = vi.fn(
    async (work: (db: typeof tx) => Promise<unknown>, _options: unknown) =>
      work(tx),
  );
  return {
    actor,
    tx,
    transaction,
    reader: new PrismaDashboardReader({
      $transaction: transaction,
    } as unknown as PrismaService),
  };
}
describe('Dashboard SQL authorization boundaries', () => {
  it('uses a read-only repeatable snapshot and no business SQL for an entry-only account', async () => {
    const { reader, tx, transaction } = setup();
    expect(await reader.summarize(7)).toMatchObject({
      users: null,
      merchants: null,
      resorts: null,
      articles: null,
      dynamics: null,
      rag: null,
      revenue: null,
    });
    expect(transaction.mock.calls[0]?.[1]).toEqual({
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
    expect(tx.$executeRaw).toHaveBeenCalledOnce();
    expect(tx.user.groupBy).not.toHaveBeenCalled();
    for (const panel of [
      tx.merchantProfile,
      tx.skiResort,
      tx.article,
      tx.dynamic,
    ])
      expect(panel.groupBy).not.toHaveBeenCalled();
    expect(tx.ragDocument.count).not.toHaveBeenCalled();
    expect(tx.resortRevenueRecord.aggregate).not.toHaveBeenCalled();
  });
  it('cannot expose RAG or global revenue through a custom role grant', async () => {
    const { reader, tx } = setup([
      'ai:knowledge:list',
      'revenue:system:summary',
    ]);
    expect(await reader.summarize(7)).toMatchObject({
      rag: null,
      revenue: null,
    });
    expect(tx.ragDocument.count).not.toHaveBeenCalled();
    expect(tx.resortRevenueRecord.aggregate).not.toHaveBeenCalled();
  });
  it('cannot expose protected panels through an unprotected role named system_admin', async () => {
    const { reader, tx, actor } = setup([
      'ai:knowledge:list',
      'revenue:system:summary',
    ]);
    actor.UserRoles[0]!.Role.RoleKey = 'system_admin';
    expect(await reader.summarize(7)).toMatchObject({
      rag: null,
      revenue: null,
    });
    expect(tx.user.findFirst).toHaveBeenCalledOnce();
    expect(tx.ragDocument.count).not.toHaveBeenCalled();
    expect(tx.resortRevenueRecord.aggregate).not.toHaveBeenCalled();
  });
  it('fails before any aggregate SQL for unsupported article/global resort scope', async () => {
    for (const permission of [
      'content:article:manage',
      'content:resort:list-all',
    ]) {
      const { reader, tx, actor } = setup([permission, 'system:user:list']);
      if (permission.includes('article')) {
        actor.UserRoles[0]!.Role.DataScope = 'merchant';
        actor.MerchantProfile = { MerchantId: 9, Status: 'active' };
      }
      await expect(reader.summarize(7)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(tx.user.groupBy).not.toHaveBeenCalled();
      expect(tx.article.groupBy).not.toHaveBeenCalled();
      expect(tx.skiResort.groupBy).not.toHaveBeenCalled();
    }
  });
  it('missing merchant identity returns null before irrelevant merchant scope resolution', async () => {
    const { reader, tx, actor } = setup([
      'resort:merchant:list',
      'revenue:merchant:list',
    ]);
    actor.UserRoles[0]!.Role.DataScope = 'merchant';
    expect(await reader.summarize(7)).toMatchObject({
      resorts: null,
      revenue: null,
    });
    expect(tx.skiResort.groupBy).not.toHaveBeenCalled();
    expect(tx.resortRevenueRecord.aggregate).not.toHaveBeenCalled();
  });
  it('next request re-reads active permissions rather than caching the first result', async () => {
    const { reader, tx, actor } = setup(['system:user:list']);
    expect((await reader.summarize(7)).users).toEqual({
      total: 0,
      active: 0,
      disabled: 0,
    });
    actor.UserRoles[0]!.Role.RolePermissions =
      actor.UserRoles[0]!.Role.RolePermissions.filter(
        (g) => g.Permission.PermissionKey !== 'system:user:list',
      );
    tx.user.groupBy.mockClear();
    expect((await reader.summarize(7)).users).toBeNull();
    expect(tx.user.groupBy).not.toHaveBeenCalled();
  });
});
