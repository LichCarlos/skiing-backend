import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { RevenueImportService } from '../application/revenue-import.service.js';

@Injectable()
export class RevenueImportWorker
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(RevenueImportWorker.name);
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  private stopped = false;
  private ticks = 0;
  constructor(private readonly imports: RevenueImportService) {}
  onApplicationBootstrap() {
    if (
      process.env.NODE_ENV === 'test' ||
      process.env.OPENAPI_EXPORT === 'true'
    )
      return;
    this.timer = setInterval(() => void this.tick(), 1000);
    this.timer.unref();
    void this.tick();
  }
  async onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }
  tick(): Promise<void> {
    if (this.stopped || this.running) return this.running ?? Promise.resolve();
    this.running = this.work().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }
  private async work() {
    try {
      await this.imports.recover();
      if (this.ticks++ % 60 === 0) await this.imports.retain();
    } catch {
      this.logger.error('Revenue import recovery cycle failed');
    }
  }
}
