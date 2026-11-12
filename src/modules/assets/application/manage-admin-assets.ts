import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  ADMIN_ASSET_REPOSITORY,
  type AdminAssetRepository,
} from './ports/admin-asset-repository.js';
import { ASSET_STORAGE, type AssetStorage } from './ports/asset-storage.js';
import { isValidAssetId } from '../domain/asset-rules.js';
import type { AdminAssetAccess } from '../domain/admin-asset-access.js';

@Injectable()
export class ManageAdminAssets {
  constructor(
    @Inject(ADMIN_ASSET_REPOSITORY)
    private readonly assets: AdminAssetRepository,
    @Inject(ASSET_STORAGE) private readonly storage: AssetStorage,
  ) {}

  async list(
    input: {
      page?: unknown;
      pageSize?: unknown;
      status?: unknown;
      ownerUserId?: unknown;
      keyword?: unknown;
    },
    access: AdminAssetAccess,
    actorUserId: number,
  ) {
    const page = parseInt(input.page, 1, 1, Number.MAX_SAFE_INTEGER);
    const pageSize = parseInt(input.pageSize, 20, 1, 100);
    const ownerUserId =
      input.ownerUserId === undefined || input.ownerUserId === ''
        ? undefined
        : parseInt(input.ownerUserId, 0, 1, 2_147_483_647);
    const status = parseOptionalString(input.status, 20);
    const keyword = parseOptionalString(input.keyword, 100);
    const skip = (page - 1) * pageSize;
    if (!Number.isSafeInteger(skip) || skip > 2_147_483_647) {
      throw new BadRequestException('Asset pagination offset is too large');
    }
    await this.assets.verifyReadAccess({ actorUserId, access, assets: [] });
    const result = await this.assets.findPage({
      access,
      skip,
      take: pageSize,
      ...(status ? { status } : {}),
      ...(ownerUserId ? { ownerUserId } : {}),
      ...(keyword ? { keyword } : {}),
    });
    const items = await Promise.all(
      result.items.map((item) => this.toVO(item)),
    );
    await this.assets.verifyReadAccess({
      actorUserId,
      access,
      assets: result.items,
    });
    return {
      items,
      total: result.total,
      page,
      pageSize,
      hasNext: page * pageSize < result.total,
    };
  }

  async get(assetId: string, access: AdminAssetAccess, actorUserId: number) {
    assertAssetId(assetId);
    await this.assets.verifyReadAccess({ actorUserId, access, assets: [] });
    const asset = await this.assets.findById(assetId, access);
    if (!asset) throw new NotFoundException('Asset not found');
    const view = await this.toVO(asset);
    await this.assets.verifyReadAccess({
      actorUserId,
      access,
      assets: [asset],
    });
    return view;
  }

  async remove(
    assetId: string,
    audit: {
      actorUserId: number;
      traceId: string;
      clientIp: string | null;
      userAgent: string | null;
    },
    access: AdminAssetAccess,
  ): Promise<void> {
    assertAssetId(assetId);
    const asset = await this.assets.findById(assetId, access);
    if (!asset) throw new NotFoundException('Asset not found');
    if (Object.values(asset.references).some((value) => value > 0)) {
      throw new UnprocessableEntityException(
        'Referenced assets cannot be deleted',
      );
    }
    const result = await this.assets.deleteIfUnreferencedAdmin({
      assetId,
      access,
      ...audit,
    });
    if (result === 'not_found') throw new NotFoundException('Asset not found');
    if (result !== 'deleted') {
      throw new UnprocessableEntityException(
        'Referenced assets cannot be deleted',
      );
    }
    await this.storage.remove(asset.storageKey).catch(() => undefined);
  }

  private async toVO(
    asset: Awaited<ReturnType<AdminAssetRepository['findById']>> extends infer T
      ? Exclude<T, null>
      : never,
  ) {
    const url =
      asset.status === 'ready'
        ? await this.storage.createReadUrl(asset.storageKey, 900)
        : null;
    return {
      assetId: asset.assetId,
      ownerUserId: asset.ownerUserId,
      ownerAccount: asset.ownerAccount,
      originalName: asset.originalName,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      status: asset.status,
      url,
      references: asset.references,
      createdAt: asset.createdAt.toISOString(),
    };
  }
}

function parseInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new BadRequestException('Invalid asset pagination or owner filter');
  }
  return parsed;
}

function parseOptionalString(value: unknown, max: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.trim().length > max) {
    throw new BadRequestException('Invalid asset filter');
  }
  return value.trim();
}

function assertAssetId(assetId: string): void {
  if (!isValidAssetId(assetId)) {
    throw new BadRequestException('Asset ID is invalid');
  }
}
