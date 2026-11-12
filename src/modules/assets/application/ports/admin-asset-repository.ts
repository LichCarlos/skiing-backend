import type { AssetRecord } from './asset-repository.js';
import type { AdminAssetAccess } from '../../domain/admin-asset-access.js';

export const ADMIN_ASSET_REPOSITORY = Symbol('ADMIN_ASSET_REPOSITORY');

export interface AdminAssetRecord extends AssetRecord {
  ownerAccount: string;
  references: {
    coverResorts: number;
    resortImages: number;
    articleCovers: number;
    dynamicImages: number;
    userAvatars: number;
  };
}

export interface AdminAssetRepository {
  verifyReadAccess(input: {
    actorUserId: number;
    access: AdminAssetAccess;
    assets: readonly AdminAssetRecord[];
  }): Promise<void>;
  findPage(input: {
    access: AdminAssetAccess;
    skip: number;
    take: number;
    status?: string;
    ownerUserId?: number;
    keyword?: string;
  }): Promise<{ items: AdminAssetRecord[]; total: number }>;
  findById(
    assetId: string,
    access: AdminAssetAccess,
  ): Promise<AdminAssetRecord | null>;
  deleteIfUnreferencedAdmin(input: {
    access: AdminAssetAccess;
    assetId: string;
    actorUserId: number;
    traceId: string;
    clientIp: string | null;
    userAgent: string | null;
  }): Promise<'deleted' | 'not_found' | 'referenced'>;
}
