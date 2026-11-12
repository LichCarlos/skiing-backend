import { RevenueImportWorker } from './revenue-import.worker.js';
import type { RevenueImportService } from '../application/revenue-import.service.js';
describe('Revenue import recovery worker', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });
  function setup() {
    const service = {
      recover: vi.fn(async () => {}),
      retain: vi.fn(async () => {}),
    };
    return {
      service,
      worker: new RevenueImportWorker(
        service as unknown as RevenueImportService,
      ),
    };
  }
  it('recovers at startup and each second, retaining terminal records periodically', async () => {
    vi.useFakeTimers();
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('OPENAPI_EXPORT', 'false');
    const { service, worker } = setup();
    worker.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(60000);
    expect(service.recover).toHaveBeenCalledTimes(61);
    expect(service.retain).toHaveBeenCalledTimes(2);
    await worker.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(1000);
    expect(service.recover).toHaveBeenCalledTimes(61);
  });
  it.each(['test', 'export'])('does not start for %s', async (mode) => {
    vi.stubEnv('NODE_ENV', mode === 'test' ? 'test' : 'development');
    vi.stubEnv('OPENAPI_EXPORT', mode === 'export' ? 'true' : 'false');
    const { service, worker } = setup();
    worker.onApplicationBootstrap();
    await worker.onModuleDestroy();
    expect(service.recover).not.toHaveBeenCalled();
  });
  it('does not overlap recovery and waits for its own work on shutdown', async () => {
    const { service, worker } = setup();
    let finish!: () => void;
    service.recover.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const first = worker.tick();
    const second = worker.tick();
    expect(first).toBe(second);
    const shutdown = worker.onModuleDestroy();
    finish();
    await Promise.all([first, shutdown]);
    await worker.tick();
    expect(service.recover).toHaveBeenCalledTimes(1);
  });
});
