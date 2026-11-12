import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { PrismaLoginAttemptStore } from './prisma-login-attempt.store.js';

@Injectable()
export class LoginLimitRetentionWorker
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(LoginLimitRetentionWorker.name);
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  private stopped = false;
  constructor(private readonly store: PrismaLoginAttemptStore) {}
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
    this.running = this.store
      .purgeExpired()
      .then(
        () => undefined,
        () => {
          this.logger.error('Login limit retention sweep failed');
        },
      )
      .finally(() => {
        this.running = undefined;
      });
    return this.running;
  }
}
