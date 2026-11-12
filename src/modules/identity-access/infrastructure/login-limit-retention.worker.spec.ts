import { LoginLimitRetentionWorker } from './login-limit-retention.worker.js';
import type { PrismaLoginAttemptStore } from './prisma-login-attempt.store.js';

describe('login bucket cleanup lifecycle', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });
  const setup = () => {
    const purgeExpired = vi.fn(async () => 0);
    return {
      purgeExpired,
      worker: new LoginLimitRetentionWorker({
        purgeExpired,
      } as unknown as PrismaLoginAttemptStore),
    };
  };
  it('runs at startup and every minute, stops on shutdown', async () => {
    vi.useFakeTimers();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('OPENAPI_EXPORT', 'false');
    const { worker, purgeExpired } = setup();
    worker.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(60000);
    expect(purgeExpired).toHaveBeenCalledTimes(2);
    await worker.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(60000);
    expect(purgeExpired).toHaveBeenCalledTimes(2);
  });
  it('drains in-flight cleanup and prevents overlap and work after shutdown', async () => {
    const { worker, purgeExpired } = setup();
    let release!: () => void;
    purgeExpired.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(0);
        }),
    );
    const work = worker.sweep();
    expect(worker.sweep()).toBe(work);
    let stopped = false;
    const close = worker.onModuleDestroy().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    release();
    await Promise.all([work, close]);
    await worker.sweep();
    expect(purgeExpired).toHaveBeenCalledOnce();
  });
  it('handles storage failures without unhandled background rejections', async () => {
    const { worker, purgeExpired } = setup();
    purgeExpired.mockRejectedValueOnce(new Error('private'));
    await expect(worker.sweep()).resolves.toBeUndefined();
    await worker.sweep();
    expect(purgeExpired).toHaveBeenCalledTimes(2);
  });
});
