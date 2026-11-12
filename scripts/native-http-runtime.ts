import assert from 'node:assert/strict';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
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

export async function runNativeHttpValidation(
  suite:
    | 'public-content'
    | 'admin-authorization'
    | 'revenue-recovery'
    | 'resort-list'
    | 'ai-mobile',
) {
  const admin = suite === 'admin-authorization';
  const revenue = suite === 'revenue-recovery';
  const resorts = suite === 'resort-list';
  const ai = suite === 'ai-mobile';
  const databaseName = ai
    ? 'linji_ai_mobile_validation'
    : resorts
      ? 'linji_resort_list_validation'
      : revenue
        ? 'linji_revenue_recovery_validation'
        : admin
          ? 'linji_admin_authorization_validation'
          : 'linji_public_content_validation';
  const fixtureScript = ai
    ? 'scripts/ai-mobile-http-fixture.ts'
    : resorts
      ? 'scripts/resort-list-http-fixture.ts'
      : revenue
        ? 'scripts/revenue-recovery-http-fixture.ts'
        : admin
          ? 'scripts/admin-authorization-http-fixture.ts'
          : 'scripts/public-content-http-fixture.ts';
  const pathEnv = ai
    ? 'AI_MOBILE_FIXTURE_PATH'
    : resorts
      ? 'RESORT_LIST_FIXTURE_PATH'
      : revenue
        ? 'REVENUE_HTTP_FIXTURE_PATH'
        : admin
          ? 'ADMIN_AUTH_HTTP_FIXTURE_PATH'
          : 'PUBLIC_CONTENT_HTTP_FIXTURE_PATH';
  const confirmEnv = ai
    ? 'AI_MOBILE_FIXTURE_CONFIRM'
    : resorts
      ? 'RESORT_LIST_FIXTURE_CONFIRM'
      : revenue
        ? 'REVENUE_HTTP_CONFIRM'
        : admin
          ? 'ADMIN_AUTH_HTTP_CONFIRM'
          : 'PUBLIC_CONTENT_HTTP_CONFIRM';
  if (admin || revenue || resorts)
    assert(
      process.env.ADMIN_AUTH_HTTP_PASSWORD &&
        Buffer.byteLength(process.env.ADMIN_AUTH_HTTP_PASSWORD) >= 8 &&
        Buffer.byteLength(process.env.ADMIN_AUTH_HTTP_PASSWORD) <= 72,
      'Explicit synthetic admin HTTP password required',
    );
  assert.equal(process.platform, 'win32');
  assert(
    process.env.LINJI_NATIVE_PG_ROOT && process.env.LINJI_NATIVE_PG_OUTPUT,
    'Explicit prepared PostgreSQL runtime and output root required',
  );
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const pgRoot = resolve(process.env.LINJI_NATIVE_PG_ROOT);
  const outputRoot = resolve(process.env.LINJI_NATIVE_PG_OUTPUT);
  assert(!/["\r\n]/u.test(outputRoot));
  await mkdir(outputRoot, { recursive: true });
  const output = await mkdtemp(
    join(
      outputRoot,
      ai
        ? 'linji-ai-http-'
        : resorts
          ? 'linji-resort-http-'
          : revenue
            ? 'linji-revenue-http-'
            : admin
              ? 'linji-admin-http-'
              : 'linji-public-http-',
    ),
  );
  const data = join(output, 'data'),
    passwordFile = join(output, 'init-password.txt');
  const password = randomBytes(32).toString('hex'),
    adminPassword =
      admin || revenue || resorts
        ? process.env.ADMIN_AUTH_HTTP_PASSWORD!
        : randomBytes(24).toString('hex'),
    jwtSecret = randomBytes(32).toString('hex'),
    providerKey = randomBytes(32).toString('hex');
  const checks: Array<{ name: string; passed: boolean }> = [];
  const report: Record<string, unknown> = {
    suite,
    output,
    checks,
    completed: false,
    stopped: false,
    serverStopped: false,
  };
  const exec = promisify(execFile);
  let initialized = false,
    server: ChildProcess | undefined,
    serverExit: Promise<void> | undefined,
    serverExited = false;
  let serverLog = '';
  let provider: ChildProcess | undefined,
    providerExit: Promise<void> | undefined,
    providerExited = false,
    providerLog = '';
  const redact = (value: string) =>
    [password, adminPassword, jwtSecret, providerKey].reduce(
      (text, secret) => text.replaceAll(secret, '[redacted]'),
      value,
    );
  const pg = (name: string) => join(pgRoot, 'bin', `${name}.exe`);
  async function run(
    name: string,
    executable: string,
    args: string[],
    env: NodeJS.ProcessEnv = process.env,
  ) {
    console.info(`Running ${name}`);
    try {
      const result = await exec(executable, args, {
        cwd: root,
        env,
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024,
        timeout: 180000,
      });
      await writeFile(
        join(output, `${name}.log`),
        redact(result.stdout + result.stderr),
      );
      checks.push({ name, passed: true });
      return result.stdout;
    } catch (error) {
      const failure = error as Error & { stdout?: string; stderr?: string };
      await writeFile(
        join(output, `${name}.log`),
        redact(
          `${failure.stdout ?? ''}\n${failure.stderr ?? ''}\n${failure.message}`,
        ),
      );
      checks.push({ name, passed: false });
      throw new Error(`${name} failed; inspect redacted log in ${output}`);
    }
  }
  async function port() {
    const probe = createServer();
    await new Promise<void>((accept, reject) => {
      probe.once('error', reject);
      probe.listen(0, '127.0.0.1', accept);
    });
    const address = probe.address();
    assert(address && typeof address !== 'string');
    const selected = address.port;
    await new Promise<void>((accept, reject) =>
      probe.close((error) => (error ? reject(error) : accept())),
    );
    return selected;
  }
  const delay = (milliseconds: number) =>
    new Promise<void>((accept) => setTimeout(accept, milliseconds));
  async function exists(path: string) {
    try {
      await readFile(path);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }
  try {
    const version = (
      await run('postgres-version', pg('postgres'), ['--version'])
    ).trim();
    assert.match(version, /PostgreSQL\) 17\./u);
    report.postgresVersion = version;
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
    const databasePort = await port();
    report.databasePort = databasePort;
    await appendFile(
      join(data, 'postgresql.conf'),
      `\nlisten_addresses='127.0.0.1'\nport=${databasePort}\nmax_connections=30\nshared_buffers='64MB'\n`,
    );
    // No output pipes: Windows postgres otherwise inherits pg_ctl's pipe handles.
    const started = await new Promise<number | null>((accept, reject) => {
      const child = spawn(
        pg('pg_ctl'),
        [
          'start',
          '-D',
          data,
          '-l',
          join(output, 'postgres.log'),
          '-w',
          '-t',
          '45',
        ],
        { cwd: root, windowsHide: true, stdio: 'ignore' },
      );
      child.once('error', reject);
      child.once('exit', accept);
    });
    assert.equal(started, 0);
    checks.push({ name: 'start-postgres', passed: true });
    report.database = databaseName;
    await run(
      'create-database',
      pg('createdb'),
      [
        '-h',
        '127.0.0.1',
        '-p',
        String(databasePort),
        '-U',
        'postgres',
        databaseName,
      ],
      { ...process.env, PGPASSWORD: password },
    );
    const apiPort = await port();
    report.apiPort = apiPort;
    const fixturePath = join(output, 'fixture.json');
    const providerPort = ai ? await port() : null;
    if (providerPort) report.providerPort = providerPort;
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: `postgresql://postgres:${password}@127.0.0.1:${databasePort}/${databaseName}?connection_limit=8`,
      INITIAL_ADMIN_ACCOUNT: revenue
        ? 'revenue_http_root'
        : admin
          ? 'admin_http_root'
          : `public_init_${randomBytes(6).toString('hex')}`,
      INITIAL_ADMIN_PASSWORD: adminPassword,
      ...(resorts ? { RESORT_LIST_FIXTURE_PASSWORD: adminPassword } : {}),
      ...(ai
        ? {
            AI_MOBILE_STATS_PATH: join(output, 'provider-counts.json'),
            AI_MOBILE_PROVIDER_PORT: String(providerPort),
            AI_MOBILE_PROVIDER_KEY: providerKey,
            EMBEDDING_BASE_URL: `http://127.0.0.1:${providerPort}/v1`,
            EMBEDDING_API_KEY: providerKey,
            EMBEDDING_MODEL: 'ai-mobile-fixture',
            CHAT_MODEL_BASE_URL: `http://127.0.0.1:${providerPort}/v1`,
            CHAT_MODEL_API_KEY: providerKey,
            CHAT_MODEL_NAME: 'ai-mobile-fixture',
          }
        : {}),
      JWT_ACCESS_SECRET: jwtSecret,
      LOGIN_RATE_LIMIT_SECRET: randomBytes(32).toString('hex'),
      PORT: String(apiPort),
      WEB_ORIGINS: 'http://127.0.0.1:3000,http://127.0.0.1:3001',
      KAFKA_BROKERS: '127.0.0.1:1',
      KAFKA_CONSUMER_ENABLED: 'false',
      OUTBOX_DISPATCH_ENABLED: 'false',
      S3_ENDPOINT: 'http://127.0.0.1:1',
      S3_PUBLIC_ENDPOINT: 'http://127.0.0.1:1',
      S3_REGION: 'us-east-1',
      S3_BUCKET: 'public-http',
      S3_ACCESS_KEY_ID: 'synthetic-key',
      S3_SECRET_ACCESS_KEY: 'public-http-synthetic-secret',
      [pathEnv]: fixturePath,
      [confirmEnv]: databaseName,
    };
    const prismaCli = join(root, 'node_modules', 'prisma', 'build', 'index.js'),
      tsxCli = join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
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
    if (ai) {
      provider = spawn(process.execPath, [tsxCli, fixtureScript, 'serve'], {
        cwd: root,
        env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      provider.stdout?.on('data', (chunk: Buffer) => {
        providerLog += chunk.toString();
      });
      provider.stderr?.on('data', (chunk: Buffer) => {
        providerLog += chunk.toString();
      });
      providerExit = new Promise<void>((accept, reject) => {
        provider!.once('error', reject);
        provider!.once('exit', () => {
          providerExited = true;
          accept();
        });
      });
      void providerExit.catch(() => undefined);
      let ready = false;
      for (let i = 0; i < 100; i++) {
        assert(!providerExited, 'Synthetic provider exited before readiness');
        try {
          const response = await fetch(
            `http://127.0.0.1:${providerPort}/health`,
            { signal: AbortSignal.timeout(1000) },
          );
          ready =
            response.ok &&
            ((await response.json()) as { kind?: string }).kind ===
              'linji-ai-mobile-fixture';
        } catch {
          /* startup only */
        }
        if (ready) break;
        await delay(200);
      }
      assert(ready, 'Synthetic provider did not become ready');
      checks.push({ name: 'fixture-prepare', passed: true });
    } else
      await run(
        'fixture-prepare',
        process.execPath,
        [tsxCli, fixtureScript, resorts ? 'create' : 'prepare'],
        env,
      );
    await readFile(join(root, 'dist', 'main.js'));
    server = spawn(process.execPath, ['dist/main.js'], {
      cwd: root,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stdout?.on('data', (chunk: Buffer) => {
      serverLog += chunk.toString();
    });
    server.stderr?.on('data', (chunk: Buffer) => {
      serverLog += chunk.toString();
    });
    serverExit = new Promise<void>((accept, reject) => {
      server!.once('error', reject);
      server!.once('exit', () => {
        serverExited = true;
        accept();
      });
    });
    // Attach a rejection observer while probing so startup errors cannot be unhandled.
    void serverExit.catch(() => undefined);
    const apiBaseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
    let healthy = false;
    for (let i = 0; i < 100; i++) {
      assert(!serverExited, 'Compiled backend exited before readiness');
      try {
        const response = await fetch(`${apiBaseUrl}/health`, {
          signal: AbortSignal.timeout(1000),
        });
        healthy = response.ok;
        await response.body?.cancel();
      } catch {
        /* startup only */
      }
      if (healthy) break;
      await delay(200);
    }
    assert(healthy, 'Compiled backend did not become healthy');
    checks.push({ name: 'compiled-api-ready', passed: true });
    const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as Record<
      string,
      unknown
    >;
    await writeFile(
      join(output, 'ready.json'),
      JSON.stringify({ apiBaseUrl, fixture }, null, 2),
    );
    console.info(`Ready: ${join(output, 'ready.json')}`);
    console.info(
      `After the independent HTTP suite passes, write exactly passed to ${join(output, 'stop.request')}`,
    );
    let requested = false;
    const revenueTicks = new Set<string>();
    for (let i = 0; i < 1800; i++) {
      assert(!serverExited, 'Compiled backend exited during validation');
      if (ai)
        assert(!providerExited, 'Synthetic provider exited during validation');
      if (revenue && (await exists(join(output, 'revenue-tick.request')))) {
        const id = (
          await readFile(join(output, 'revenue-tick.request'), 'utf8')
        ).trim();
        assert(
          /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/.test(
            id,
          ),
          'Invalid revenue recovery control token',
        );
        if (!revenueTicks.has(id)) {
          assert(
            revenueTicks.size < 20,
            'Revenue recovery control budget exceeded',
          );
          await run(
            `revenue-recover-${id}`,
            process.execPath,
            [tsxCli, fixtureScript, 'recover'],
            env,
          );
          revenueTicks.add(id);
          await writeFile(
            join(output, `revenue-tick.${id}.done`),
            'recovered',
            { flag: 'wx' },
          );
        }
      }
      if (await exists(join(output, 'stop.request'))) {
        assert.equal(
          (await readFile(join(output, 'stop.request'), 'utf8')).trim(),
          'passed',
          'Unconfirmed client validation',
        );
        requested = true;
        break;
      }
      await delay(500);
    }
    assert(
      requested,
      'Independent HTTP suite confirmation timed out after 15 minutes',
    );
    await run(
      'fixture-verify',
      process.execPath,
      [tsxCli, fixtureScript, 'verify'],
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
    report.error = redact(
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  } finally {
    if (server && !serverExited) server.kill();
    try {
      if (serverExit)
        await Promise.race([
          serverExit,
          delay(5000).then(() => {
            throw new Error('Backend termination not confirmed');
          }),
        ]);
      report.serverStopped = true;
    } catch {
      report.serverStopError = 'Cannot confirm isolated backend exited';
      process.exitCode = 1;
    }
    await writeFile(join(output, 'backend.log'), redact(serverLog));
    if (provider && !providerExited) provider.kill();
    if (providerExit) {
      try {
        await Promise.race([
          providerExit,
          delay(5000).then(() => {
            throw new Error('Synthetic provider termination not confirmed');
          }),
        ]);
        report.providerStopped = true;
      } catch {
        report.providerStopError =
          'Cannot confirm isolated synthetic provider exited';
        process.exitCode = 1;
      }
      await writeFile(join(output, 'provider.log'), redact(providerLog));
    }
    if (initialized) {
      try {
        if (await exists(join(data, 'postmaster.pid')))
          await run('stop-postgres', pg('pg_ctl'), [
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
        report.stopError = 'Inspect this run data directory and stop log';
        process.exitCode = 1;
      }
    }
    try {
      await unlink(passwordFile);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        process.exitCode = 1;
    }
    await writeFile(
      join(output, 'report.json'),
      JSON.stringify(report, null, 2),
    );
    console.info(JSON.stringify(report, null, 2));
  }
}
