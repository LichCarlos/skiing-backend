import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { PrismaClient } from '@prisma/client';

// This harness creates its own database. It never accepts DATABASE_URL.
const exec = promisify(execFile);
const label = 'backend-container';
const suffix = randomBytes(6).toString('hex');
const networkName = `linji-container-${suffix}`;
const image = process.env.CONTAINER_RUNTIME_IMAGE ?? 'linji/backend:validation';
const toolsImage =
  process.env.CONTAINER_TOOLS_IMAGE ?? 'linji/backend-tools:validation';
const root = resolve(process.env.LINJI_CONTAINER_VALIDATION_DIR ?? tmpdir());
await mkdir(root, { recursive: true });
const output = await mkdtemp(join(root, 'linji-container-'));
const pgPassword = randomBytes(24).toString('hex');
const password = randomBytes(24).toString('hex');
const jwt = randomBytes(40).toString('hex');
const account = `container_${suffix}`;
const dbName = 'linji_container_validation';
const privateFiles: string[] = [];
const containers: Array<{ id: string; name: string }> = [];
const report: Record<string, unknown> = {
  output,
  image,
  toolsImage,
  checks: [],
};
let networkId: string | undefined;
let prisma: PrismaClient | undefined;
let releaseLock: (() => void) | undefined;
let lockTransaction: Promise<void> | undefined;
let stopPromise: Promise<string> | undefined;
let loginPromise: Promise<Response> | undefined;

function redact(text: string): string {
  for (const secret of [pgPassword, password, jwt])
    text = text.replaceAll(secret, '[redacted]');
  return text;
}
async function docker(...args: string[]): Promise<string> {
  try {
    const { stdout } = await exec('docker', args, {
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
      timeout: 240_000,
    });
    return stdout.trim();
  } catch (error) {
    throw new Error(
      redact(error instanceof Error ? error.message : String(error)),
    );
  }
}
async function privateEnv(
  name: string,
  values: Record<string, string>,
): Promise<string> {
  const path = join(output, name);
  assert.ok(Object.values(values).every((value) => !/[\r\n]/.test(value)));
  await writeFile(
    path,
    Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n'),
    { mode: 0o600 },
  );
  privateFiles.push(path);
  return path;
}
async function create(name: string, args: string[]): Promise<string> {
  const id = await docker(
    'create',
    '--name',
    name,
    '--label',
    `linji.validation=${label}`,
    ...args,
  );
  assert.match(id, /^[0-9a-f]{64}$/);
  containers.push({ id, name });
  return id;
}
async function inspect(id: string) {
  const [value] = JSON.parse(await docker('inspect', id));
  return value;
}
async function until(
  check: () => Promise<boolean>,
  description: string,
  timeout = 60_000,
) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await delay(250);
  }
  throw new Error(`Timed out: ${description}`);
}
function passed(check: string) {
  (report.checks as string[]).push(check);
  console.log(`PASS ${check}`);
}

