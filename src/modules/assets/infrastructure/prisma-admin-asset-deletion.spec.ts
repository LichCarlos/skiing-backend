import type { PrismaService } from '../../../shared/persistence/prisma.service.js';
import { PrismaAssetRepository } from './prisma-asset.repository.js';

const input = {
  assetId: '42',
  access: { kind: 'all' } as const,
  actorUserId: 8,
  traceId: 'trace',
  clientIp: null,
  userAgent: null,
};
describe('Admin asset deletion transaction boundary', () => {
  it.each([
    { code: 'P2034' },
    { code: '40001' },
    { code: '40P01' },
    { code: 'P2010', meta: { code: '40001' } },
    { code: 'P2010', meta: { code: '40P01' } },
  ])(
    'maps concurrency %j to 409 without replaying the transaction',
    async (error) => {
      const transaction = vi.fn().mockRejectedValue(error);
      const repository = new PrismaAssetRepository({
        $transaction: transaction,
      } as unknown as PrismaService);
      await expect(
        repository.deleteIfUnreferencedAdmin(input),
      ).rejects.toMatchObject({ status: 409 });
      expect(transaction).toHaveBeenCalledTimes(1);
      expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: 'Serializable',
      });
    },
  );
  it.each([{ code: 'P2000' }, { code: 'P2010', meta: { code: 'XX000' } }])(
    'preserves unrelated failure %j',
    async (error) => {
      const transaction = vi.fn().mockRejectedValue(error);
      const repository = new PrismaAssetRepository({
        $transaction: transaction,
      } as unknown as PrismaService);
      await expect(repository.deleteIfUnreferencedAdmin(input)).rejects.toBe(
        error,
      );
      expect(transaction).toHaveBeenCalledTimes(1);
    },
  );
  it('denies a missing actor before locking, updating or writing an audit', async () => {
    const tx = {
      user: { findUnique: vi.fn().mockResolvedValue(null) },
      $queryRaw: vi.fn(),
      asset: { updateMany: vi.fn() },
      operationLog: { create: vi.fn() },
    };
    const transaction = vi.fn(async (work: (transaction: unknown) => unknown) =>
      work(tx),
    );
    const repository = new PrismaAssetRepository({
      $transaction: transaction,
    } as unknown as PrismaService);
    await expect(
      repository.deleteIfUnreferencedAdmin(input),
    ).rejects.toMatchObject({ status: 403 });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.asset.updateMany).not.toHaveBeenCalled();
    expect(tx.operationLog.create).not.toHaveBeenCalled();
  });
  function referenceBoundary() {
    const tx = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          UserId: 8,
          Status: 'active',
          MerchantProfile: null,
          UserRoles: [
            {
              Role: {
                RoleKey: 'asset_manager',
                Status: 'active',
                DataScope: 'all',
                DataScopes: [],
                RolePermissions: [
                  'management:portal:enter',
                  'content:asset:delete',
                ].map((PermissionKey) => ({
                  Permission: { PermissionKey, Status: 'active' },
                })),
              },
            },
          ],
        }),
      },
      $queryRaw: vi.fn().mockResolvedValue([]),
      asset: { updateMany: vi.fn() },
      operationLog: { create: vi.fn() },
    };
    const freshRead = vi.fn();
    const repository = new PrismaAssetRepository({
      $transaction: async (work: (transaction: unknown) => unknown) => work(tx),
      asset: { findFirst: freshRead },
    } as unknown as PrismaService);
    return { tx, freshRead, repository };
  }
  it.each([
    'CoverResorts',
    'ResortImages',
    'ArticleCovers',
    'DynamicImages',
    'AvatarUsers',
  ])(
    'vetoes deletion for a newly committed %s reference outside the old snapshot',
    async (relation) => {
      const s = referenceBoundary();
      s.freshRead.mockResolvedValue({
        _count: {
          CoverResorts: 0,
          ResortImages: 0,
          ArticleCovers: 0,
          DynamicImages: 0,
          AvatarUsers: 0,
          [relation]: 1,
        },
      });
      await expect(s.repository.deleteIfUnreferencedAdmin(input)).resolves.toBe(
        'referenced',
      );
      expect(s.tx.$queryRaw).toHaveBeenCalledTimes(1);
      expect(s.tx.asset.updateMany).not.toHaveBeenCalled();
      expect(s.tx.operationLog.create).not.toHaveBeenCalled();
    },
  );
  it('does not delete a target no longer visible in the committed view', async () => {
    const s = referenceBoundary();
    s.freshRead.mockResolvedValue(null);
    await expect(s.repository.deleteIfUnreferencedAdmin(input)).resolves.toBe(
      'not_found',
    );
    expect(s.tx.asset.updateMany).not.toHaveBeenCalled();
    expect(s.tx.operationLog.create).not.toHaveBeenCalled();
  });
  it('fails closed when the committed reference read fails', async () => {
    const s = referenceBoundary();
    const failure = new Error('reference read unavailable');
    s.freshRead.mockRejectedValue(failure);
    await expect(s.repository.deleteIfUnreferencedAdmin(input)).rejects.toBe(
      failure,
    );
    expect(s.tx.asset.updateMany).not.toHaveBeenCalled();
    expect(s.tx.operationLog.create).not.toHaveBeenCalled();
  });
});
