import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OutboxDeliveryService } from '../application/outbox-delivery.service.js';

@Injectable()
export class OutboxPollingWorker
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(OutboxPollingWorker.name);
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  private stopped = false;

  constructor(
    private readonly config: ConfigService,
    private readonly delivery: OutboxDeliveryService,
  ) {}

  onApplicationBootstrap(): void {
    if (
      this.stopped ||
      this.timer ||
      this.config.get<string>('OUTBOX_DISPATCH_ENABLED') !== 'true' ||
      process.env.NODE_ENV === 'test' ||
      process.env.OPENAPI_EXPORT === 'true'
    ) {
      return;
    }

    const interval = positiveInteger(
      this.config.get<string>('OUTBOX_POLL_INTERVAL_MS'),
      1_000,
    );
    this.timer = setInterval(() => void this.dispatch(), interval);
    this.timer.unref();
    void this.dispatch();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }

  private dispatch(): Promise<void> {
    if (this.stopped || this.running) return this.running ?? Promise.resolve();
    this.running = this.work().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private async work(): Promise<void> {
    try {
      const result = await this.delivery.dispatchBatch();
      if (result.claimed > 0) {
        this.logger.debug(JSON.stringify(result));
      }
    } catch (error) {
      const detail = error instanceof Error ? error.stack : String(error);
      this.logger.error('Outbox dispatch cycle failed', detail);
    }
  }
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