try {
  console.log(`Disposable container validation: ${output}`);
  networkId = await docker(
    'network',
    'create',
    '--label',
    `linji.validation=${label}`,
    networkName,
  );
  const pgEnv = await privateEnv('postgres.env', {
    POSTGRES_USER: 'postgres',
    POSTGRES_PASSWORD: pgPassword,
    POSTGRES_DB: dbName,
  });
  const pg = await create(`${networkName}-db`, [
    '--network',
    networkName,
    '--network-alias',
    'postgres',
    '--env-file',
    pgEnv,
    '-p',
    '127.0.0.1::5432',
    'pgvector/pgvector:pg17',
  ]);
  await docker('start', pg);
  await until(async () => {
    try {
      await docker('exec', pg, 'pg_isready', '-U', 'postgres', '-d', dbName);
      return true;
    } catch {
      return false;
    }
  }, 'disposable PostgreSQL startup');
  const pgState = await inspect(pg);
  const pgPort = pgState.NetworkSettings.Ports['5432/tcp'][0]
    .HostPort as string;
  prisma = new PrismaClient({
    datasources: {
      db: {
        url: `postgresql://postgres:${pgPassword}@127.0.0.1:${pgPort}/${dbName}`,
      },
    },
  });
  const common = {
    DATABASE_URL: `postgresql://postgres:${pgPassword}@postgres:5432/${dbName}`,
    INITIAL_ADMIN_ACCOUNT: account,
    INITIAL_ADMIN_PASSWORD: password,
    JWT_ACCESS_SECRET: jwt,
    LOGIN_RATE_LIMIT_SECRET: randomBytes(32).toString('hex'),
    WEB_ORIGINS: 'https://admin.example.invalid',
    KAFKA_BROKERS: '127.0.0.1:1',
    KAFKA_CONSUMER_ENABLED: 'false',
    OUTBOX_DISPATCH_ENABLED: 'false',
  };
  const toolsEnv = await privateEnv('tools.env', common);
  const runtimeValues = {
    ...common,
    INITIAL_ADMIN_ACCOUNT: '',
    INITIAL_ADMIN_PASSWORD: '',
  };
  const runtimeEnv = await privateEnv('runtime.env', runtimeValues);
  let index = 0;
  for (const command of ['db:deploy', 'db:seed', 'db:seed', 'db:verify']) {
    const id = await create(`${networkName}-tools-${index++}`, [
      '--init',
      '--network',
      networkName,
      '--env-file',
      toolsEnv,
      '--read-only',
      '--tmpfs',
      '/tmp:rw,noexec,nosuid,size=64m,mode=1777',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges:true',
      toolsImage,
      'pnpm',
      command,
    ]);
    const logs = await docker('start', '-a', id);
    await writeFile(
      join(output, `${command.replace(':', '-')}-${index}.log`),
      redact(logs),
    );
    assert.equal((await inspect(id)).State.ExitCode, 0, command);
    passed(`tools image ${command} (${index})`);
  }
  assert.equal(await prisma.user.count(), 1);
  const runtime = await create(`${networkName}-api`, [
    '--init',
    '--network',
    networkName,
    '--env-file',
    runtimeEnv,
    '-p',
    '127.0.0.1::8080',
    '--read-only',
    '--tmpfs',
    '/tmp:rw,noexec,nosuid,size=64m,mode=1777',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges:true',
    image,
  ]);
  await docker('start', runtime);
  const state = await inspect(runtime);
  assert.equal(state.Config.User, 'node');
  assert.equal(state.HostConfig.ReadonlyRootfs, true);
  const port = state.NetworkSettings.Ports['8080/tcp'][0].HostPort as string;
  let endpoint = `http://127.0.0.1:${port}/api/v1`;
  report.runtimeImageId = state.Image;
  await until(async () => {
    try {
      return (
        await fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(1500) })
      ).ok;
    } catch {
      return false;
    }
  }, 'API health');
  await until(
    async () => (await inspect(runtime)).State.Health.Status === 'healthy',
    'Docker liveness',
  );
  passed('non-root read-only runtime and Docker liveness');
  report.runtimeNode = await docker(
    'exec',
    runtime,
    'node',
    '--input-type=module',
    '-e',
    [
      "import assert from 'node:assert/strict';",
      "import {existsSync} from 'node:fs';",
      "import {createRequire} from 'node:module'; const require=createRequire(import.meta.url);",
      "for (const path of ['/app/.env','/app/src','/app/prisma','/app/scripts','/app/node_modules/typescript','/app/node_modules/prisma','/app/node_modules/vitest']) assert.equal(existsSync(path),false,path);",
      "require('@prisma/client'); assert.equal(process.getuid(),1000); console.log(process.version);",
    ].join('\n'),
  );
  passed(
    'runtime excludes source, environment files and development tooling; Linux Prisma loads',
  );
  for (const path of [
    '/public/config',
    '/resorts?page=1&pageSize=20',
    '/articles?page=1&pageSize=20',
  ]) {
    assert.equal(
      (
        await fetch(`${endpoint}${path}`, {
          signal: AbortSignal.timeout(15_000),
        })
      ).status,
      200,
    );
  }
  assert.equal((await fetch(`${endpoint}/auth/me`)).status, 401);
  passed('real PostgreSQL-backed public HTTP and private endpoint protection');

  // Hold a real DB table lock, rather than adding a test route/hook to the product.
  let lockReady!: () => void;
  const ready = new Promise<void>((resolveReady) => {
    lockReady = resolveReady;
  });
  const gate = new Promise<void>((resolveGate) => {
    releaseLock = resolveGate;
  });
  lockTransaction = prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('LOCK TABLE "User" IN ACCESS EXCLUSIVE MODE');
      lockReady();
      await gate;
    },
    { timeout: 60_000 },
  );
  // Attach handlers immediately, even if a later assertion fails.
  void lockTransaction.catch(() => undefined);
  await Promise.race([
    ready,
    lockTransaction.then(() => {
      throw new Error('Lock ended before readiness');
    }),
  ]);
  loginPromise = fetch(`${endpoint}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account, password }),
    signal: AbortSignal.timeout(60_000),
  });
  void loginPromise.catch(() => undefined);
  await until(async () => {
    const waiting = await prisma!.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`;
    return Number(waiting[0]?.count) > 0;
  }, 'HTTP login actually blocked on PostgreSQL');
  const signalSince = new Date(Date.now() - 1000).toISOString();
  stopPromise = docker('stop', '--time', '180', runtime);
  void stopPromise.catch(() => undefined);
  await until(
    async () => {
      const events = await docker(
        'events',
        '--since',
        signalSince,
        '--until',
        new Date().toISOString(),
        '--filter',
        `container=${runtime}`,
        '--filter',
        'event=kill',
        '--format',
        '{{json .}}',
      );
      return events
        .split('\n')
        .filter(Boolean)
        .some((line) => {
          const event = JSON.parse(line) as {
            Actor: { Attributes: { signal?: string } };
          };
          return event.Actor.Attributes.signal === '15';
        });
    },
    'Docker actually delivered SIGTERM',
    10_000,
  );
  assert.equal(
    (await inspect(runtime)).State.Running,
    true,
    'SIGTERM must wait for active HTTP',
  );
  releaseLock?.();
  await lockTransaction;
  const response = await loginPromise;
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    data: { accessToken: string; refreshToken: string };
  };
  assert.ok(body.data.accessToken && body.data.refreshToken);
  await stopPromise;
  const stopped = await inspect(runtime);
  assert.equal(stopped.State.OOMKilled, false);
  assert.equal(
    stopped.State.ExitCode,
    143,
    'SIGTERM forwarded; no timeout/SIGKILL',
  );
  assert.equal(await prisma.authSession.count(), 1);
  passed(
    'real docker SIGTERM drains active login and persists its session before exit 143',
  );
  await docker('start', runtime);
  const restartPort = (await inspect(runtime)).NetworkSettings.Ports[
    '8080/tcp'
  ][0].HostPort as string;
  endpoint = `http://127.0.0.1:${restartPort}/api/v1`;
  await until(async () => {
    try {
      return (
        await fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(1500) })
      ).ok;
    } catch {
      return false;
    }
  }, 'API restart');
  const me = await fetch(`${endpoint}/auth/me`, {
    headers: { Authorization: `Bearer ${body.data.accessToken}` },
  });
  assert.equal(me.status, 200);
  passed(
    'same production container restarts and authenticates the persisted session',
  );
  await docker('stop', '--time', '180', runtime);
  report.runtimeId = runtime;
  report.databaseId = pg;
  report.signalExitCode = stopped.State.ExitCode;
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = redact(
    error instanceof Error ? (error.stack ?? error.message) : String(error),
  );
  process.exitCode = 1;
  console.error(report.error);
} finally {
  releaseLock?.();
  await Promise.allSettled([lockTransaction, loginPromise, stopPromise]);
  await prisma?.$disconnect();
  const removed: string[] = [];
  try {
    for (const resource of containers.reverse()) {
      const value = await inspect(resource.id);
      assert.equal(value.Id, resource.id);
      assert.equal(value.Name, `/${resource.name}`);
      assert.equal(value.Config.Labels['linji.validation'], label);
      if (value.State.Running)
        await docker('stop', '--time', '180', resource.id);
      await writeFile(
        join(output, `${resource.name}.log`),
        redact(await docker('logs', resource.id)),
      );
      await docker('rm', '-v', resource.id);
      removed.push(resource.id);
    }
    if (networkId) {
      const [network] = JSON.parse(
        await docker('network', 'inspect', networkId),
      );
      assert.equal(network.Id, networkId);
      assert.equal(network.Name, networkName);
      assert.equal(network.Labels['linji.validation'], label);
      await docker('network', 'rm', networkId);
    }
    report.cleanup = { containers: removed, networkId, complete: true };
  } catch (error) {
    report.cleanup = {
      containers: removed,
      complete: false,
      error: redact(String(error)),
    };
    process.exitCode = 1;
  }
  for (const path of privateFiles) await unlink(path);
  report.credentialsRemoved = true;
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`Report: ${join(output, 'report.json')}`);
}
