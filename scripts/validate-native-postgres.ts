import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { PrismaClient } from '@prisma/client';

// Disposable Windows cluster only: never accept an existing DATABASE_URL/data directory.
assert.equal(
  process.platform,
  'win32',
  'This harness requires Windows PostgreSQL 17',
);
assert(
  process.env.LINJI_NATIVE_PG_ROOT,
  'Set LINJI_NATIVE_PG_ROOT to prepared PostgreSQL 17 with pgvector',
);
assert(
  process.env.LINJI_NATIVE_PG_OUTPUT,
  'Set LINJI_NATIVE_PG_OUTPUT to a directory with sufficient space',
);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pgRoot = resolve(process.env.LINJI_NATIVE_PG_ROOT);
const outputRoot = resolve(process.env.LINJI_NATIVE_PG_OUTPUT);
// pg_ctl internally parses its initdb option string. Reject quote/control injection.
assert(
  !/["\r\n]/u.test(outputRoot),
  'Validation path must not contain quotes/newlines',
);
await mkdir(outputRoot, { recursive: true });
const output = await mkdtemp(join(outputRoot, 'linji-native-'));
const data = join(output, 'data');
const passwordFile = join(output, 'init-password.txt');
const password = randomBytes(32).toString('hex');
const adminPassword = randomBytes(24).toString('hex');
const account = `native_${randomBytes(6).toString('hex')}`;
const exec = promisify(execFile);
const checks: Array<{ name: string; passed: boolean }> = [];
const report: Record<string, unknown> = {
  output,
  checks,
  completed: false,
  stopped: false,
};
let initialized = false;
let client: PrismaClient | undefined;

function redact(value: string): string {
  return value
    .replaceAll(password, '[redacted]')
    .replaceAll(adminPassword, '[redacted]');
}
async function run(
  name: string,
  executable: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  console.info(`Running ${name}`);
  try {
    const result = await exec(executable, args, {
      cwd: root,
      env,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
      timeout: 15 * 60_000,
    });
    await writeFile(
      join(output, `${name}.log`),
      redact(result.stdout + result.stderr),
    );
    checks.push({ name, passed: true });
    return result.stdout;
  } catch (error) {
    checks.push({ name, passed: false });
    const failure = error as Error & { stdout?: string; stderr?: string };
    await writeFile(
      join(output, `${name}.log`),
      redact(
        `${failure.stdout ?? ''}\n${failure.stderr ?? ''}\n${failure.message}`,
      ),
    );
    throw new Error(`${name} failed; see its redacted log in ${output}`);
  }
}
function pg(name: string): string {
  return join(pgRoot, 'bin', `${name}.exe`);
}
async function startCluster(): Promise<void> {
  console.info('Running start');
  // Windows postgres can inherit pg_ctl's pipe handles after pg_ctl has exited.
  // No pipes here: server diagnostics go to its dedicated logfile, and we await
  // the controller's exit rather than the lifetime of the server's handles.
  const code = await new Promise<number | null>((accept, reject) => {
    const child = spawn(
      pg('pg_ctl'),
      ['start', '-D', data, '-l', join(output, 'server.log'), '-w', '-t', '45'],
      { cwd: root, windowsHide: true, stdio: 'ignore' },
    );
    child.once('error', reject);
    child.once('exit', accept);
  });
  const passed = code === 0;
  checks.push({ name: 'start', passed });
  await writeFile(
    join(output, 'start.log'),
    `pg_ctl exited ${code}; see server.log\n`,
  );
  assert(passed, `PostgreSQL startup failed; inspect ${output}`);
}
async function availablePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((accept, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', accept);
  });
  const address = probe.address();
  assert(address && typeof address !== 'string');
  const port = address.port;
  await new Promise<void>((accept, reject) =>
    probe.close((error) => (error ? reject(error) : accept())),
  );
  return port;
}

