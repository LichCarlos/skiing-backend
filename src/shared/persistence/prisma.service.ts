import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnApplicationShutdown
{
  // Keep persistence available through worker draining and HTTP server disposal.
  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
  }
}
