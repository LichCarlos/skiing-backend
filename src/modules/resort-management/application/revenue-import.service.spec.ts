import { RevenueImportService } from './revenue-import.service.js';
import { prepareRevenueCsv } from './prepare-revenue-csv.js';
import { RevenueImportEventHandler } from './revenue-import-event-handler.js';
import type { RevenueImportRepository } from './ports/revenue-import-repository.js';
import type { InboxLease } from '../../integration-events/application/ports/inbox-lease.js';

const jobId = '08d89a59-3814-42b0-b7d8-e51dcad22843';
const claim = { jobId, lockToken: jobId };
const audit = {
  actorUserId: 1,
  traceId: 'import',
  clientIp: null,
  userAgent: null,
};
const header = 'resortId,reportDate,revenueAmount,note';
function setup() {
  const jobs = {
    create: vi.fn(),
    find: vi.fn(),
    claim: vi.fn(async () => claim),
    processOne: vi.fn(
      async () => 'processed' as 'processed' | 'completed' | 'lost',
    ),
    release: vi.fn(),
    defer: vi.fn(),
    ready: vi.fn(async () => [jobId]),
    retain: vi.fn(),
  };
  return {
    jobs,
    service: new RevenueImportService(jobs satisfies RevenueImportRepository),
  };
}
describe('Revenue CSV preparation', () => {
  it('prevalidates the full file and normalizes valid rows with BOM/quotes', () => {
    const result = prepareRevenueCsv(
      Buffer.from(
        `\uFEFF${header}\r\n9,2026-10-01,0.10,"雪场,说明"\r\n9,2026-10-01,9,duplicate\r\n9,2026-10-02,1,"one\ntwo"`,
      ),
    );
    expect(result).toMatchObject([
      {
        rowNumber: 2,
        input: { resortId: 9, revenueAmount: '0.10', note: '雪场,说明' },
        error: null,
      },
      { rowNumber: 3, input: null, error: '同一批次包含重复雪场和日期' },
      { rowNumber: 4, input: { note: 'one\ntwo' } },
    ]);
  });
  it.each([
    ['bad,2026-01-01,1,n', 'resortId 格式错误'],
    ['2147483648,2026-01-01,1,n', 'resortId 格式错误'],
    ['9,2026-02-30,1,n', 'reportDate 格式错误'],
    ['9,2026-01-01,1e3,n', 'revenueAmount 格式错误'],
    ['9,2026-01-01,1.001,n', 'revenueAmount 格式错误'],
    [`9,2026-01-01,1,${'n'.repeat(301)}`, 'note 不能超过 300 字符'],
    ['9,2026-01-01,1,n,extra', '列数必须为 4'],
  ])('records a sanitized row rejection: %s', (line, error) => {
    expect(prepareRevenueCsv(Buffer.from(`${header}\n${line}`))).toEqual([
      { rowNumber: 2, input: null, error },
    ]);
  });
  it.each([
    Buffer.from('date,amount\n'),
    Buffer.from(`${header}\n"unterminated`),
    Buffer.from([0xc3, 0x28]),
    Buffer.alloc(10 * 1024 * 1024 + 1),
    Buffer.from(`${header}\n${'bad,2026-01-01,1,n\n'.repeat(5001)}`),
  ])('rejects malformed whole input before persistence', (bytes) => {
    expect(() => prepareRevenueCsv(bytes)).toThrow();
  });
});
describe('Revenue durable import application', () => {
  it('binds the exact file bytes to SHA-256 and lowercases the request key', async () => {
    const { jobs, service } = setup();
    const bytes = Buffer.from(`${header}\n9,2026-10-01,1,n`);
    await service.create(bytes, jobId.toUpperCase(), audit);
    expect(jobs.create).toHaveBeenCalledWith(
      jobId,
      expect.stringMatching(/^[a-f0-9]{64}$/),
      expect.any(Array),
      audit,
    );
    const first = jobs.create.mock.calls[0]?.[1];
    await service.create(
      Buffer.concat([Buffer.from('\uFEFF'), bytes]),
      jobId,
      audit,
    );
    expect(jobs.create.mock.calls[1]?.[1]).not.toBe(first);
  });
  it('never persists invalid UUID or invalid whole-file syntax', () => {
    const { jobs, service } = setup();
    expect(() =>
      service.create(Buffer.from(header), undefined, audit),
    ).toThrow();
    expect(() => service.create(Buffer.from('bad'), jobId, audit)).toThrow();
    expect(jobs.create).not.toHaveBeenCalled();
  });
  it('limits one delivery to 25 row transactions and releases for recovery', async () => {
    const { jobs, service } = setup();
    await service.run(jobId);
    expect(jobs.processOne).toHaveBeenCalledTimes(25);
    expect(jobs.release).toHaveBeenCalledWith(claim);
    expect(jobs.defer).not.toHaveBeenCalled();
  });
  it.each(['completed', 'lost'] as const)(
    'stops at %s without releasing another lease',
    async (result) => {
      const { jobs, service } = setup();
      jobs.processOne.mockResolvedValueOnce(result);
      await service.run(jobId);
      expect(jobs.processOne).toHaveBeenCalledTimes(1);
      expect(jobs.release).not.toHaveBeenCalled();
    },
  );
  it('records durable backoff on failure and never loops failed writes automatically', async () => {
    const { jobs, service } = setup();
    jobs.processOne.mockRejectedValueOnce(new Error('db unavailable'));
    await expect(service.run(jobId)).rejects.toThrow();
    expect(jobs.processOne).toHaveBeenCalledTimes(1);
    expect(jobs.defer).toHaveBeenCalledWith(claim);
  });
  it('does not process an already claimed or terminal job', async () => {
    const { jobs, service } = setup();
    jobs.claim.mockResolvedValueOnce(null as never);
    await expect(service.run(jobId)).resolves.toBe(false);
    expect(jobs.processOne).not.toHaveBeenCalled();
  });
  it('continues recovery to another job after one infrastructure failure', async () => {
    const { jobs, service } = setup();
    jobs.ready.mockResolvedValueOnce([jobId, jobId]);
    jobs.processOne
      .mockRejectedValueOnce(new Error('db'))
      .mockResolvedValueOnce('completed');
    await service.recover();
    expect(jobs.claim).toHaveBeenCalledTimes(2);
    expect(jobs.defer).toHaveBeenCalledTimes(1);
  });
});
describe('Revenue import Kafka Inbox', () => {
  const event = {
    eventId: jobId,
    eventType: 'revenue.import.requested.v1',
    aggregateType: 'revenue_import',
    aggregateId: jobId,
    occurredAt: new Date(),
    payload: { jobId },
  };
  function handler() {
    const inbox = {
      claim: vi.fn(async () => ({ lockToken: jobId })),
      complete: vi.fn(async () => true),
      release: vi.fn(),
      isProcessed: vi.fn(async () => false),
    };
    const imports = { run: vi.fn() };
    return {
      inbox,
      imports,
      handler: new RevenueImportEventHandler(
        inbox as unknown as InboxLease,
        imports as unknown as RevenueImportService,
      ),
    };
  }
  it('dispatches a bounded slice and records completion only afterward', async () => {
    const h = handler();
    await h.handler.handle(event);
    expect(h.imports.run).toHaveBeenCalledWith(jobId);
    expect(h.inbox.complete).toHaveBeenCalledTimes(1);
    expect(h.inbox.release).not.toHaveBeenCalled();
  });
  it('ignores non-import events', async () => {
    const h = handler();
    await expect(
      h.handler.handle({ ...event, eventType: 'resort.changed.v1' }),
    ).resolves.toBe(false);
    expect(h.inbox.claim).not.toHaveBeenCalled();
  });
  it.each([{ jobId, csv: 'secret' }, { jobId: 'invalid' }])(
    'rejects unexpected payload %j',
    async (payload) => {
      const h = handler();
      await expect(
        h.handler.handle({
          ...event,
          payload: payload as typeof event.payload,
        }),
      ).rejects.toThrow();
      expect(h.inbox.claim).not.toHaveBeenCalled();
    },
  );
  it('skips completed duplicate events but refuses to acknowledge another live Inbox lease', async () => {
    const h = handler();
    h.inbox.claim.mockResolvedValue(null as never);
    await expect(h.handler.handle(event)).rejects.toThrow('busy');
    h.inbox.isProcessed.mockResolvedValue(true);
    await expect(h.handler.handle(event)).resolves.toBe(false);
    expect(h.imports.run).not.toHaveBeenCalled();
  });
  it('releases the original Inbox lease after processing fails', async () => {
    const h = handler();
    h.imports.run.mockRejectedValueOnce(new Error('db'));
    await expect(h.handler.handle(event)).rejects.toThrow();
    expect(h.inbox.release).toHaveBeenCalledTimes(1);
    expect(h.inbox.complete).not.toHaveBeenCalled();
  });
});