try {
  const version = (
    await run('postgres-version', pg('postgres'), ['--version'])
  ).trim();
  assert.match(version, /PostgreSQL\) 17\./u);
  report.postgresVersion = version;
  // Do not print or persist ambient credentials in the report.
  await writeFile(passwordFile, `${password}\n`, { flag: 'wx', mode: 0o600 });
  await run('initialize', pg('pg_ctl'), [
    'initdb',
    '-D',
    data,
    '-o',
    `--username=postgres --auth=scram-sha-256 --encoding=UTF8 --locale=C --pwfile="${passwordFile}"`,
  ]);
  initialized = true;
  await unlink(passwordFile);
  const port = await availablePort();
  report.port = port;
  await appendFile(
    join(data, 'postgresql.conf'),
    `\nlisten_addresses = '127.0.0.1'\nport = ${port}\nmax_connections = 60\nshared_buffers = '64MB'\n`,
  );
  await startCluster();
  // Keep the password-reset suite's existing dedicated-database safety gate.
  const dbName = 'linji_password_validation';
  report.database = dbName;
  await run(
    'create-database',
    pg('createdb'),
    ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', dbName],
    { ...process.env, PGPASSWORD: password },
  );
  const url = `postgresql://postgres:${password}@127.0.0.1:${port}/${dbName}?connection_limit=8`;
  const env = {
    ...process.env,
    DATABASE_URL: url,
    INITIAL_ADMIN_ACCOUNT: account,
    INITIAL_ADMIN_PASSWORD: adminPassword,
    VITEST_MAX_WORKERS: '1',
  };
  const prismaCli = join(root, 'node_modules', 'prisma', 'build', 'index.js');
  const tsxCli = join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  await run(
    'migrate-deploy',
    process.execPath,
    [prismaCli, 'migrate', 'deploy'],
    env,
  );
  await run('seed-first', process.execPath, [tsxCli, 'prisma/seed.ts'], env);
  await run('seed-second', process.execPath, [tsxCli, 'prisma/seed.ts'], env);
  await run(
    'verify-before',
    process.execPath,
    [tsxCli, 'scripts/verify-database.ts'],
    env,
  );
  client = new PrismaClient({ datasourceUrl: url });
  const extensions = await client.$queryRaw<
    Array<{ extversion: string }>
  >`SELECT extversion FROM pg_extension WHERE extname = 'vector'`;
  assert.equal(extensions.length, 1);
  report.pgvectorVersion = extensions[0]!.extversion;
  report.migrations = await client.$queryRaw<
    Array<{ count: bigint }>
  >`SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`.then(
    (rows) => Number(rows[0]!.count),
  );
  await run(
    'database-suite',
    process.execPath,
    [
      join(root, 'node_modules', 'vitest', 'vitest.mjs'),
      'run',
      '--config',
      'vitest.config.database.ts',
    ],
    env,
  );
  await run(
    'verify-after',
    process.execPath,
    [tsxCli, 'scripts/verify-database.ts'],
    env,
  );
  report.completed = true;
} catch (error) {
  report.error = redact(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  try {
    await client?.$disconnect();
  } catch {
    report.disconnectError = 'Prisma client disconnect failed';
    process.exitCode = 1;
  }
  // Only pg_ctl for our mkdtemp-created cluster; no service/global process operations.
  if (initialized) {
    try {
      let pid: string | undefined;
      try {
        pid = (await readFile(join(data, 'postmaster.pid'), 'utf8')).split(
          /\r?\n/u,
        )[0];
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      if (pid)
        await run('stop', pg('pg_ctl'), [
          'stop',
          '-D',
          data,
          '-m',
          'fast',
          '-w',
          '-t',
          '45',
        ]);
      report.stopped = true;
    } catch {
      report.stopError =
        'Cannot confirm disposable cluster stopped; inspect its postmaster.pid and stop log';
      process.exitCode = 1;
    }
  }
  try {
    await unlink(passwordFile);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      process.exitCode = 1;
  }
  // Keep the test data/logs for diagnosis; no recursive deletion or system service install.
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.info(JSON.stringify(report, null, 2));
}
