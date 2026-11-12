export const ASSET_REPOSITORY = Symbol('ASSET_REPOSITORY');

export interface AssetRecord {
  assetId: string;
  ownerUserId: number;
  storageKey: string;
  originalName: string;
  mimeType: string;
  sizeBytes: string;
  status: 'pending_scan' | 'ready' | 'rejected' | 'deleted';
  createdAt: Date;
}

export interface AssetRepository {
  createPending(input: {
    ownerUserId: number;
    storageKey: string;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
  }): Promise<AssetRecord>;
  setStatus(assetId: string, status: 'ready' | 'rejected'): Promise<boolean>;
  findOwnedReady(
    assetId: string,
    ownerUserId: number,
    operation: 'read' | 'delete',
  ): Promise<AssetRecord | null>;
  deleteIfUnreferenced(assetId: string, ownerUserId: number): Promise<boolean>;
}
