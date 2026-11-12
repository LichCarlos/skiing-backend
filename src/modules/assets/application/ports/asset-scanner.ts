export const ASSET_SCANNER = Symbol('ASSET_SCANNER');

export interface AssetScanner {
  scan(buffer: Buffer): Promise<'clean' | 'infected'>;
}
