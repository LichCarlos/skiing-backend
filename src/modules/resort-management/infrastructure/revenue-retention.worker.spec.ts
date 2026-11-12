import { RevenueRetentionWorker } from './revenue-retention.worker.js';
import type { PrismaRevenueRepository } from './prisma-revenue.repository.js';

describe('Revenue result retention lifecycle', () => {
  it('drains the active sweep and rejects further sweeps after shutdown starts', async () => {
    const { worker, purgeExpiredResults } = setup();
    let release!: () => void;
    purgeExpiredResults.mockImplementationOnce(
      () =>
        new Promise<number>((resolve) => {
          release = () => resolve(1);
        }),
    );
    const sweep = worker.sweep();
    let closed = false;
    const shutdown = Promise.resolve(worker.onModuleDestroy()).then(() => {
      closed = true;
    });
    try {
      await Promise.resolve();
      await Promise.resolve();
      expect(closed).toBe(false);
    } finally {
      release();
      await Promise.all([sweep, shutdown]);
    }
    await worker.sweep();
    expect(purgeExpiredResults).toHaveBeenCalledTimes(1);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });
  function setup() {
    const purgeExpiredResults = vi.fn(async () => 0);
    const worker = new RevenueRetentionWorker({
      purgeExpiredResults,
    } as unknown as PrismaRevenueRepository);
    return { worker, purgeExpiredResults };
  }
  it('sweeps at startup and every minute, stopping its own timer on shutdown', async () => {
    vi.useFakeTimers();
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('OPENAPI_EXPORT', 'false');
    const { worker, purgeExpiredResults } = setup();
    worker.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(purgeExpiredResults).toHaveBeenCalledTimes(2);
    await worker.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(purgeExpiredResults).toHaveBeenCalledTimes(2);
  });
  it.each(['test', 'export'])(
    'does not mutate storage during %s runs',
    async (mode) => {
      vi.stubEnv('NODE_ENV', mode === 'test' ? 'test' : 'development');
      vi.stubEnv('OPENAPI_EXPORT', mode === 'export' ? 'true' : 'false');
      const { worker, purgeExpiredResults } = setup();
      worker.onApplicationBootstrap();
      await worker.onModuleDestroy();
      expect(purgeExpiredResults).not.toHaveBeenCalled();
    },
  );
  it('does not overlap sweeps and releases the gate after an infrastructure failure', async () => {
    const { worker, purgeExpiredResults } = setup();
    let reject!: (reason: Error) => void;
    purgeExpiredResults.mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    const first = worker.sweep();
    const second = worker.sweep();
    expect(first).toBe(second);
    expect(purgeExpiredResults).toHaveBeenCalledTimes(1);
    reject(new Error('database unavailable'));
    await Promise.all([first, second]);
    await worker.sweep();
    expect(purgeExpiredResults).toHaveBeenCalledTimes(2);
  });
});
