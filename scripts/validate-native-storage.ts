import assert from 'node:assert/strict';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { openSync, closeSync } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  writeFile,
  readFile,
  appendFile,
  unlink,
  realpath,
} from 'node:fs/promises';
import { createServer, connect } from 'node:net';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { PrismaClient } from '@prisma/client';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';

// No existing service, database, bucket, credentials or data directory is accepted.
assert.equal(process.platform, 'win32');
function required(key: string) {
  const value = process.env[key];
  assert(value, `${key} is required`);
  return value;
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pgRoot = await realpath(required('LINJI_NATIVE_PG_ROOT'));
const minio = await realpath(required('LINJI_NATIVE_MINIO'));
const clamd = await realpath(required('LINJI_NATIVE_CLAMD'));
const outputRoot = resolve(required('LINJI_NATIVE_STORAGE_OUTPUT'));
assert(!/["\r\n]/u.test(outputRoot));
await mkdir(outputRoot, { recursive: true });
const output = await mkdtemp(join(outputRoot, 'linji-storage-'));
const pgData = join(output, 'pg-data'),
  passwordFile = join(output, 'init-password.txt');
const secrets = Array.from({ length: 6 }, () =>
  randomBytes(32).toString('hex'),
);
const [password, adminPassword, s3Password, jwt, csrf, loginSecret] = secrets;
const account = `storage_${randomBytes(6).toString('hex')}`;
const bucket = 'linji-asset-storage-validation';
const checks: Array<{ name: string; passed: boolean }> = [];
const report: Record<string, unknown> = {
  output,
  checks,
  completed: false,
  databaseStopped: false,
  servicesStopped: false,
  scannerDefinitions:
    'Only the repository harmless test marker; no production signature coverage claimed',
};
const exec = promisify(execFile);
const services: Array<{
  name: string;
  child: ChildProcess;
  exited: Promise<void>;
}> = [];
let initialized = false,
  client: PrismaClient | undefined,
  s3: S3Client | undefined;
let ports: number[] = [];
const pg = (name: string) => join(pgRoot, 'bin', `${name}.exe`);
const redact = (text: string) =>
  secrets.reduce((v, secret) => v.replaceAll(secret!, '[redacted]'), text);
async function run(
  name: string,
  command: string,
  args: string[],
  env = process.env,
) {
  console.info(`Running ${name}`);
  try {
    const r = await exec(command, args, {
      cwd: root,
      env,
      windowsHide: true,
      timeout: 15 * 60_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    await writeFile(join(output, `${name}.log`), redact(r.stdout + r.stderr));
    checks.push({ name, passed: true });
    return r.stdout;
  } catch (error) {
    const e = error as Error & { stdout?: string; stderr?: string };
    await writeFile(
      join(output, `${name}.log`),
      redact(`${e.stdout ?? ''}\n${e.stderr ?? ''}\n${e.message}`),
    );
    checks.push({ name, passed: false });
    throw new Error(`${name} failed; inspect its redacted log`);
  }
}
async function availablePort() {
  const server = createServer();
  await new Promise<void>((yes, no) => {
    server.once('error', no);
    server.listen(0, '127.0.0.1', yes);
  });
  const address = server.address();
  assert(address && typeof address !== 'string');
  await new Promise<void>((yes, no) =>
    server.close((e) => (e ? no(e) : yes())),
  );
  return address.port;
}
async function listening(port: number) {
  return new Promise<boolean>((yes) => {
    const socket = connect({ host: '127.0.0.1', port });
    const finish = (value: boolean) => {
      socket.destroy();
      yes(value);
    };
    socket.setTimeout(1000, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}
function service(
  name: string,
  executable: string,
  args: string[],
  env: NodeJS.ProcessEnv,
) {
  const fd = openSync(join(output, `${name}.log`), 'wx');
  let child: ChildProcess;
  try {
    child = spawn(executable, args, {
      cwd: output,
      env,
      windowsHide: true,
      stdio: ['ignore', fd, fd],
    });
  } finally {
    closeSync(fd);
  }
  // Observe spawn errors immediately and keep ownership of this exact handle.
  const exited = new Promise<void>((yes) => {
    child.once('error', yes);
    child.once('exit', yes);
  });
  services.push({ name, child, exited });
  return child;
}
async function ready(name: string, port: number, child: ChildProcess) {
  for (let attempt = 0; attempt < 120; attempt++) {
    assert(
      child.pid && child.exitCode === null && child.signalCode === null,
      `${name} exited before readiness`,
    );
    if (await listening(port)) {
      checks.push({ name: `${name}-ready`, passed: true });
      return;
    }
    await delay(500);
  }
  throw new Error(`${name} readiness timed out`);
}
async function pgControl(args: string[]) {
  const code = await new Promise<number | null>((yes, no) => {
    const child = spawn(pg('pg_ctl'), args, {
      cwd: output,
      windowsHide: true,
      stdio: 'ignore',
    });
    child.once('error', no);
    child.once('exit', yes);
  });
  assert.equal(code, 0, 'Dedicated pg_ctl command failed');
}
try {
  report.binaries = await Promise.all(
    [minio, clamd, pg('postgres')].map(async (path) => ({
      path,
      sha256: createHash('sha256')
        .update(await readFile(path))
        .digest('hex'),
    })),
  );
  report.minioVersion = (
    await run('minio-version', minio, ['--version'])
  ).trim();
  assert.match(String(report.minioVersion), /9e49d5e7a648/u);
  report.postgresVersion = (
    await run('postgres-version', pg('postgres'), ['--version'])
  ).trim();
  assert.match(String(report.postgresVersion), /PostgreSQL\) 17\./u);
  const definitions = join(output, 'test-definitions');
  await mkdir(definitions);
  await writeFile(
    join(definitions, 'linji-test-only.ndb'),
    await readFile(join(root, 'test/fixtures/linji-test-only.ndb')),
  );
  await mkdir(join(output, 'clam-temp'));
  await mkdir(join(output, 'minio-data'));
  ports = await Promise.all(Array.from({ length: 4 }, () => availablePort()));
  assert.equal(
    new Set(ports).size,
    4,
    'Port reservation collision; use a new run',
  );
  const [pgPort, s3Port, consolePort, scannerPort] = ports as [
    number,
    number,
    number,
    number,
  ];
  report.ports = { pgPort, s3Port, consolePort, scannerPort };
  const config = join(output, 'clamd.conf');
  await writeFile(
    config,
    `TCPSocket ${scannerPort}\nTCPAddr 127.0.0.1\nDatabaseDirectory ${definitions}\nTemporaryDirectory ${join(output, 'clam-temp')}\nForeground yes\nScanPE no\nScanELF no\nScanOLE2 no\nScanPDF no\nScanMail no\nScanArchive no\nStreamMaxLength 12M\n`,
  );
  report.clamavVersion = (
    await run('clamav-version', clamd, ['--config-file', config, '--version'])
  ).trim();
  assert.match(String(report.clamavVersion), /ClamAV 1\.4\./u);
  const scanner = service('clamd', clamd, ['--config-file', config], {
    ...process.env,
  });
  const storage = service(
    'minio',
    minio,
    [
      'server',
      join(output, 'minio-data'),
      '--address',
      `127.0.0.1:${s3Port}`,
      '--console-address',
      `127.0.0.1:${consolePort}`,
    ],
    {
      ...process.env,
      MINIO_ROOT_USER: account,
      MINIO_ROOT_PASSWORD: s3Password,
      MINIO_BROWSER: 'off',
      MINIO_UPDATE: 'off',
    },
  );
  await ready('clamd', scannerPort, scanner);
  await ready('minio', s3Port, storage);
  const health = await fetch(`http://127.0.0.1:${s3Port}/minio/health/live`, {
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(health.status, 200);
  await writeFile(passwordFile, `${password}\n`, { flag: 'wx', mode: 0o600 });
  await run('initialize', pg('pg_ctl'), [
    'initdb',
    '-D',
    pgData,
    '-o',
    `--username=postgres --auth=scram-sha-256 --encoding=UTF8 --locale=C --pwfile="${passwordFile}"`,
  ]);
  initialized = true;
  await unlink(passwordFile);
  await appendFile(
    join(pgData, 'postgresql.conf'),
    `\nlisten_addresses = '127.0.0.1'\nport = ${pgPort}\nmax_connections = 40\nshared_buffers = '64MB'\n`,
  );
  await pgControl([
    'start',
    '-D',
    pgData,
    '-l',
    join(output, 'postgres.log'),
    '-w',
    '-t',
    '45',
  ]);
  const database = 'linji_asset_storage_validation';
  await run(
    'create-database',
    pg('createdb'),
    ['-h', '127.0.0.1', '-p', String(pgPort), '-U', 'postgres', database],
    { ...process.env, PGPASSWORD: password },
  );
  const url = `postgresql://postgres:${password}@127.0.0.1:${pgPort}/${database}?connection_limit=8`;
  const endpoint = `http://127.0.0.1:${s3Port}`;
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    NODE_OPTIONS: '--max-old-space-size=1536',
    VITEST_MAX_WORKERS: '1',
    DATABASE_URL: url,
    INITIAL_ADMIN_ACCOUNT: account,
    INITIAL_ADMIN_PASSWORD: adminPassword,
    JWT_ACCESS_SECRET: jwt,
    CSRF_SECRET: csrf,
    LOGIN_RATE_LIMIT_SECRET: loginSecret,
    S3_ENDPOINT: endpoint,
    S3_PUBLIC_ENDPOINT: endpoint,
    S3_BUCKET: bucket,
    S3_REGION: 'us-east-1',
    S3_ACCESS_KEY_ID: account,
    S3_SECRET_ACCESS_KEY: s3Password,
    S3_REQUEST_TIMEOUT_MS: '30000',
    CLAMAV_HOST: '127.0.0.1',
    CLAMAV_PORT: String(scannerPort),
    CLAMAV_TIMEOUT_MS: '15000',
    ASSET_STORAGE_INTEGRATION_CONFIRM: database,
  };
  const tsx = join(root, 'node_modules/tsx/dist/cli.mjs');
  await run(
    'migrate-deploy',
    process.execPath,
    [join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'],
    env,
  );
  await run('seed-first', process.execPath, [tsx, 'prisma/seed.ts'], env);
  await run('seed-second', process.execPath, [tsx, 'prisma/seed.ts'], env);
  await run(
    'verify-before',
    process.execPath,
    [tsx, 'scripts/verify-database.ts'],
    env,
  );
  client = new PrismaClient({ datasourceUrl: url });
  async function authorizationCounts() {
    assert(client);
    return {
      roles: await client.role.count(),
      permissions: await client.permission.count(),
      userRoles: await client.userRole.count(),
      rolePermissions: await client.rolePermission.count(),
      scopes: await client.roleDataScope.count(),
      merchants: await client.merchantProfile.count(),
    };
  }
  const authorizationBefore = await authorizationCounts();
  await run(
    'bucket-first',
    process.execPath,
    [tsx, 'scripts/init-asset-storage.ts'],
    env,
  );
  await run(
    'bucket-second',
    process.execPath,
    [tsx, 'scripts/init-asset-storage.ts'],
    env,
  );
  await run(
    'asset-database-suite',
    process.execPath,
    [
      join(root, 'node_modules/vitest/vitest.mjs'),
      'run',
      '--config',
      'vitest.config.database.ts',
      'test/assets.db-spec.ts',
    ],
    env,
  );
  await run(
    'storage-suite',
    process.execPath,
    [
      join(root, 'node_modules/vitest/vitest.mjs'),
      'run',
      '--config',
      'vitest.config.storage-integration.ts',
    ],
    env,
  );
  await run(
    'verify-after',
    process.execPath,
    [tsx, 'scripts/verify-database.ts'],
    env,
  );
  const authorizationAfter = await authorizationCounts();
  assert.deepEqual(authorizationAfter, authorizationBefore);
  report.authorizationCounts = {
    before: authorizationBefore,
    after: authorizationAfter,
  };
  const injectedFunctions = await client.$queryRaw<Array<{ count: bigint }>>`
    SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname LIKE 'storage_audit_%'`;
  assert.equal(Number(injectedFunctions[0]!.count), 0);
  report.auditInjectionRemoved = true;
  const counts = {
    users: await client.user.count(),
    assets: await client.asset.count(),
    sessions: await client.authSession.count(),
    logs: await client.operationLog.count(),
    events: await client.outboxEvent.count(),
  };
  assert.deepEqual(counts, {
    users: 1,
    assets: 0,
    sessions: 0,
    logs: 0,
    events: 0,
  });
  report.finalCounts = counts;
  report.migrations = await client.$queryRaw<
    Array<{ count: bigint }>
  >`SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`.then(
    (rows) => Number(rows[0]!.count),
  );
  s3 = new S3Client({
    endpoint,
    forcePathStyle: true,
    region: 'us-east-1',
    maxAttempts: 1,
    credentials: { accessKeyId: account, secretAccessKey: s3Password! },
    requestHandler: { connectionTimeout: 3000, requestTimeout: 5000 },
  });
  assert.deepEqual(
    (await s3.send(new ListObjectsV2Command({ Bucket: bucket }))).Contents ??
      [],
    [],
  );
  report.bucketEmpty = true;
  report.completed = true;
} catch (error) {
  report.error = redact(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  s3?.destroy();
  try {
    await client?.$disconnect();
  } catch {
    report.disconnectError = true;
    process.exitCode = 1;
  }
  if (initialized) {
    try {
      await pgControl(['stop', '-D', pgData, '-m', 'fast', '-w', '-t', '45']);
      report.databaseStopped = true;
    } catch {
      report.databaseStopError = true;
      process.exitCode = 1;
    }
  }
  for (const { name, child, exited } of services.reverse()) {
    if (child.pid && child.exitCode === null && child.signalCode === null)
      child.kill();
    const stopped = await Promise.race([
      exited.then(() => true),
      delay(10_000).then(() => false),
    ]);
    report[`${name}Stopped`] = stopped;
    if (!stopped) process.exitCode = 1;
  }
  report.servicesStopped = services.every(
    ({ child }) =>
      !child.pid || child.exitCode !== null || child.signalCode !== null,
  );
  // Service startup diagnostics can contain generated credentials; never retain them.
  for (const { name } of services) {
    const log = join(output, `${name}.log`);
    await writeFile(log, redact(await readFile(log, 'utf8')));
  }
  report.portsClosed = (await Promise.all(ports.map(listening))).every(
    (open) => !open,
  );
  if (!report.portsClosed || !report.servicesStopped) process.exitCode = 1;
  try {
    await unlink(passwordFile);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') process.exitCode = 1;
  }
  await writeFile(
    join(output, 'report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.info(JSON.stringify(report, null, 2));
}
