export const ASSET_STORAGE = Symbol('ASSET_STORAGE');

export interface AssetStorage {
  put(input: { key: string; body: Buffer; contentType: string }): Promise<void>;
  remove(key: string): Promise<void>;
  createReadUrl(key: string, expiresInSeconds: number): Promise<string>;
}
