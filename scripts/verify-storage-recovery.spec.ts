import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  completeRecoveryReport,
  inspectRecoverySnapshot,
  newRecoveryReport,
  storageRecoverySettings,
  type RecoveryAsset,
  type RecoveryReference,
  type ObjectReader,
} from './verify-storage-recovery.js';

const image = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const asset = (overrides: Partial<RecoveryAsset> = {}): RecoveryAsset => ({
  AssetId: 1n,
  OwnerUserId: 1,
  StorageKey: 'private/user-image',
  MimeType: 'image/png',
  SizeBytes: BigInt(image.length),
  Sha256: createHash('sha256').update(image).digest('hex'),
  Status: 'ready',
  UpdateTime: new Date('2026-11-04T00:00:00Z'),
  ...overrides,
});
const snapshot = (assets: RecoveryAsset[], refs: RecoveryReference[] = []) => ({
  async *assets() {
    yield* assets;
  },
  async *references() {
    yield* refs;
  },
});
const validReader: ObjectReader = () =>
  Promise.resolve({
    body: Readable.from([image]),
    contentType: 'image/png',
    contentLength: image.length,
  });
async function audit(
  assets: RecoveryAsset[],
  reader = validReader,
  refs: RecoveryReference[] = [],
) {
  const report = newRecoveryReport(),
    view = snapshot(assets, refs);
  report.beforeFingerprint = await inspectRecoverySnapshot(
    view,
    report,
    AbortSignal.timeout(1000),
    reader,
  );
  report.afterFingerprint = await inspectRecoverySnapshot(
    view,
    report,
    AbortSignal.timeout(1000),
  );
  completeRecoveryReport(report);
  return report;
}
describe('read-only storage recovery verification', () => {
  it('checks referenced and unreferenced ready assets and all five reference kinds', async () => {
    const refs = [
      'avatar',
      'resort_cover',
      'resort_image',
      'article_cover',
      'dynamic_image',
    ].map((kind) => ({ kind, sourceId: 1n, assetId: 1n, status: 'ready' }));
    const report = await audit(
      [asset(), asset({ AssetId: 2n })],
      validReader,
      refs,
    );
    expect(report).toMatchObject({
      completed: true,
      passed: true,
      issueCount: 0,
      counts: { assets: 2, ready: 2, skipped: 0, references: 5 },
    });
    expect(JSON.stringify(report)).not.toContain('private/user-image');
  });
  it.each(['pending_scan', 'rejected', 'deleted'])(
    'skips absent %s objects but rejects their references',
    async (status) => {
      const reader = vi.fn(validReader);
      const report = await audit([asset({ Status: status })], reader, [
        { kind: 'avatar', sourceId: 1n, assetId: 1n, status },
      ]);
      expect(reader).not.toHaveBeenCalled();
      expect(report.issueCounts).toEqual({ reference_not_ready: 1 });
    },
  );
  it.each([null, 'ready'])(
    'handles missing or valid reference targets %s',
    async (status) => {
      const report = await audit([], validReader, [
        { kind: 'avatar', sourceId: 1n, assetId: 1n, status },
      ]);
      expect(report.passed).toBe(status === 'ready');
    },
  );
  it('detects same-size corruption independently of ETag', async () => {
    const corrupt = Buffer.from(image);
    corrupt[11] = 1;
    const report = await audit([asset()], () =>
      Promise.resolve({
        body: Readable.from([corrupt]),
        contentLength: image.length,
        contentType: 'image/png',
      }),
    );
    expect(report.issueCounts).toEqual({ sha256_mismatch: 1 });
  });
  it('checks actual size, metadata size, MIME and magic independently', async () => {
    const report = await audit([asset()], () =>
      Promise.resolve({
        body: Readable.from([Buffer.from('invalid')]),
        contentLength: 99,
        contentType: 'image/jpeg',
      }),
    );
    expect(Object.keys(report.issueCounts).sort()).toEqual([
      'content_length_mismatch',
      'content_type_mismatch',
      'image_signature_mismatch',
      'object_size_mismatch',
      'sha256_mismatch',
    ]);
  });
  it.each([
    [404, 'object_missing'],
    [403, 'object_access_denied'],
    [503, 'object_read_failed'],
  ])(
    'classifies status %s without leaking upstream text',
    async (status, category) => {
      const report = await audit([asset()], () =>
        Promise.reject(
          Object.assign(new Error('secret-url?token=password'), {
            $metadata: { httpStatusCode: status },
          }),
        ),
      );
      expect(report.issueCounts).toEqual({ [category]: 1 });
      expect(JSON.stringify(report)).not.toMatch(
        /secret|token|password|private/,
      );
    },
  );
  it('bounds streamed object bytes and destroys the response', async () => {
    const body = Readable.from([Buffer.alloc(10 * 1024 * 1024 + 1)]);
    const report = await audit([asset()], () =>
      Promise.resolve({
        body,
        contentLength: image.length,
        contentType: 'image/png',
      }),
    );
    expect(report.issueCounts).toEqual({ object_too_large: 1 });
    expect(body.destroyed).toBe(true);
  });
  it('times out after headers while an object stream stalls', async () => {
    const report = newRecoveryReport();
    const body = new Readable({ read() {} });
    // Keep the event loop alive while the unref'ed AbortSignal timer fires.
    const timer = setInterval(() => {}, 50);
    try {
      await inspectRecoverySnapshot(
        snapshot([asset()]),
        report,
        AbortSignal.timeout(1000),
        () =>
          Promise.resolve({
            body,
            contentLength: image.length,
            contentType: 'image/png',
          }),
        20,
      );
    } finally {
      clearInterval(timer);
    }
    expect(report.issueCounts).toEqual({ object_timeout: 1 });
    expect(body.destroyed).toBe(true);
  });
  it.each([
    { SizeBytes: 0n },
    { SizeBytes: 10_485_761n },
    { Sha256: 'invalid' },
    { MimeType: 'text/plain' },
  ])('rejects invalid ready metadata before S3 GET: %s', async (overrides) => {
    const reader = vi.fn(validReader);
    expect((await audit([asset(overrides)], reader)).issueCounts).toEqual({
      invalid_asset_metadata: 1,
    });
    expect(reader).not.toHaveBeenCalled();
  });
  it('bounds report details while retaining exact failure counts', async () => {
    const report = await audit(
      Array.from({ length: 205 }, (_, i) =>
        asset({ AssetId: BigInt(i + 1), Status: 'unknown' }),
      ),
    );
    expect(report).toMatchObject({
      passed: false,
      issueCount: 205,
      issuesTruncated: true,
    });
    expect(report.issues).toHaveLength(100);
  });
  it('detects same-count rebindings and metadata changes independently', async () => {
    const reference = {
      kind: 'avatar',
      sourceId: 1n,
      assetId: 1n,
      status: 'ready',
    };
    const before = snapshot([asset()], [reference]);
    for (const after of [
      snapshot([asset({ StorageKey: 'replacement' })], [reference]),
      snapshot([asset()], [{ ...reference, sourceId: 2n }]),
    ]) {
      const report = newRecoveryReport();
      report.beforeFingerprint = await inspectRecoverySnapshot(
        before,
        report,
        AbortSignal.timeout(1000),
      );
      report.afterFingerprint = await inspectRecoverySnapshot(
        after,
        report,
        AbortSignal.timeout(1000),
      );
      completeRecoveryReport(report);
      expect(report.issueCounts).toEqual({ database_changed: 1 });
    }
  });
  it('cannot pass on a partial snapshot', async () => {
    const report = newRecoveryReport();
    await expect(
      inspectRecoverySnapshot(
        snapshot([asset()]),
        report,
        AbortSignal.abort(),
        validReader,
      ),
    ).rejects.toThrow();
    expect(report).toMatchObject({ completed: false, passed: false });
  });
});

