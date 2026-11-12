import type { PrismaService } from '../../../shared/persistence/prisma.service.js';
import { PrismaAdminCommunityReader } from './prisma-admin-community.reader.js';
function fixture() {
  const now = new Date('2026-10-29T00:00:00Z');
  const row = {
    DynamicId: 7,
    AuthorId: 2,
    Content: 'Awaiting review',
    ResortId: null,
    Status: 'pending',
    ModeratedAt: null,
    ModeratedByUserId: null,
    ModerationReason: null,
    CreateTime: now,
    UpdateTime: now,
    Author: { Nickname: 'Author' },
    Images: [
      { Asset: { StorageKey: 'ready', Status: 'ready' } },
      { Asset: { StorageKey: 'rejected', Status: 'rejected' } },
    ],
  };
  const dynamic = {
    findMany: vi.fn().mockResolvedValue([row]),
    count: vi.fn().mockResolvedValue(1),
    findFirst: vi.fn().mockResolvedValue(row),
  };
  const comment = {
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
  };
  const transaction = vi.fn(async (work: unknown) =>
    typeof work === 'function'
      ? work({ dynamic, comment })
      : Promise.all(work as Promise<unknown>[]),
  );
  const prisma = { dynamic, comment, $transaction: transaction };
  const createReadUrl = vi.fn().mockResolvedValue('https://assets.test/ready');
  const reader = new PrismaAdminCommunityReader(
    prisma as unknown as PrismaService,
    { put: vi.fn(), remove: vi.fn(), createReadUrl },
  );
  return { reader, dynamic, comment, transaction, createReadUrl };
}
describe('Prisma admin community query adapter', () => {
  it('uses identical filters and a repeatable-read list/count without exposing storage keys', async () => {
    const { reader, dynamic, transaction, createReadUrl } = fixture();
    const result = await reader.listDynamics({
      page: 2,
      pageSize: 10,
      status: 'pending',
      keyword: '  Review  ',
    });
    const where = {
      DeletedAt: null,
      Status: 'pending',
      Content: { contains: 'Review', mode: 'insensitive' },
    };
    expect(dynamic.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where,
        skip: 10,
        take: 10,
        orderBy: [{ CreateTime: 'desc' }, { DynamicId: 'desc' }],
      }),
    );
    expect(dynamic.count).toHaveBeenCalledWith({ where });
    expect(transaction).toHaveBeenCalledWith(expect.any(Array), {
      isolationLevel: 'RepeatableRead',
    });
    expect(result.items[0]).toMatchObject({
      status: 'pending',
      authorNickname: 'Author',
      imageUrls: ['https://assets.test/ready'],
    });
    expect(result.items[0]).not.toHaveProperty('Images');
    expect(createReadUrl).toHaveBeenCalledExactlyOnceWith('ready', 900);
  });
  it('includes hidden comments only in admin pagination and checks the undeleted parent in the same snapshot', async () => {
    const { reader, dynamic, comment, transaction } = fixture();
    await reader.listComments(7, { page: 2, pageSize: 10 });
    expect(dynamic.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { DynamicId: 7, DeletedAt: null } }),
    );
    expect(comment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { DynamicId: 7, DeletedAt: null },
        skip: 10,
        take: 10,
      }),
    );
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
    dynamic.findFirst.mockResolvedValue(null);
    comment.findMany.mockClear();
    expect(await reader.listComments(7, {})).toBeNull();
    expect(comment.findMany).not.toHaveBeenCalled();
  });
  it('returns null to the application for absent or soft-deleted detail records', async () => {
    const { reader, dynamic } = fixture();
    dynamic.findFirst.mockResolvedValue(null);
    expect(await reader.getDynamic(7)).toBeNull();
    expect(dynamic.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { DynamicId: 7, DeletedAt: null } }),
    );
  });
});
