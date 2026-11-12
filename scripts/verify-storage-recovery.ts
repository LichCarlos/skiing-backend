import { createHash } from 'node:crypto';
import { open, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import type { Prisma, PrismaClient } from '@prisma/client';
import { databaseConnection } from './database-backup.js';
import {
  MAX_ASSET_BYTES,
  detectSupportedImage,
} from '../src/modules/assets/domain/asset-rules.js';

export interface RecoveryAsset {
  AssetId: bigint;
  OwnerUserId: number;
  StorageKey: string;
  MimeType: string;
  SizeBytes: bigint;
  Sha256: string;
  Status: string;
  UpdateTime: Date;
}
export interface RecoveryReference {
  kind: string;
  sourceId: bigint;
  assetId: bigint;
  status: string | null;
}
export interface RecoverySnapshot {
  assets(): AsyncIterable<RecoveryAsset>;
  references(): AsyncIterable<RecoveryReference>;
}
export interface RecoveryObject {
  body: Readable;
  contentLength?: number;
  contentType?: string;
}
export type ObjectReader = (
  key: string,
  signal: AbortSignal,
) => Promise<RecoveryObject>;
export interface StorageRecoveryReport {
  format: 'linji-storage-recovery-v1';
  startedAt: string;
  finishedAt?: string;
  completed: boolean;
  passed: boolean;
  writesPausedDeclared: true;
  counts: {
    assets: number;
    ready: number;
    skipped: number;
    references: number;
  };
  issueCount: number;
  issueCounts: Record<string, number>;
  issues: Array<{ category: string; assetId?: string }>;
  issuesTruncated: boolean;
  beforeFingerprint?: string;
  afterFingerprint?: string;
}
export function newRecoveryReport(): StorageRecoveryReport {
  return {
    format: 'linji-storage-recovery-v1',
    startedAt: new Date().toISOString(),
    completed: false,
    passed: false,
    writesPausedDeclared: true,
    counts: { assets: 0, ready: 0, skipped: 0, references: 0 },
    issueCount: 0,
    issueCounts: {},
    issues: [],
    issuesTruncated: false,
  };
}
export function recoveryIssue(
  report: StorageRecoveryReport,
  category: string,
  assetId?: bigint,
) {
  report.issueCount++;
  report.issueCounts[category] = (report.issueCounts[category] ?? 0) + 1;
  if (report.issues.length < 100)
    report.issues.push({
      category,
      ...(assetId ? { assetId: String(assetId) } : {}),
    });
  else report.issuesTruncated = true;
}
// Never derive a report field from a provider message, object key or URL.
export function objectFailure(error: unknown, signal: AbortSignal): string {
  if (signal.aborted) return 'object_timeout';
  const status = (error as { $metadata?: { httpStatusCode?: number } } | null)
    ?.$metadata?.httpStatusCode;
  if (status === 404) return 'object_missing';
  if (status === 401 || status === 403) return 'object_access_denied';
  return 'object_read_failed';
}
async function verifyObject(
  asset: RecoveryAsset,
  reader: ObjectReader,
  report: StorageRecoveryReport,
  signal: AbortSignal,
) {
  let body: Readable | undefined;
  try {
    const object = await reader(asset.StorageKey, signal);
    body = object.body;
    if (
      !Number.isSafeInteger(object.contentLength) ||
      BigInt(object.contentLength!) !== asset.SizeBytes
    )
      recoveryIssue(report, 'content_length_mismatch', asset.AssetId);
    if (object.contentType !== asset.MimeType)
      recoveryIssue(report, 'content_type_mismatch', asset.AssetId);
    const hash = createHash('sha256');
    let bytes = 0;
    let header = Buffer.alloc(0);
    // Abort also covers a stalled body, rather than just response headers.
    const abort = () => body?.destroy(new Error('Recovery object deadline'));
    signal.addEventListener('abort', abort, { once: true });
    try {
      signal.throwIfAborted();
      for await (const value of body) {
        signal.throwIfAborted();
        const chunk = Buffer.isBuffer(value)
          ? value
          : Buffer.from(value as Uint8Array);
        bytes += chunk.length;
        if (bytes > MAX_ASSET_BYTES) {
          recoveryIssue(report, 'object_too_large', asset.AssetId);
          return;
        }
        if (header.length < 12)
          header = Buffer.concat([
            header,
            chunk.subarray(0, 12 - header.length),
          ]);
        hash.update(chunk);
      }
      if (BigInt(bytes) !== asset.SizeBytes)
        recoveryIssue(report, 'object_size_mismatch', asset.AssetId);
      if (hash.digest('hex') !== asset.Sha256)
        recoveryIssue(report, 'sha256_mismatch', asset.AssetId);
      if (detectSupportedImage(header)?.mimeType !== asset.MimeType)
        recoveryIssue(report, 'image_signature_mismatch', asset.AssetId);
    } finally {
      signal.removeEventListener('abort', abort);
    }
  } catch (error) {
    recoveryIssue(report, objectFailure(error, signal), asset.AssetId);
  } finally {
    body?.destroy();
  }
}
export async function inspectRecoverySnapshot(
  snapshot: RecoverySnapshot,
  report: StorageRecoveryReport,
  signal: AbortSignal,
  reader?: ObjectReader,
  requestTimeoutMs = 30_000,
): Promise<string> {
  const fingerprint = createHash('sha256');
  for await (const asset of snapshot.assets()) {
    signal.throwIfAborted();
    fingerprint.update(
      JSON.stringify([
        'asset',
        String(asset.AssetId),
        asset.OwnerUserId,
        asset.StorageKey,
        asset.MimeType,
        String(asset.SizeBytes),
        asset.Sha256,
        asset.Status,
        asset.UpdateTime.toISOString(),
      ]) + '\n',
    );
    if (!reader) continue;
    report.counts.assets++;
    if (asset.Status !== 'ready') {
      report.counts.skipped++;
      if (!['pending_scan', 'rejected', 'deleted'].includes(asset.Status))
        recoveryIssue(report, 'invalid_asset_status', asset.AssetId);
      continue;
    }
    report.counts.ready++;
    if (
      asset.SizeBytes < 1n ||
      asset.SizeBytes > BigInt(MAX_ASSET_BYTES) ||
      !/^[a-f0-9]{64}$/u.test(asset.Sha256) ||
      !['image/jpeg', 'image/png', 'image/webp'].includes(asset.MimeType)
    ) {
      recoveryIssue(report, 'invalid_asset_metadata', asset.AssetId);
      continue;
    }
    await verifyObject(
      asset,
      reader,
      report,
      AbortSignal.any([signal, AbortSignal.timeout(requestTimeoutMs)]),
    );
  }
  for await (const ref of snapshot.references()) {
    signal.throwIfAborted();
    fingerprint.update(
      JSON.stringify([
        'reference',
        ref.kind,
        String(ref.sourceId),
        String(ref.assetId),
        ref.status,
      ]) + '\n',
    );
    if (reader) {
      report.counts.references++;
      if (ref.status !== 'ready')
        recoveryIssue(report, 'reference_not_ready', ref.assetId);
    }
  }
  return fingerprint.digest('hex');
}
export function completeRecoveryReport(report: StorageRecoveryReport) {
  if (report.beforeFingerprint !== report.afterFingerprint)
    recoveryIssue(report, 'database_changed');
  report.completed = true;
  report.passed = report.issueCount === 0;
  report.finishedAt = new Date().toISOString();
}

export function prismaRecoverySnapshot(
  tx: Prisma.TransactionClient,
): RecoverySnapshot {
  return {
    async *assets() {
      let last = 0n;
      while (true) {
        const rows = await tx.asset.findMany({
          where: { AssetId: { gt: last } },
          orderBy: { AssetId: 'asc' },
          take: 200,
          select: {
            AssetId: true,
            OwnerUserId: true,
            StorageKey: true,
            MimeType: true,
            SizeBytes: true,
            Sha256: true,
            Status: true,
            UpdateTime: true,
          },
        });
        if (!rows.length) break;
        for (const row of rows) yield row;
        last = rows.at(-1)!.AssetId;
      }
    },
    async *references() {
      let kind = '',
        sourceId = 0n,
        assetId = 0n;
      while (true) {
        const rows = await tx.$queryRaw<RecoveryReference[]>`
          WITH refs AS (
            SELECT 'avatar'::text AS kind, "UserId"::bigint AS "sourceId", "AvatarAssetId" AS "assetId" FROM "User" WHERE "AvatarAssetId" IS NOT NULL
            UNION ALL SELECT 'resort_cover', "ResortId"::bigint, "CoverAssetId" FROM "SkiResort" WHERE "CoverAssetId" IS NOT NULL
            UNION ALL SELECT 'resort_image', "ResortId"::bigint, "AssetId" FROM "ResortImage"
            UNION ALL SELECT 'article_cover', "ArticleId"::bigint, "CoverAssetId" FROM "Article" WHERE "CoverAssetId" IS NOT NULL
            UNION ALL SELECT 'dynamic_image', "DynamicId"::bigint, "AssetId" FROM "DynamicImage"
          )
          SELECT refs.*, a."Status" AS status FROM refs
          LEFT JOIN "Asset" a ON a."AssetId"=refs."assetId"
          WHERE (kind COLLATE "C", "sourceId", "assetId") > (${kind} COLLATE "C", ${sourceId}, ${assetId})
          ORDER BY kind COLLATE "C", "sourceId", "assetId" LIMIT 200`;
        if (!rows.length) break;
        for (const row of rows) yield row;
        ({ kind, sourceId, assetId } = rows.at(-1)!);
      }
    },
  };
}
export async function readOnlyRecoverySnapshot<T>(
  client: PrismaClient,
  inspect: (snapshot: RecoverySnapshot) => Promise<T>,
) {
  return client.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      const mode = await tx.$queryRaw<
        Array<{ mode: string }>
      >`SELECT current_setting('transaction_read_only') AS mode`;
      if (mode[0]?.mode !== 'on')
        throw new Error('Read-only transaction required');
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '30s'");
      return inspect(prismaRecoverySnapshot(tx));
    },
    { isolationLevel: 'RepeatableRead', maxWait: 10_000, timeout: 30 * 60_000 },
  );
}

