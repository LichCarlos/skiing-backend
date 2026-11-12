import { ConfigService } from '@nestjs/config';
import { OutboxPollingWorker } from './outbox-polling.worker.js';
import type { OutboxDeliveryService } from '../application/outbox-delivery.service.js';

describe('Outbox polling lifecycle', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });
  function setup() {
    const dispatchBatch = vi.fn(async () => ({
      claimed: 0,
      published: 0,
      scheduled: 0,
      failed: 0,
    }));
    const worker = new OutboxPollingWorker(
      new ConfigService({ OUTBOX_DISPATCH_ENABLED: 'true' }),
      { dispatchBatch } as unknown as OutboxDeliveryService,
    );
    return { worker, dispatchBatch };
  }

  it('waits for an in-flight dispatch and prevents new work during shutdown', async () => {
    vi.useFakeTimers();
    vi.stubEnv('NODE_ENV', 'development');
    const { worker, dispatchBatch } = setup();
    let release!: () => void;
    dispatchBatch.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { claimed: 1, published: 1, scheduled: 0, failed: 0 };
    });
    worker.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(dispatchBatch).toHaveBeenCalledTimes(1);
    let closed = false;
    const shutdown = Promise.resolve(worker.onModuleDestroy()).then(() => {
      closed = true;
    });
    try {
      await vi.advanceTimersByTimeAsync(3_000);
      expect(closed).toBe(false);
    } finally {
      release();
      await shutdown;
    }
    await vi.advanceTimersByTimeAsync(3_000);
    expect(dispatchBatch).toHaveBeenCalledTimes(1);
  });

  it.each(['test', 'export', 'disabled'])(
    'does not dispatch during %s',
    async (mode) => {
      vi.useFakeTimers();
      vi.stubEnv('NODE_ENV', mode === 'test' ? 'test' : 'development');
      vi.stubEnv('OPENAPI_EXPORT', mode === 'export' ? 'true' : 'false');
      const dispatchBatch = vi.fn();
      const worker = new OutboxPollingWorker(
        new ConfigService({
          OUTBOX_DISPATCH_ENABLED: mode === 'disabled' ? 'false' : 'true',
        }),
        { dispatchBatch } as unknown as OutboxDeliveryService,
      );
      worker.onApplicationBootstrap();
      await vi.advanceTimersByTimeAsync(2_000);
      await worker.onModuleDestroy();
      expect(dispatchBatch).not.toHaveBeenCalled();
    },
  );

  it('continues polling after a delivery cycle fails', async () => {
    vi.useFakeTimers();
    vi.stubEnv('NODE_ENV', 'development');
    const { worker, dispatchBatch } = setup();
    dispatchBatch.mockRejectedValueOnce(new Error('database unavailable'));
    worker.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(1_000);
    await worker.onModuleDestroy();
    expect(dispatchBatch).toHaveBeenCalledTimes(2);
  });
});
