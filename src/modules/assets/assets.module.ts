import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../shared/persistence/database.module.js';
import { ASSET_REPOSITORY } from './application/ports/asset-repository.js';
import { ADMIN_ASSET_REPOSITORY } from './application/ports/admin-asset-repository.js';
import { ASSET_SCANNER } from './application/ports/asset-scanner.js';
import { ASSET_STORAGE } from './application/ports/asset-storage.js';
import { ManageAssets } from './application/manage-assets.js';
import { ManageAdminAssets } from './application/manage-admin-assets.js';
import { ClamAvAssetScanner } from './infrastructure/clamav-asset-scanner.js';
import { PrismaAssetRepository } from './infrastructure/prisma-asset.repository.js';
import { S3AssetStorage } from './infrastructure/s3-asset-storage.js';
import { AssetsController } from './presentation/http/assets.controller.js';
import { AdminAssetsController } from './presentation/http/admin-assets.controller.js';

@Module({
  imports: [DatabaseModule],
  controllers: [AssetsController, AdminAssetsController],
  providers: [
    ManageAssets,
    ManageAdminAssets,
    PrismaAssetRepository,
    S3AssetStorage,
    ClamAvAssetScanner,
    { provide: ASSET_REPOSITORY, useExisting: PrismaAssetRepository },
    { provide: ADMIN_ASSET_REPOSITORY, useExisting: PrismaAssetRepository },
    { provide: ASSET_STORAGE, useExisting: S3AssetStorage },
    { provide: ASSET_SCANNER, useExisting: ClamAvAssetScanner },
  ],
  exports: [ASSET_STORAGE],
})
export class AssetsModule {}