export function storageRecoverySettings(
  args: string[],
  env: NodeJS.ProcessEnv,
) {
  const values = new Map<string, string>();
  const names = [
    '--confirm-database',
    '--confirm-bucket',
    '--report',
    '--writes-paused',
  ];
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]!,
      value = args[i + 1];
    if (
      !names.includes(key) ||
      values.has(key) ||
      !value ||
      value.startsWith('--')
    )
      throw new Error('Invalid recovery verification arguments');
    values.set(key, value);
  }
  const connection = databaseConnection(env.DATABASE_URL ?? '');
  if (
    values.get('--confirm-database') !== connection.database ||
    values.get('--confirm-bucket') !== env.S3_BUCKET ||
    values.get('--writes-paused') !== 'yes'
  )
    throw new Error('Explicit target and paused-writes declarations required');
  const endpoint = new URL(env.S3_ENDPOINT ?? '');
  if (
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    endpoint.pathname !== '/' ||
    !(
      endpoint.protocol === 'https:' ||
      (endpoint.protocol === 'http:' &&
        ['127.0.0.1', '[::1]', 'localhost'].includes(endpoint.hostname))
    )
  )
    throw new Error('HTTPS or loopback HTTP S3 endpoint required');
  if (
    !env.S3_ACCESS_KEY_ID ||
    !env.S3_SECRET_ACCESS_KEY ||
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(env.S3_BUCKET ?? '')
  )
    throw new Error('Explicit S3 credentials and bucket required');
  const report = values.get('--report');
  if (!report || !isAbsolute(report))
    throw new Error('Absolute new external report path required');
  const timeout = Number(env.S3_REQUEST_TIMEOUT_MS ?? 30_000);
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 120_000)
    throw new Error('S3_REQUEST_TIMEOUT_MS must be 1..120000');
  return {
    databaseUrl: env.DATABASE_URL!,
    endpoint: endpoint.href,
    bucket: env.S3_BUCKET!,
    region: env.S3_REGION || 'us-east-1',
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    report,
    timeout,
  };
}
export async function main() {
  const settings = storageRecoverySettings(process.argv.slice(2), process.env);
  const root = await realpath(
    resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  );
  const parent = await realpath(dirname(settings.report));
  const path = relative(root, parent);
  if (!(path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)))
    throw new Error('Report must resolve outside the repository');
  const file = await open(settings.report, 'wx', 0o600);
  const report = newRecoveryReport();
  let client: PrismaClient | undefined;
  let s3: S3Client | undefined;
  try {
    // A killed/incomplete process leaves a failing sentinel, never a passing report.
    await file.writeFile(JSON.stringify(report, null, 2) + '\n');
    const { PrismaClient } = await import('@prisma/client');
    client = new PrismaClient({ datasourceUrl: settings.databaseUrl });
    s3 = new S3Client({
      endpoint: settings.endpoint,
      region: settings.region,
      forcePathStyle: true,
      maxAttempts: 1,
      credentials: {
        accessKeyId: settings.accessKeyId,
        secretAccessKey: settings.secretAccessKey,
      },
      requestHandler: {
        connectionTimeout: settings.timeout,
        requestTimeout: settings.timeout,
      },
    });
    const storage = s3;
    const reader: ObjectReader = async (key, signal) => {
      const result = await storage.send(
        new GetObjectCommand({ Bucket: settings.bucket, Key: key }),
        { abortSignal: signal },
      );
      if (!(result.Body instanceof Readable))
        throw new Error('Node response stream required');
      return {
        body: result.Body,
        contentLength: result.ContentLength,
        contentType: result.ContentType,
      };
    };
    const deadline = AbortSignal.timeout(30 * 60_000);
    report.beforeFingerprint = await readOnlyRecoverySnapshot(
      client,
      (snapshot) =>
        inspectRecoverySnapshot(
          snapshot,
          report,
          deadline,
          reader,
          settings.timeout,
        ),
    );
    report.afterFingerprint = await readOnlyRecoverySnapshot(
      client,
      (snapshot) => inspectRecoverySnapshot(snapshot, report, deadline),
    );
    completeRecoveryReport(report);
  } catch {
    recoveryIssue(report, 'verification_interrupted');
    report.completed = report.passed = false;
    report.finishedAt = new Date().toISOString();
  } finally {
    s3?.destroy();
    try {
      await client?.$disconnect();
    } catch {
      recoveryIssue(report, 'database_disconnect_failed');
      report.completed = report.passed = false;
    }
    try {
      const bytes = Buffer.from(JSON.stringify(report, null, 2) + '\n');
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesWritten } = await file.write(
          bytes,
          offset,
          bytes.length - offset,
          offset,
        );
        if (bytesWritten < 1)
          throw new Error('Recovery report write incomplete');
        offset += bytesWritten;
      }
      await file.truncate(bytes.length);
      await file.sync();
    } finally {
      await file.close();
    }
  }
  console.info(
    JSON.stringify({
      completed: report.completed,
      passed: report.passed,
      counts: report.counts,
      issueCount: report.issueCount,
    }),
  );
  if (!report.passed) process.exitCode = 1;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch(() => {
    console.error(
      'Storage recovery verification failed; no passing report produced',
    );
    process.exitCode = 1;
  });
