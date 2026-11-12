import { RevenueService } from './revenue-service.js';
import type { RevenueRepository } from './ports/revenue-repository.js';
import type { RevenueRecordView } from './revenue-models.js';
import { RevenueWriteConflictError } from './revenue-errors.js';

const access = {
  userId: 11,
  merchantId: 27,
  scope: { kind: 'selected' as const, ids: [901] },
};
const audit = {
  actorUserId: 11,
  traceId: 'application-revenue',
  clientIp: null,
  userAgent: null,
};
function setup() {
  const repository = {
    adminPage: vi.fn(async () => ({ items: [], total: 0 })),
    upsertIdempotent: vi.fn(),
    requestResult: vi.fn(),
    findPage: vi.fn(async () => ({ items: [], total: 0 })),
    summarize: vi.fn(async () => ({
      resortId: null,
      resortName: null,
      totalAmount: '9999999999.99',
      daily: [],
    })),
    upsert: vi.fn(async () => ({ revenueId: 1 }) as RevenueRecordView),
  };
  return {
    repository,
    service: new RevenueService(repository satisfies RevenueRepository),
  };
}
describe('Revenue application through business ports', () => {
  it('passes the effective scope and normalized range to the repository without numeric conversion of money', async () => {
    const { service, repository } = setup();
    await service.merchantList(access, {
      page: 2,
      pageSize: 5,
      fromDate: '2026-10-01',
      toDate: '2026-10-29',
    });
    expect(repository.findPage).toHaveBeenCalledWith(access, {
      resortId: undefined,
      from: new Date('2026-10-01T00:00:00Z'),
      to: new Date('2026-10-29T00:00:00Z'),
      skip: 5,
      take: 5,
    });
    expect(
      await service.merchantSummary(access, {
        page: 1,
        pageSize: 20,
        fromDate: '2026-10-01',
        toDate: '2026-10-29',
      }),
    ).toMatchObject({
      totalAmount: '9999999999.99',
      fromDate: '2026-10-01',
      toDate: '2026-10-29',
    });
  });
  it('rejects missing scope and inverted dates before querying', async () => {
    const { service, repository } = setup();
    await expect(
      service.merchantList(
        { ...access, scope: undefined },
        { page: 1, pageSize: 20 },
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.merchantSummary(access, {
        page: 1,
        pageSize: 20,
        fromDate: '2026-10-29',
        toDate: '2026-10-01',
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(repository.findPage).not.toHaveBeenCalled();
    expect(repository.summarize).not.toHaveBeenCalled();
  });
  it('validates dates and money before the atomic write port', async () => {
    const { service, repository } = setup();
    for (const input of [
      { resortId: 901, reportDate: '2026-02-30', revenueAmount: '1.00' },
      { resortId: 901, reportDate: '2026-99-99', revenueAmount: '1.00' },
      { resortId: 2147483648, reportDate: '2026-10-01', revenueAmount: '1.00' },
      { resortId: 901, reportDate: '2026-10-01', revenueAmount: '1e6' },
      { resortId: 901, reportDate: '2026-10-01', revenueAmount: '1.001' },
    ])
      await expect(
        service.upsert(input, 'manual', audit),
      ).rejects.toMatchObject({ status: 422 });
    expect(repository.upsert).not.toHaveBeenCalled();
    const input = {
      resortId: 901,
      reportDate: '2026-10-01',
      revenueAmount: '9999999999.99',
    };
    await service.upsert(input, 'manual', audit);
    expect(repository.upsert).toHaveBeenCalledWith(input, 'manual', audit);
  });
  it('maps a concurrent write conflict to 409 without retrying the stale command', async () => {
    const { service, repository } = setup();
    repository.upsert.mockRejectedValueOnce(new RevenueWriteConflictError());
    await expect(
      service.upsert(
        { resortId: 901, reportDate: '2026-10-01', revenueAmount: '1.00' },
        'manual',
        audit,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(repository.upsert).toHaveBeenCalledOnce();
  });
  it('continues CSV imports after one failed atomic row and suppresses internal errors', async () => {
    const { service, repository } = setup();
    repository.upsert.mockRejectedValueOnce(
      new Error('sensitive database detail'),
    );
    const csv =
      'resortId,reportDate,revenueAmount,note\n901,2026-10-01,10,one\n901,2026-10-02,20,two';
    const result = await service.importCsv(Buffer.from(csv), audit);
    expect(result).toMatchObject({
      totalRows: 2,
      succeededRows: 1,
      failedRows: 1,
      results: [{ success: false }, { success: true, revenueId: 1 }],
    });
    expect(JSON.stringify(result)).not.toContain('sensitive');
    expect(repository.upsert).toHaveBeenCalledTimes(2);
  });
});
