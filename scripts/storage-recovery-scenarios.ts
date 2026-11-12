import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { PrismaClient } from '@prisma/client';
import {
  S3Client,
  CreateBucketCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { databaseConnection } from './database-backup.js';
import { type StorageRecoveryReport } from './verify-storage-recovery.js';

// Only the owning fresh-service runner invokes this synthetic fixture process.
const output = process.argv[2]!;
assert.equal(
  process.env.LINJI_STORAGE_RECOVERY_CONFIRM,
  'synthetic-new-services-only',
);
const connection = databaseConnection(process.env.DATABASE_URL!);
assert.equal(connection.database, 'linji_storage_recovery_validation');
assert.equal(connection.host, '127.0.0.1');
const client = new PrismaClient();
const endpoint = process.env.S3_ENDPOINT!,
  bucket = process.env.S3_BUCKET!;
assert.equal(new URL(endpoint).hostname, '127.0.0.1');
const storage = new S3Client({
  endpoint,
  region: 'us-east-1',
  forcePathStyle: true,
  maxAttempts: 1,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  },
});
const execute = promisify(execFile);
const checks: Array<Record<string, unknown>> = [];
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const sha = (value: string | Buffer) =>
  createHash('sha256').update(value).digest('hex');
const readerPassword = randomBytes(32).toString('hex');
const readerUrl = new URL(process.env.DATABASE_URL!);
readerUrl.username = 'storage_recovery_reader';
readerUrl.password = readerPassword;
let reader: PrismaClient | undefined;
async function databaseFingerprint() {
  const tables = await client.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`;
  const hash = createHash('sha256');
  for (const { tablename } of tables) {
    assert.match(tablename, /^[a-zA-Z_][a-zA-Z0-9_]*$/u);
    const rows = await client.$queryRawUnsafe<Array<{ row: string }>>(
      `SELECT to_jsonb(t)::text AS row FROM "${tablename}" t ORDER BY to_jsonb(t)::text`,
    );
    hash.update(JSON.stringify([tablename, rows]));
  }
  return hash.digest('hex');
}
async function objectFingerprint() {
  const result = await storage.send(
    new ListObjectsV2Command({ Bucket: bucket }),
  );
  assert(!result.IsTruncated);
  return sha(JSON.stringify(result.Contents ?? []));
}
async function put(key: string, body = png, contentType = 'image/png') {
  await storage.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}
async function cli(
  label: string,
  expected: number,
  extraEnv: NodeJS.ProcessEnv = {},
  reportName = label,
) {
  const before = await databaseFingerprint(),
    objects = await objectFingerprint();
  let code = 0,
    log = '';
  try {
    const result = await execute(
      process.execPath,
      [
        'node_modules/tsx/dist/cli.mjs',
        'scripts/verify-storage-recovery.ts',
        '--confirm-database',
        connection.database,
        '--confirm-bucket',
        bucket,
        '--writes-paused',
        'yes',
        '--report',
        join(output, reportName + '.json'),
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: readerUrl.href, ...extraEnv },
        windowsHide: true,
        timeout: 90_000,
        maxBuffer: 2 * 1024 * 1024,
      },
    );
    log = result.stdout + result.stderr;
  } catch (error) {
    const failure = error as {
      code?: number;
      stdout?: string;
      stderr?: string;
    };
    code = Number(failure.code);
    log = (failure.stdout ?? '') + (failure.stderr ?? '');
  }
  for (const secret of [
    connection.password,
    readerPassword,
    process.env.S3_SECRET_ACCESS_KEY!,
  ])
    assert(!log.includes(secret), 'CLI must not print credentials');
  await writeFile(join(output, label + '.log'), log);
  assert.equal(code, expected, label);
  assert.equal(
    await databaseFingerprint(),
    before,
    'Verifier mutated database',
  );
  assert.equal(await objectFingerprint(), objects, 'Verifier mutated objects');
  checks.push({
    label,
    exitCode: code,
    expectedExitCode: expected,
    databaseUnchanged: true,
    objectsUnchanged: true,
  });
  return JSON.parse(
    await readFile(join(output, reportName + '.json'), 'utf8'),
  ) as StorageRecoveryReport;
}
try {
  await storage.send(new CreateBucketCommand({ Bucket: bucket }));
  const owner = await client.user.findFirstOrThrow();
  const keys = [
    'secret-avatar-object',
    'secret-unused-object',
    'secret-gallery-object',
  ];
  const assets = [];
  for (const key of keys) {
    await put(key);
    assets.push(
      await client.asset.create({
        data: {
          OwnerUserId: owner.UserId,
          StorageKey: key,
          OriginalName: 'private-photo-name.png',
          MimeType: 'image/png',
          SizeBytes: BigInt(png.length),
          Sha256: sha(png),
          Status: 'ready',
        },
      }),
    );
  }
  const [first, , third] = assets;
  assert(first && third);
  // Exercise >200 rows in Asset and reference keyset pagination without requiring
  // physical objects for pending/deleted/rejected records.
  await client.asset.createMany({
    data: Array.from({ length: 205 }, (_, index) => ({
      OwnerUserId: owner.UserId,
      StorageKey: `never-created-${index}`,
      OriginalName: 'skipped.png',
      MimeType: 'image/png',
      SizeBytes: BigInt(png.length),
      Sha256: sha(png),
      Status: ['pending_scan', 'rejected', 'deleted'][index % 3]!,
    })),
  });
  await client.user.update({
    where: { UserId: owner.UserId },
    data: { AvatarAssetId: first.AssetId },
  });
  const resort = await client.skiResort.create({
    data: {
      Name: 'Recovery fixture',
      Price: 100,
      LegacyDistance: 0,
      SnowCondition: 'synthetic',
      Description: 'synthetic',
      CoverAssetId: first.AssetId,
      DeletedAt: new Date(),
      Gallery: { create: { AssetId: third.AssetId, SortOrder: 0 } },
    },
  });
  const category = await client.dictionaryItem.create({
    data: {
      DictType: 'knowledge.article_category',
      Value: 'storage_recovery',
      Label: 'Recovery fixture',
    },
  });
  await client.article.create({
    data: {
      Title: 'Recovery',
      Summary: 'Synthetic',
      Body: 'Synthetic',
      CategoryValue: category.Value,
      CoverAssetId: first.AssetId,
      DeletedAt: new Date(),
    },
  });
  for (let i = 0; i < 201; i++)
    await client.dynamic.create({
      data: {
        AuthorId: owner.UserId,
        Content: 'Recovery fixture',
        ResortId: resort.ResortId,
        Status: 'hidden',
        DeletedAt: new Date(),
        Images: { create: { AssetId: third.AssetId, SortOrder: 0 } },
      },
    });
  await client.$executeRawUnsafe(
    `CREATE ROLE storage_recovery_reader LOGIN PASSWORD '${readerPassword}'`,
  );
  await client.$executeRawUnsafe(
    'GRANT USAGE ON SCHEMA public TO storage_recovery_reader',
  );
  await client.$executeRawUnsafe(
    'GRANT SELECT ON ALL TABLES IN SCHEMA public TO storage_recovery_reader',
  );
  reader = new PrismaClient({ datasourceUrl: readerUrl.href });
  await assert.rejects(
    reader.$executeRawUnsafe('UPDATE "Asset" SET "Status"=\'deleted\''),
    (e: { meta?: { code?: string } }) => e.meta?.code === '42501',
  );
  checks.push({ label: 'read-only-account-denies-update', passed: true });

  const good = await cli('valid', 0);
  assert.deepEqual(good.counts, {
    assets: 208,
    ready: 3,
    skipped: 205,
    references: 205,
  });
  assert(good.completed && good.passed);
  assert.equal(good.beforeFingerprint, good.afterFingerprint);
  const originalReport = sha(await readFile(join(output, 'valid.json')));
  await cli('no-overwrite', 1, {}, 'valid');
  assert.equal(sha(await readFile(join(output, 'valid.json'))), originalReport);

  await storage.send(
    new DeleteObjectCommand({ Bucket: bucket, Key: keys[1]! }),
  );
  assert.deepEqual((await cli('missing-unreferenced', 1)).issueCounts, {
    object_missing: 1,
  });
  await put(keys[1]!);
  const corrupt = Buffer.from(png);
  corrupt[11] = 7;
  await put(keys[0]!, corrupt);
  assert.deepEqual((await cli('same-size-corruption', 1)).issueCounts, {
    sha256_mismatch: 1,
  });
  await put(keys[0]!, Buffer.concat([png, Buffer.from([1])]), 'image/jpeg');
  const wrong = await cli('wrong-size-mime', 1);
  assert.deepEqual(wrong.issueCounts, {
    content_length_mismatch: 1,
    content_type_mismatch: 1,
    object_size_mismatch: 1,
    sha256_mismatch: 1,
  });
  await put(keys[0]!);
  await client.asset.update({
    where: { AssetId: third.AssetId },
    data: { Status: 'rejected' },
  });
  const rejected = await cli('non-ready-references', 1);
  assert.equal(rejected.issueCounts.reference_not_ready, 202);
  assert.equal(rejected.issues.length, 100);
  assert(rejected.issuesTruncated);
  await client.asset.update({
    where: { AssetId: third.AssetId },
    data: { Status: 'ready' },
  });
  const denied = await cli('s3-access-denied', 1, {
    S3_SECRET_ACCESS_KEY: randomBytes(32).toString('hex'),
  });
  assert.deepEqual(denied.issueCounts, { object_access_denied: 3 });
  const invalidTarget = new URL(readerUrl);
  invalidTarget.pathname = '/other_database';
  // Invalid target is rejected before creating an output report.
  await cli(
    'mismatched-target',
    1,
    { DATABASE_URL: invalidTarget.href },
    'valid',
  );
  const final = await cli('repaired', 0);
  assert(final.passed);
  for (const name of [
    'valid',
    'missing-unreferenced',
    'same-size-corruption',
    'wrong-size-mime',
    'non-ready-references',
    's3-access-denied',
    'repaired',
  ]) {
    const text = await readFile(join(output, name + '.json'), 'utf8');
    for (const forbidden of [
      ...keys,
      'private-photo-name',
      readerPassword,
      connection.password,
      endpoint,
    ])
      assert(!text.includes(forbidden), 'Report contains sensitive data');
  }
  await writeFile(
    join(output, 'scenarios.json'),
    JSON.stringify(
      {
        completed: true,
        checks,
        allVerifierCallsReadOnly: true,
        fiveReferenceKinds: true,
        keysetPaginationOver200: true,
      },
      null,
      2,
    ) + '\n',
  );
  console.info(`Storage recovery scenarios passed: ${checks.length}`);
} catch {
  // Prisma/SDK exceptions can contain queries or credentials. Keep fixture
  // failures generic; individual CLI reports/logs identify the failing stage.
  await writeFile(
    join(output, 'scenarios-failed.json'),
    JSON.stringify(
      {
        completed: false,
        checks,
        error: 'synthetic_fixture_or_assertion_failed',
      },
      null,
      2,
    ) + '\n',
  );
  console.error(
    'Storage recovery scenarios failed; inspect safe per-scenario reports',
  );
  process.exitCode = 1;
} finally {
  storage.destroy();
  await reader?.$disconnect();
  await client.$disconnect();
}
