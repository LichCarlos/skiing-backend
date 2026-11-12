import { describe, expect, it } from 'vitest';
import {
  detectSupportedImage,
  isValidAssetId,
  MAX_ASSET_BYTES,
} from './asset-rules.js';

describe('asset rules', () => {
  it('recognizes only JPEG, PNG, and WebP signatures', () => {
    expect(
      detectSupportedImage(Buffer.from([0xff, 0xd8, 0xff, 0x00]))?.mimeType,
    ).toBe('image/jpeg');
    expect(
      detectSupportedImage(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        ?.mimeType,
    ).toBe('image/png');
    expect(
      detectSupportedImage(Buffer.from('RIFF0000WEBP', 'ascii'))?.mimeType,
    ).toBe('image/webp');
    expect(detectSupportedImage(Buffer.from('<svg/>'))).toBeNull();
  });

  it('enforces the 10 MiB limit and decimal asset IDs', () => {
    expect(MAX_ASSET_BYTES).toBe(10 * 1024 * 1024);
    expect(isValidAssetId('1')).toBe(true);
    expect(isValidAssetId('01')).toBe(false);
    expect(isValidAssetId('-1')).toBe(false);
    expect(isValidAssetId('9223372036854775807')).toBe(true);
    expect(isValidAssetId('9223372036854775808')).toBe(false);
    expect(isValidAssetId('9999999999999999999')).toBe(false);
  });
});
