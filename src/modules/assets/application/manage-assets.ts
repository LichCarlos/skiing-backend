import { randomUUID, createHash } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  ASSET_REPOSITORY,
  type AssetRepository,
  type AssetRecord,
} from './ports/asset-repository.js';
import { ASSET_STORAGE, type AssetStorage } from './ports/asset-storage.js';
import { ASSET_SCANNER, type AssetScanner } from './ports/asset-scanner.js';
import {
  detectSupportedImage,
  isValidAssetId,
  MAX_ASSET_BYTES,
} from '../domain/asset-rules.js';

const READ_URL_TTL_SECONDS = 15 * 60;

@Injectable()
export class ManageAssets {
  constructor(
    @Inject(ASSET_REPOSITORY) private readonly assets: AssetRepository,
    @Inject(ASSET_STORAGE) private readonly storage: AssetStorage,
    @Inject(ASSET_SCANNER) private readonly scanner: AssetScanner,
  ) {}

  async upload(input: {
    ownerUserId: number;
    originalName: string;
    buffer: Buffer;
  }) {
    if (!Buffer.isBuffer(input.buffer) || input.buffer.length === 0) {
      throw new BadRequestException('An image file is required');
    }
    if (input.buffer.length > MAX_ASSET_BYTES) {
      throw new BadRequestException('Image exceeds the 10 MiB limit');
    }
    const image = detectSupportedImage(input.buffer);
    if (!image)
      throw new BadRequestException(
        'Only JPEG, PNG, or WebP images are allowed',
      );

    const storageKey = `assets/${input.ownerUserId}/${randomUUID()}.${image.extension}`;
    const originalName = sanitizeOriginalName(input.originalName);
    const record = await this.assets.createPending({
      ownerUserId: input.ownerUserId,
      storageKey,
      originalName,
      mimeType: image.mimeType,
      sizeBytes: input.buffer.length,
      sha256: createHash('sha256').update(input.buffer).digest('hex'),
    });

    try {
      const scanResult = await this.scanner.scan(input.buffer);
      if (scanResult !== 'clean') {
        await this.assets.setStatus(record.assetId, 'rejected');
        throw new UnprocessableEntityException(
          'Image failed security scanning',
        );
      }
      await this.storage.put({
        key: storageKey,
        body: input.buffer,
        contentType: image.mimeType,
      });
      if (!(await this.assets.setStatus(record.assetId, 'ready'))) {
        throw new Error('Asset status changed while upload was processing');
      }
      return this.toVO({ ...record, status: 'ready' });
    } catch (error) {
      if (!(error instanceof UnprocessableEntityException)) {
        await this.assets
          .setStatus(record.assetId, 'rejected')
          .catch(() => undefined);
        await this.storage.remove(storageKey).catch(() => undefined);
        if (
          error instanceof BadRequestException ||
          error instanceof ForbiddenException
        )
          throw error;
        throw new ServiceUnavailableException(
          'Asset scanning or storage is unavailable',
        );
      }
      throw error;
    }
  }

  async get(assetId: string, ownerUserId: number) {
    this.assertAssetId(assetId);
    const record = await this.assets.findOwnedReady(
      assetId,
      ownerUserId,
      'read',
    );
    if (!record) throw new NotFoundException('Asset not found');
    const view = await this.toVO(record);
    // Signing is asynchronous and must not make a stale authorization or
    // deleted target visible in the response. Already issued URLs retain TTL.
    const current = await this.assets.findOwnedReady(
      assetId,
      ownerUserId,
      'read',
    );
    if (!current || current.storageKey !== record.storageKey)
      throw new NotFoundException('Asset not found');
    return view;
  }

  async remove(assetId: string, ownerUserId: number): Promise<void> {
    this.assertAssetId(assetId);
    const record = await this.assets.findOwnedReady(
      assetId,
      ownerUserId,
      'delete',
    );
    if (!record) throw new NotFoundException('Asset not found');
    const deleted = await this.assets.deleteIfUnreferenced(
      assetId,
      ownerUserId,
    );
    if (!deleted)
      throw new UnprocessableEntityException(
        'Referenced assets cannot be deleted',
      );
    try {
      await this.storage.remove(record.storageKey);
    } catch {
      throw new ServiceUnavailableException('Asset storage is unavailable');
    }
  }

  private async toVO(record: AssetRecord) {
    const url =
      record.status === 'ready'
        ? await this.storage.createReadUrl(
            record.storageKey,
            READ_URL_TTL_SECONDS,
          )
        : null;
    return {
      assetId: record.assetId,
      originalName: record.originalName,
      mimeType: record.mimeType,
      sizeBytes: record.sizeBytes,
      status: record.status,
      url,
      createdAt: record.createdAt.toISOString(),
    };
  }

  private assertAssetId(assetId: string): void {
    if (!isValidAssetId(assetId))
      throw new BadRequestException('Asset ID is invalid');
  }
}

function sanitizeOriginalName(originalName: string): string {
  const name = originalName
    .split('')
    .map((character) => {
      const code = character.charCodeAt(0);
      return character === '/' ||
        character === '\\' ||
        code < 32 ||
        code === 127
        ? '_'
        : character;
    })
    .join('')
    .trim()
    .slice(0, 255);
  return name || 'image';
}
