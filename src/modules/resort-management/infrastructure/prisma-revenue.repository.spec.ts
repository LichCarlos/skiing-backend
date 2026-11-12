import { PrismaRevenueRepository } from './prisma-revenue.repository.js';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';
import { RevenueService } from '../application/revenue-service.js';
import { Prisma } from '@prisma/client';

const access = {
  userId: 11,
  merchantId: 71,
  scope: { kind: 'merchant' as const, merchantId: 71 },
};
const ownerWhere = {
  MerchantId: 71,
  Merchant: {
    is: { UserId: 11, Status: 'active', User: { Status: 'active' } },
  },
  DeletedAt: null,
};

describe('RevenueService', () => {
  const findMany = vi.fn();
  const count = vi.fn();
  const aggregate = vi.fn();
  const groupBy = vi.fn();
  const resortFindFirst = vi.fn();
  const transaction = vi.fn();
  let service: RevenueService;

  beforeEach(() => {
    vi.clearAllMocks();
    const prisma = {
      resortRevenueRecord: { findMany, count, aggregate, groupBy },
      skiResort: { findFirst: resortFindFirst },
      $transaction: transaction,
    } as unknown as PrismaService;
    transaction.mockImplementation(
      (operations: Promise<unknown>[] | ((tx: PrismaService) => unknown)) =>
        Array.isArray(operations)
          ? Promise.all(operations)
          : operations(prisma),
    );
    service = new RevenueService(new PrismaRevenueRepository(prisma));
  });

  it('always filters merchant records through the server-owned resort profile', async () => {
    findMany.mockResolvedValue([]);
    count.mockResolvedValue(0);

    await service.merchantList(access, {
      resortId: 9,
      fromDate: '2026-10-01',
      toDate: '2026-10-28',
      page: 2,
      pageSize: 5,
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          Resort: { is: ownerWhere },
          ResortId: 9,
          ReportDate: {
            gte: new Date('2026-10-01T00:00:00.000Z'),
            lte: new Date('2026-10-28T00:00:00.000Z'),
          },
        },
        skip: 5,
        take: 5,
        orderBy: [{ ReportDate: 'desc' }, { RevenueId: 'desc' }],
      }),
    );
    expect(transaction).toHaveBeenCalledOnce();
    expect(transaction).toHaveBeenCalledWith(expect.any(Array), {
      isolationLevel: 'RepeatableRead',
    });
  });

  it('fails closed without a merchant profile', async () => {
    await expect(
      service.merchantList(
        { ...access, merchantId: null },
        { page: 1, pageSize: 20 },
      ),
    ).rejects.toMatchObject({
      status: 403,
    });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('rejects summary ranges that end before the requested start date', async () => {
    await expect(
      service.merchantSummary(access, {
        fromDate: '2999-01-01',
        page: 1,
        pageSize: 20,
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(aggregate).not.toHaveBeenCalled();
  });

  it('aggregates a bounded default month and returns decimal strings', async () => {
    aggregate.mockResolvedValue({
      _sum: { RevenueAmount: { toFixed: () => '24.50' } },
    });
    groupBy.mockResolvedValue([
      {
        ReportDate: new Date('2026-10-27T00:00:00.000Z'),
        _sum: { RevenueAmount: { toFixed: () => '24.50' } },
      },
    ]);
    resortFindFirst.mockResolvedValue({ ResortId: 9, Name: '雪场一号' });

    const result = await service.merchantSummary(access, {
      resortId: 9,
      page: 1,
      pageSize: 20,
    });

    expect(result).toMatchObject({
      resortId: 9,
      resortName: '雪场一号',
      toDate: expect.any(String),
      totalAmount: '24.50',
      daily: [{ date: '2026-10-27', amount: '24.50' }],
    });
    expect(aggregate.mock.calls[0][0].where).toMatchObject({
      Resort: { is: ownerWhere },
      ResortId: 9,
    });
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
  });

  it('imports rows independently, rejects repeated keys, and reports partial success', async () => {
    const upsert = vi.spyOn(service, 'upsert');
    upsert.mockImplementation(async (body) => {
      if (body.resortId === 8) throw new Error('database detail must not leak');
      return { revenueId: 501 } as never;
    });
    const csv = [
      'resortId,reportDate,revenueAmount,note',
      '7,2026-10-25,120.50,Weekend',
      '7,2026-10-25,121,Duplicate',
      '8,2026-10-26,99,Unknown resort',
      'bad,2026-10-27,1,Invalid ID',
    ].join('\n');

    await expect(
      service.importCsv(Buffer.from(csv, 'utf8'), {
        actorUserId: 42,
        traceId: 'trace-import',
        clientIp: null,
        userAgent: null,
      }),
    ).resolves.toEqual({
      totalRows: 4,
      succeededRows: 1,
      failedRows: 3,
      results: [
        { rowNumber: 2, success: true, revenueId: 501, error: null },
        {
          rowNumber: 3,
          success: false,
          revenueId: null,
          error: '同一批次包含重复雪场和日期',
        },
        {
          rowNumber: 4,
          success: false,
          revenueId: null,
          error: '数据保存失败',
        },
        {
          rowNumber: 5,
          success: false,
          revenueId: null,
          error: 'resortId 格式错误',
        },
      ],
    });
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenNthCalledWith(
      1,
      {
        resortId: 7,
        reportDate: '2026-10-25',
        revenueAmount: '120.50',
        note: 'Weekend',
      },
      'import',
      expect.objectContaining({ actorUserId: 42 }),
    );
  });

  it('rejects malformed UTF-8 and unexpected CSV headers before writes', async () => {
    await expect(
      service.importCsv(Buffer.from([0xc3, 0x28]), {
        actorUserId: 42,
        traceId: 'trace-invalid',
        clientIp: null,
        userAgent: null,
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.importCsv(Buffer.alloc(10 * 1024 * 1024 + 1), {
        actorUserId: 42,
        traceId: 'trace-oversize',
        clientIp: null,
        userAgent: null,
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.importCsv(Buffer.from('date,amount\n'), {
        actorUserId: 42,
        traceId: 'trace-header',
        clientIp: null,
        userAgent: null,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
  it('applies the same selected/owner intersection to rows, count, totals, timeline and resort name', async () => {
    findMany.mockResolvedValue([]);
    count.mockResolvedValue(0);
    aggregate.mockResolvedValue({ _sum: { RevenueAmount: null } });
    groupBy.mockResolvedValue([]);
    resortFindFirst.mockResolvedValue({ ResortId: 9, Name: 'Selected' });
    const selected = {
      ...access,
      scope: { kind: 'selected' as const, ids: [9, 10] },
    };
    await service.merchantList(selected, { page: 2, pageSize: 1 });
    await service.merchantSummary(selected, {
      resortId: 9,
      page: 1,
      pageSize: 20,
    });
    const where = {
      Resort: { is: { ...ownerWhere, ResortId: { in: [9, 10] } } },
    };
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where, skip: 1, take: 1 }),
    );
    expect(count).toHaveBeenCalledWith({ where });
    for (const call of [aggregate, groupBy])
      expect(call).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ ...where, ResortId: 9 }),
        }),
      );
    expect(resortFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          ...ownerWhere,
          ResortId: { in: [9, 10] },
          AND: [{ ResortId: 9 }],
        },
      }),
    );
  });

  it.each([
    undefined,
    { kind: 'self' as const, userId: 12 },
    { kind: 'selected' as const, ids: [] },
  ])(
    'rejects missing or invalid revenue scope before issuing queries: %j',
    async (scope) => {
      await expect(
        service.merchantList({ ...access, scope }, { page: 1, pageSize: 20 }),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        service.merchantSummary(
          { ...access, scope },
          { page: 1, pageSize: 20 },
        ),
      ).rejects.toMatchObject({ status: 403 });
      for (const call of [findMany, count, aggregate, groupBy, resortFindFirst])
        expect(call).not.toHaveBeenCalled();
    },
  );

  it('returns 404 without leaking a name when the requested resort is outside the intersection', async () => {
    aggregate.mockResolvedValue({ _sum: { RevenueAmount: null } });
    groupBy.mockResolvedValue([]);
    resortFindFirst.mockResolvedValue(null);
    await expect(
      service.merchantSummary(
        { ...access, scope: { kind: 'selected', ids: [10] } },
        { resortId: 9, page: 1, pageSize: 20 },
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(resortFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          ...ownerWhere,
          ResortId: { in: [10] },
          AND: [{ ResortId: 9 }],
        },
      }),
    );
  });
});

