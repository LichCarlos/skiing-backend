import { PUBLIC_RESORT_READER } from './application/ports/public-resort-reader.js';
import { PrismaPublicResortReader } from './infrastructure/prisma-public-resort.reader.js';
import { ADMIN_RESORT_REPOSITORY } from './application/ports/admin-resort-repository.js';
import { PrismaAdminResortRepository } from './infrastructure/prisma-admin-resort.repository.js';
import { REVENUE_REPOSITORY } from './application/ports/revenue-repository.js';
import { PrismaRevenueRepository } from './infrastructure/prisma-revenue.repository.js';
import { RevenueRetentionWorker } from './infrastructure/revenue-retention.worker.js';
import { MERCHANT_RESORT_REPOSITORY } from './application/ports/merchant-resort-repository.js';
import { PrismaMerchantResortRepository } from './infrastructure/prisma-merchant-resort.repository.js';
import { Module } from '@nestjs/common';
import { RevenueImportsModule } from './revenue-imports.module.js';
import { DatabaseModule } from '../../shared/persistence/database.module.js';
import { AssetsModule } from '../assets/assets.module.js';
import { PlatformAdministrationModule } from '../platform-administration/platform-administration.module.js';
import { MerchantResortService } from './application/merchant-resort-service.js';
import { AdminResortService } from './application/admin-resort-service.js';
import { MerchantResortsController } from './presentation/http/merchant-resorts.controller.js';
import { AdminResortsController } from './presentation/http/admin-resorts.controller.js';
import { PublicResortService } from './application/public-resort-service.js';
import { PublicResortsController } from './presentation/http/public-resorts.controller.js';
import { IntegrationEventsModule } from '../integration-events/integration-events.module.js';
import { RevenueService } from './application/revenue-service.js';
import {
  AdminRevenueController,
  MerchantRevenueController,
} from './presentation/http/revenue.controller.js';

@Module({
  imports: [
    DatabaseModule,
    RevenueImportsModule,
    AssetsModule,
    PlatformAdministrationModule,
    IntegrationEventsModule,
  ],
  controllers: [
    MerchantResortsController,
    AdminResortsController,
    PublicResortsController,
    MerchantRevenueController,
    AdminRevenueController,
  ],
  providers: [
    { provide: PUBLIC_RESORT_READER, useClass: PrismaPublicResortReader },
    { provide: ADMIN_RESORT_REPOSITORY, useClass: PrismaAdminResortRepository },
    PrismaRevenueRepository,
    { provide: REVENUE_REPOSITORY, useExisting: PrismaRevenueRepository },
    RevenueRetentionWorker,
    {
      provide: MERCHANT_RESORT_REPOSITORY,
      useClass: PrismaMerchantResortRepository,
    },
    MerchantResortService,
    AdminResortService,
    PublicResortService,
    RevenueService,
  ],
})
export class ResortManagementModule {}
