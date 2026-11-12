import assert from 'node:assert/strict';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { openSync, closeSync } from 'node:fs';
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  unlink,
  writeFile,
  realpath,
} from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { Kafka, logLevel } from 'kafkajs';
import { PrismaClient } from '@prisma/client';

assert.equal(process.platform, 'win32');
assert(
  process.env.LINJI_NATIVE_PG_ROOT &&
    process.env.LINJI_NATIVE_KAFKA_ROOT &&
    process.env.LINJI_NATIVE_JAVA &&
    process.env.LINJI_NATIVE_KAFKA_OUTPUT,
  'Explicit prepared PostgreSQL17/pgvector, Kafka4.1.1, Java21 and output paths required',
);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pgRoot = await realpath(process.env.LINJI_NATIVE_PG_ROOT);
const kafkaRoot = await realpath(process.env.LINJI_NATIVE_KAFKA_ROOT);
const java = await realpath(process.env.LINJI_NATIVE_JAVA);
const outputRoot = resolve(process.env.LINJI_NATIVE_KAFKA_OUTPUT);
assert(!/["\r\n]/u.test(outputRoot));
await mkdir(outputRoot, { recursive: true });
const output = await mkdtemp(join(outputRoot, 'linji-kafka-'));
const javaTemp = join(output, 'java-temp');
await mkdir(javaTemp);
const data = join(output, 'data'),
  passwordFile = join(output, 'init-password.txt');
const password = randomBytes(32).toString('hex'),
  adminPassword = randomBytes(24).toString('hex'),
  token = randomBytes(32).toString('hex');
const checks: Array<{ name: string; passed: boolean }> = [];
const brokerTransitions: Array<{
  action: string;
  pid: number | null;
  time: string;
}> = [];
const report: Record<string, unknown> = {
  output,
  checks,
  brokerTransitions,
  completed: false,
  stopped: false,
  brokerStopped: false,
  controlStopped: false,
};
const exec = promisify(execFile);
let initialized = false,
  client: PrismaClient | undefined,
  broker: ChildProcess | undefined;
let brokerExit: Promise<void> | undefined;
let control: ReturnType<typeof createHttpServer> | undefined;
let brokerPort = 0;
const pg = (name: string) => join(pgRoot, 'bin', `${name}.exe`);
const redact = (value: string) =>
  value
    .replaceAll(password, '[redacted]')
    .replaceAll(adminPassword, '[redacted]')
    .replaceAll(token, '[redacted]');
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
      maxBuffer: 32 * 1024 * 1024,
      timeout: 15 * 60_000,
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
    throw new Error(`${name} failed; inspect its redacted log in ${output}`);
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
    server.close((error) => (error ? no(error) : yes())),
  );
  return address.port;
}
const kafkaArgs = (main: string, ...args: string[]) => [
  '-Xms128m',
  '-Xmx512m',
  `-Djdk.net.unixdomain.tmpdir=${javaTemp}`,
  `-Djava.io.tmpdir=${javaTemp}`,
  `-Dkafka.logs.dir=${join(output, 'kafka-logs')}`,
  `-Dlog4j2.configurationFile=${join(kafkaRoot, 'config', 'log4j2.yaml')}`,
  '-cp',
  join(kafkaRoot, 'libs', '*'),
  main,
  ...args,
];
async function ready() {
  const until = Date.now() + 90_000;
  while (Date.now() < until) {
    if (!broker || broker.exitCode !== null || broker.signalCode !== null)
      throw new Error('Owned Kafka process exited before readiness');
    const admin = new Kafka({
      clientId: 'linji-native-readiness',
      brokers: [`127.0.0.1:${brokerPort}`],
      logLevel: logLevel.NOTHING,
      connectionTimeout: 1000,
      requestTimeout: 1000,
      retry: { retries: 0 },
    }).admin();
    try {
      await admin.connect();
      await admin.describeCluster();
      return;
    } catch {
      await delay(200);
    } finally {
      await admin.disconnect();
    }
  }
  throw new Error('Owned Kafka process readiness timed out');
}
async function startBroker() {
  if (broker && broker.exitCode === null && broker.signalCode === null) return;
  const fd = openSync(join(output, 'broker.log'), 'a');
  try {
    broker = spawn(
      java,
      kafkaArgs('kafka.Kafka', join(output, 'server.properties')),
      { cwd: output, windowsHide: true, stdio: ['ignore', fd, fd] },
    );
  } finally {
    closeSync(fd);
  }
  const child = broker;
  brokerExit = new Promise<void>((yes, no) => {
    child.once('error', no);
    child.once('exit', () => yes());
  });
  // Keep the rejection observed even when readiness fails first.
  void brokerExit.catch(() => undefined);
  await ready();
  brokerTransitions.push({
    action: 'start',
    pid: child.pid ?? null,
    time: new Date().toISOString(),
  });
}
async function stopBroker() {
  const child = broker;
  if (!child) return;
  if (child.exitCode === null && child.signalCode === null) {
    assert(child.pid, 'Owned broker PID required');
    assert(child.kill(), 'Owned Kafka process termination refused');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        brokerExit,
        new Promise<never>((_, no) => {
          timer = setTimeout(
            () => no(new Error('Owned Kafka process did not stop')),
            30_000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    brokerTransitions.push({
      action: 'stop',
      pid: child.pid ?? null,
      time: new Date().toISOString(),
    });
  }
}
try {
  await run('java-version', java, ['-version']);
  // -version writes to stderr; preserve its complete log, and check the actual runtime.
  assert.match(
    await readFile(join(output, 'java-version.log'), 'utf8'),
    /version "21\./u,
  );
  report.javaVersion = (
    await readFile(join(output, 'java-version.log'), 'utf8')
  ).trim();
  await realpath(join(kafkaRoot, 'libs', 'kafka_2.13-4.1.1.jar'));
  report.kafkaVersion = '4.1.1';
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
  const pgPort = await availablePort();
  brokerPort = await availablePort();
  let controllerPort = await availablePort();
  while (new Set([pgPort, brokerPort, controllerPort]).size !== 3) {
    brokerPort = await availablePort();
    controllerPort = await availablePort();
  }
  report.databasePort = pgPort;
  report.brokerPort = brokerPort;
  report.controllerPort = controllerPort;
  await appendFile(
    join(data, 'postgresql.conf'),
    `\nlisten_addresses='127.0.0.1'\nport=${pgPort}\nmax_connections=60\nshared_buffers='64MB'\n`,
  );
  const started = await new Promise<number | null>((yes, no) => {
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
    child.once('error', no);
    child.once('exit', yes);
  });
  assert.equal(started, 0);
  checks.push({ name: 'start-postgres', passed: true });
  const database = 'linji_kafka_validation';
  report.database = database;
  await run(
    'create-database',
    pg('createdb'),
    ['-h', '127.0.0.1', '-p', String(pgPort), '-U', 'postgres', database],
    { ...process.env, PGPASSWORD: password },
  );
  const url = `postgresql://postgres:${password}@127.0.0.1:${pgPort}/${database}?connection_limit=8`;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: url,
    INITIAL_ADMIN_ACCOUNT: 'native_kafka_admin',
    INITIAL_ADMIN_PASSWORD: adminPassword,
    LINJI_DATABASE_TEST_DISPOSABLE: 'true',
    KAFKA_INTEGRATION_BROKERS: `127.0.0.1:${brokerPort}`,
    KAFKA_RECOVERY_CONTAINER_ID: undefined,
    KAFKA_RECOVERY_NATIVE_URL: undefined,
    KAFKA_RECOVERY_NATIVE_TOKEN: undefined,
    VITEST_MAX_WORKERS: '1',
  };
  const tsx = join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  await run(
    'migrate-deploy',
    process.execPath,
    [
      join(root, 'node_modules', 'prisma', 'build', 'index.js'),
      'migrate',
      'deploy',
    ],
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
  report.pgvectorVersion = await client.$queryRaw<
    Array<{ extversion: string }>
  >`SELECT extversion FROM pg_extension WHERE extname='vector'`.then(
    (rows) => rows[0]?.extversion,
  );
  report.migrations = await client.$queryRaw<
    Array<{ count: bigint }>
  >`SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`.then(
    (rows) => Number(rows[0]?.count),
  );
  const config = [
    `process.roles=broker,controller`,
    `node.id=1`,
    `controller.quorum.voters=1@127.0.0.1:${controllerPort}`,
    `listeners=PLAINTEXT://127.0.0.1:${brokerPort},CONTROLLER://127.0.0.1:${controllerPort}`,
    `advertised.listeners=PLAINTEXT://127.0.0.1:${brokerPort}`,
    'controller.listener.names=CONTROLLER',
    'listener.security.protocol.map=CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT',
    'inter.broker.listener.name=PLAINTEXT',
    `log.dirs=${join(output, 'kafka-data').replaceAll('\\', '/')}`,
    'offsets.topic.replication.factor=1',
    'transaction.state.log.replication.factor=1',
    'transaction.state.log.min.isr=1',
    'group.initial.rebalance.delay.ms=0',
    'num.partitions=1',
    'delete.topic.enable=true',
    'log.retention.hours=1',
    'num.network.threads=2',
    'num.io.threads=2',
  ].join('\n');
  await writeFile(join(output, 'server.properties'), config + '\n', {
    flag: 'wx',
  });
  const clusterOutput = (
    await run(
      'cluster-id',
      java,
      kafkaArgs('kafka.tools.StorageTool', 'random-uuid'),
    )
  ).trim();
  const clusterIds = clusterOutput
    .split(/\r?\n/u)
    .filter((line) => /^[A-Za-z0-9_-]{22}$/u.test(line));
  assert.equal(
    clusterIds.length,
    1,
    'Expected one Kafka cluster UUID in CLI output',
  );
  const clusterId = clusterIds[0]!;
  assert.match(clusterId, /^[A-Za-z0-9_-]{22}$/u);
  await run(
    'storage-format',
    java,
    kafkaArgs(
      'kafka.tools.StorageTool',
      'format',
      '-t',
      clusterId,
      '-c',
      join(output, 'server.properties'),
    ),
  );
  await startBroker();
  checks.push({ name: 'broker-ready', passed: true });
  let busy = false,
    closing = false;
  control = createHttpServer((request, response) => {
    if (closing || request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(403).end();
      return;
    }
    const path = request.url;
    if (!(
      (path === '/identity' && request.method === 'GET') ||
      ((path === '/start' || path === '/stop') && request.method === 'POST')
    )) {
      response.writeHead(404).end();
      return;
    }
    if (busy) {
      response.writeHead(409).end();
      return;
    }
    busy = true;
    void (async () => {
      try {
        if (path === '/stop') await stopBroker();
        if (path === '/start') await startBroker();
        response
          .writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
          })
          .end(
            JSON.stringify({
              kind: 'linji-native-kafka-recovery',
              version: '4.1.1',
              broker: `127.0.0.1:${brokerPort}`,
              running:
                !!broker &&
                broker.exitCode === null &&
                broker.signalCode === null,
            }),
          );
      } catch {
        response.writeHead(503).end();
      } finally {
        busy = false;
      }
    })();
  });
  await new Promise<void>((yes, no) => {
    control!.once('error', no);
    control!.listen(0, '127.0.0.1', yes);
  });
  const controlAddress = control.address();
  assert(controlAddress && typeof controlAddress !== 'string');
  report.controlPort = controlAddress.port;
  env.KAFKA_RECOVERY_NATIVE_URL = `http://127.0.0.1:${controlAddress.port}/`;
  env.KAFKA_RECOVERY_NATIVE_TOKEN = token;
  await run(
    'integration-suite',
    process.execPath,
    [
      join(root, 'node_modules', 'vitest', 'vitest.mjs'),
      'run',
      '--config',
      'vitest.config.integration.ts',
    ],
    env,
  );
  await run(
    'verify-after',
    process.execPath,
    [tsx, 'scripts/verify-database.ts'],
    env,
  );
  const counts = {
    users: await client.user.count(),
    projects: await client.projectKnowledge.count(),
    documents: await client.ragDocument.count(),
    outbox: await client.outboxEvent.count(),
    inbox: await client.consumedEvent.count(),
  };
  assert.deepEqual(counts, {
    users: 1,
    projects: 0,
    documents: 0,
    outbox: 0,
    inbox: 0,
  });
  report.finalCounts = counts;
  const admin = new Kafka({
    clientId: 'linji-native-final',
    brokers: [`127.0.0.1:${brokerPort}`],
    logLevel: logLevel.NOTHING,
  }).admin();
  try {
    await admin.connect();
    const topics = (await admin.listTopics()).filter(
      (topic) => !topic.startsWith('__'),
    );
    const groups = (await admin.listGroups()).groups;
    assert.deepEqual(topics, []);
    assert.deepEqual(groups, []);
    report.finalTopics = topics;
    report.finalGroups = groups;
  } finally {
    await admin.disconnect();
  }
  closing = true;
  report.completed = true;
} catch (error) {
  report.error = redact(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  try {
    if (control) {
      await new Promise<void>((yes, no) =>
        control!.close((error) => (error ? no(error) : yes())),
      );
    }
    report.controlStopped = true;
  } catch {
    report.controlStopError = 'Control server stop not confirmed';
    process.exitCode = 1;
  }
  try {
    await stopBroker();
    report.brokerStopped =
      !broker || broker.exitCode !== null || broker.signalCode !== null;
  } catch {
    report.brokerStopError = 'Owned Kafka process stop not confirmed';
    process.exitCode = 1;
  }
  try {
    await client?.$disconnect();
  } catch {
    report.disconnectError = 'Prisma disconnect failed';
    process.exitCode = 1;
  }
  if (initialized) {
    try {
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
      report.stopError = 'Owned PostgreSQL stop not confirmed';
      process.exitCode = 1;
    }
  }
  try {
    await unlink(passwordFile);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      process.exitCode = 1;
  }
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.info(JSON.stringify(report, null, 2));
}
