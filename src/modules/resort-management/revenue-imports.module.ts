import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../shared/persistence/database.module.js';
import { RevenueImportService } from './application/revenue-import.service.js';
import { REVENUE_IMPORT_REPOSITORY } from './application/ports/revenue-import-repository.js';
import { PrismaRevenueImportRepository } from './infrastructure/prisma-revenue-import.repository.js';
import { RevenueImportWorker } from './infrastructure/revenue-import.worker.js';

@Module({
  imports: [DatabaseModule],
  providers: [
    RevenueImportService,
    PrismaRevenueImportRepository,
    {
      provide: REVENUE_IMPORT_REPOSITORY,
      useExisting: PrismaRevenueImportRepository,
    },
    RevenueImportWorker,
  ],
  exports: [RevenueImportService],
})
export class RevenueImportsModule {}