describe('Revenue persistence command and audit atomicity', () => {
  function setup() {
    const record = {
      RevenueId: 501,
      ResortId: 901,
      ReportDate: new Date('2026-10-29T00:00:00Z'),
      RevenueAmount: new Prisma.Decimal('9999999999.99'),
      Source: 'manual',
      Note: null,
      CreatedBy: 11,
      CreateTime: new Date('2026-10-29T00:00:00Z'),
      UpdateTime: new Date('2026-10-29T00:00:00Z'),
      Resort: { ResortId: 901, Name: 'Resort' },
      Creator: { UserId: 11, Nickname: 'Operator' },
    };
    const tx = {
      $queryRaw: vi.fn(async () => [{ ResortId: 901 }]),
      resortRevenueRecord: {
        findUnique: vi.fn(async () => null),
        upsert: vi.fn(async () => record),
      },
      user: {
        findUnique: vi.fn(async () => ({
          Account: 'operator',
          UserId: 11,
          Status: 'active',
          MerchantProfile: null,
          UserRoles: [
            {
              Role: {
                RoleKey: 'revenue_writer',
                Status: 'active',
                DataScope: 'all',
                DataScopes: [],
                RolePermissions: [
                  'management:portal:enter',
                  'revenue:system:upsert',
                ].map((PermissionKey) => ({
                  Permission: { PermissionKey, Status: 'active' },
                })),
              },
            },
          ],
        })),
      },
      operationLog: { create: vi.fn(async () => ({})) },
    };
    const prisma = {
      $transaction: vi.fn(async <T>(work: (tx: unknown) => Promise<T>) =>
        work(tx),
      ),
    };
    const repository = new PrismaRevenueRepository(
      prisma as unknown as PrismaService,
    );
    return { tx, prisma, repository };
  }
  const body = {
    resortId: 901,
    reportDate: '2026-10-29',
    revenueAmount: '9999999999.99',
  };
  const audit = {
    actorUserId: 11,
    traceId: 'revenue-adapter',
    clientIp: null,
    userAgent: null,
  };

  it('uses the unique resort/date key and writes decimal values plus actor audit in the same transaction', async () => {
    const { repository, prisma, tx } = setup();
    await expect(
      repository.upsert(body, 'manual', audit),
    ).resolves.toMatchObject({ revenueAmount: '9999999999.99', resortId: 901 });
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
    expect(tx.resortRevenueRecord.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          ResortId_ReportDate: {
            ResortId: 901,
            ReportDate: new Date('2026-10-29T00:00:00Z'),
          },
        },
        create: expect.objectContaining({
          CreatedBy: 11,
          RevenueAmount: new Prisma.Decimal('9999999999.99'),
        }),
      }),
    );
    expect(tx.operationLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ActorUserId: 11,
        ActorAccountSnapshot: 'operator',
        TraceId: audit.traceId,
        TargetId: '501',
        Metadata: expect.objectContaining({
          after: expect.objectContaining({ revenueAmount: '9999999999.99' }),
        }),
      }),
    });
  });

  it('rejects an unavailable resort before writing revenue or audit', async () => {
    const { repository, tx } = setup();
    tx.$queryRaw.mockResolvedValueOnce([]);
    await expect(
      repository.upsert(body, 'manual', audit),
    ).rejects.toMatchObject({ status: 422 });
    expect(tx.resortRevenueRecord.upsert).not.toHaveBeenCalled();
    expect(tx.operationLog.create).not.toHaveBeenCalled();
  });

  it('propagates audit failure out of the write transaction', async () => {
    const { repository, tx } = setup();
    tx.operationLog.create.mockRejectedValueOnce(new Error('audit failed'));
    await expect(repository.upsert(body, 'manual', audit)).rejects.toThrow(
      'audit failed',
    );
  });

  it('denies a disabled actor before locking or changing any business records', async () => {
    const { repository, tx } = setup();
    const actor = await tx.user.findUnique();
    tx.user.findUnique.mockResolvedValueOnce({ ...actor, Status: 'disabled' });
    await expect(
      repository.upsert(body, 'manual', audit),
    ).rejects.toMatchObject({ status: 403 });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.resortRevenueRecord.upsert).not.toHaveBeenCalled();
    expect(tx.operationLog.create).not.toHaveBeenCalled();
  });

  it.each(['40001', '40P01'])(
    'maps raw SQL concurrency error %s to a reload-required conflict',
    async (code) => {
      const { repository, tx } = setup();
      tx.$queryRaw.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('conflict', {
          clientVersion: '6.19.0',
          code: 'P2010',
          meta: { code },
        }),
      );
      await expect(
        new RevenueService(repository).upsert(body, 'manual', audit),
      ).rejects.toMatchObject({ status: 409 });
      expect(tx.resortRevenueRecord.upsert).not.toHaveBeenCalled();
      expect(tx.operationLog.create).not.toHaveBeenCalled();
    },
  );
});