describe('recovery CLI explicit target boundary', () => {
  const env = {
    DATABASE_URL: 'postgresql://reader:password@localhost/recovered',
    S3_ENDPOINT: 'http://127.0.0.1:9000',
    S3_BUCKET: 'recovered-assets',
    S3_ACCESS_KEY_ID: 'reader',
    S3_SECRET_ACCESS_KEY: 'secret',
  };
  const args = [
    '--confirm-database',
    'recovered',
    '--confirm-bucket',
    'recovered-assets',
    '--writes-paused',
    'yes',
    '--report',
    join(tmpdir(), 'linji-recovery-result.json'),
  ];
  it('requires explicit credentials, target and paused-writes declaration', () => {
    expect(storageRecoverySettings(args, env)).toMatchObject({
      bucket: 'recovered-assets',
      timeout: 30_000,
    });
  });
  it.each([
    { S3_ENDPOINT: 'http://remote.example' },
    { S3_ENDPOINT: 'https://user:secret@example.com' },
    { S3_ENDPOINT: 'https://example.com/?secret=1' },
    { S3_SECRET_ACCESS_KEY: '' },
    { S3_BUCKET: '' },
    { S3_REQUEST_TIMEOUT_MS: '0' },
    { S3_REQUEST_TIMEOUT_MS: '120001' },
    { DATABASE_URL: 'postgresql://reader:password@localhost/other' },
  ])('rejects unsafe or mismatched settings %s', (overrides) => {
    expect(() =>
      storageRecoverySettings(args, { ...env, ...overrides }),
    ).toThrow();
  });
  it.each(
    [
      [],
      ['--writes-paused', 'no'],
      [...args, '--report', 'D:/second.json'],
      [...args, '--unknown', 'value'],
    ].map((args) => [args]),
  )('rejects missing or duplicate flags', (value) =>
    expect(() => storageRecoverySettings(value, env)).toThrow(),
  );
});
