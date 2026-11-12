import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { PrismaRevenueRepository } from './prisma-revenue.repository.js';

@Injectable()
export class RevenueRetentionWorker
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(RevenueRetentionWorker.name);
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  private stopped = false;
  constructor(private readonly revenue: PrismaRevenueRepository) {}
  onApplicationBootstrap() {
    if (
      this.stopped ||
      this.timer ||
      process.env.NODE_ENV === 'test' ||
      process.env.OPENAPI_EXPORT === 'true'
    )
      return;
    this.timer = setInterval(() => void this.sweep(), 60_000);
    this.timer.unref();
    void this.sweep();
  }
  async onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }
  sweep(): Promise<void> {
    if (this.stopped || this.running) return this.running ?? Promise.resolve();
    this.running = this.work().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }
  private async work() {
    try {
      await this.revenue.purgeExpiredResults();
    } catch {
      this.logger.error('Revenue result retention sweep failed');
    }
  }
}
