import type { AssetStorage } from './ports/asset-storage.js';

export interface AvatarOwner {
  UserId: number;
  Avatar: string | null;
  AvatarAsset?: {
    OwnerUserId: number;
    Status: string;
    StorageKey: string;
    MimeType: string;
  } | null;
}

export const avatarAssetSelect = {
  select: { OwnerUserId: true, Status: true, StorageKey: true, MimeType: true },
} as const;

export async function resolveAvatarUrl(
  storage: Pick<AssetStorage, 'createReadUrl'>,
  owner: AvatarOwner,
): Promise<string | null> {
  const asset = owner.AvatarAsset;
  if (asset) {
    if (
      asset.Status !== 'ready' ||
      asset.OwnerUserId !== owner.UserId ||
      !['image/jpeg', 'image/png', 'image/webp'].includes(asset.MimeType)
    )
      return null;
    return storage.createReadUrl(asset.StorageKey, 900);
  }
  return owner.Avatar;
}
