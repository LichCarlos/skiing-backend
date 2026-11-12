import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  appendFile,
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { createConnection, createServer } from 'node:net';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { PrismaClient as PrismaClientType } from '@prisma/client';
import { databaseConnection, postgresEnvironment } from './database-backup.js';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const execute = promisify(execFile);
const confirmation = 'synthetic-new-clusters-only';
interface Cluster {
  name: string;
  data: string;
  port: number;
  initialized: boolean;
  stopped: boolean;
  portClosed?: boolean;
}
interface Check {
  label: string;
  exitCode: number;
  expectedExitCode: number;
}
interface Report extends Record<string, unknown> {
  completed: boolean;
  stopped: boolean;
  checks: Check[];
  clusters: Cluster[];
  sourceHashes: Record<string, string>;
}

export function recoverySettings(env: NodeJS.ProcessEnv) {
  if (env.LINJI_DATABASE_RECOVERY_CONFIRM !== confirmation)
    throw new Error(
      'Explicit synthetic-new-clusters-only confirmation required',
    );
  const pgBin = env.LINJI_DATABASE_RECOVERY_PG_BIN;
  const outputParent = env.LINJI_DATABASE_RECOVERY_OUTPUT;
  for (const path of [pgBin, outputParent])
    if (!path || !isAbsolute(path) || /["'\r\n\0]/u.test(path))
      throw new Error(
        'Absolute PostgreSQL bin and existing external output paths required',
      );
  return { pgBin: pgBin!, outputParent: outputParent! };
}

export function recoveryEnvironment(
  original: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const env = { ...original };
  for (const key of Object.keys(env))
    if (
      /^(?:PG|PRISMA_)/iu.test(key) ||
      /^(?:DATABASE_URL|BACKUP_ENCRYPTION_KEY|NODE_PATH|INITIAL_ADMIN_ACCOUNT|INITIAL_ADMIN_PASSWORD)$/iu.test(
        key,
      )
    )
      delete env[key];
  return env;
}

export function outsideRepository(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path);
}

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((yes, no) => {
    server.once('error', no);
    server.listen(0, '127.0.0.1', yes);
  });
  const address = server.address();
  assert(address && typeof address === 'object');
  await new Promise<void>((yes, no) =>
    server.close((error) => (error ? no(error) : yes())),
  );
  return address.port;
}
async function portClosed(port: number): Promise<boolean> {
  return new Promise((yes) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      yes(false);
    });
    socket.once('error', () => yes(true));
    socket.setTimeout(2000, () => {
      socket.destroy();
      yes(false);
    });
  });
}
const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"';

export async function main(): Promise<void> {
  const settings = recoverySettings(process.env);
  // Prisma reads engine overrides from this CLI process as well as its children.
  // The invoking shell is unaffected; remove inherited overrides before any client.
  const cleanEnvironment = recoveryEnvironment(process.env);
  for (const name of Object.keys(process.env))
    if (!(name in cleanEnvironment)) delete process.env[name];
  // Generated Prisma code can capture engine settings during module evaluation.
  const { PrismaClient } = await import('@prisma/client');
  const root = await realpath(repository),
    parent = await realpath(settings.outputParent);
  assert(
    outsideRepository(root, parent),
    'Recovery output must resolve outside the repository',
  );
  const pgBin = await realpath(settings.pgBin);
  const output = await mkdtemp(join(parent, 'linji-recovery-'));
  await chmod(output, 0o700);
  assert(outsideRepository(root, await realpath(output)));
  console.info('DATABASE_RECOVERY_OUTPUT=' + output);
  const pg = (name: string) =>
    join(pgBin, name + (process.platform === 'win32' ? '.exe' : ''));
  const sourcePassword = randomBytes(32).toString('hex'),
    targetPassword = randomBytes(32).toString('hex');
  const key = randomBytes(32).toString('hex'),
    adminPassword = randomBytes(24).toString('hex');
  const limitedPassword = randomBytes(32).toString('hex');
  const secrets = [
    sourcePassword,
    targetPassword,
    key,
    adminPassword,
    limitedPassword,
  ];
  const redact = (text: string) =>
    secrets.reduce(
      (value, secret) => value.replaceAll(secret, '[redacted]'),
      text,
    );
  const common: NodeJS.ProcessEnv = {
    ...recoveryEnvironment(process.env),
    INITIAL_ADMIN_ACCOUNT: 'recovery_admin',
    INITIAL_ADMIN_PASSWORD: adminPassword,
    BACKUP_ENCRYPTION_KEY: key,
    KAFKA_CONSUMER_ENABLED: 'false',
    OUTBOX_DISPATCH_ENABLED: 'false',
  };
  const report: Report = {
    completed: false,
    stopped: false,
    scope: 'synthetic-two-cluster-encrypted-logical-restore',
    checks: [],
    clusters: [],
    sourceHashes: {},
    output,
    existingDatabaseUrlUsed: false,
    syntheticDataOnly: true,
    externalKeyRetained: false,
    platform: process.platform,
  };
  let source: PrismaClientType | undefined,
    restored: PrismaClientType | undefined,
    maintenance: PrismaClientType | undefined;
  let snapshotNumber = 0;
  async function command(
    label: string,
    executable: string,
    args: string[],
    env = common,
    expected = 0,
  ): Promise<string> {
    console.info('START ' + label);
    let result: { code: number; text: string };
    try {
      const value = await execute(executable, args, {
        cwd: root,
        env,
        windowsHide: true,
        timeout: 15 * 60_000,
        maxBuffer: 32 * 1024 * 1024,
      });
      result = { code: 0, text: value.stdout + value.stderr };
    } catch (error) {
      const value = error as NodeJS.ErrnoException & {
        code?: string | number;
        stdout?: string;
        stderr?: string;
      };
      result = {
        code: typeof value.code === 'number' ? value.code : -1,
        text: (value.stdout ?? '') + (value.stderr ?? ''),
      };
    }
    await writeFile(join(output, label + '.log'), redact(result.text), {
      mode: 0o600,
    });
    report.checks.push({
      label,
      exitCode: result.code,
      expectedExitCode: expected,
    });
    assert.equal(result.code, expected, label + ' exit');
    console.info('END ' + label + ' ' + result.code);
    return result.text;
  }
  const cli = (
    label: string,
    args: string[],
    env: NodeJS.ProcessEnv,
    expected = 0,
  ) =>
    command(
      label,
      process.execPath,
      [
        '--experimental-strip-types',
        join(root, 'scripts/database-backup.ts'),
        ...args,
        '--pg-bin',
        pgBin,
      ],
      env,
      expected,
    );
  const url = (
    cluster: Cluster,
    password: string,
    database: string,
    user = 'postgres',
  ) =>
    `postgresql://${user}:${password}@127.0.0.1:${cluster.port}/${database}?connection_limit=4`;
  const envFor = (database: string) => ({ ...common, DATABASE_URL: database });
  const nodeScript = (label: string, file: string, env: NodeJS.ProcessEnv) =>
    command(
      label,
      process.execPath,
      [join(root, 'node_modules/tsx/dist/cli.mjs'), file],
      env,
    );
  async function cluster(name: string, password: string): Promise<Cluster> {
    const directory = join(output, name),
      data = join(directory, 'data'),
      passwordFile = join(directory, 'init-password.txt');
    await mkdir(directory, { mode: 0o700 });
    await writeFile(passwordFile, password + '\n', { mode: 0o600, flag: 'wx' });
    const item: Cluster = {
      name,
      data,
      port: await availablePort(),
      initialized: false,
      stopped: false,
    };
    report.clusters.push(item);
    // Pass initdb arguments directly, avoiding pg_ctl's secondary option-string parser.
    await command(name + '-initialize', pg('initdb'), [
      '-D',
      data,
      '--username=postgres',
      '--auth=scram-sha-256',
      '--encoding=UTF8',
      '--locale=C',
      '--pwfile=' + passwordFile,
    ]);
    item.initialized = true;
    await unlink(passwordFile);
    await appendFile(
      join(data, 'postgresql.conf'),
      `\nlisten_addresses='127.0.0.1'\nport=${item.port}\nshared_buffers='64MB'\nmax_connections=30\n`,
    );
    // pg_ctl descendants can retain inherited pipe handles on Windows. Never pipe startup.
    const child = spawn(
      pg('pg_ctl'),
      [
        'start',
        '-D',
        data,
        '-l',
        join(directory, 'postgres.log'),
        '-w',
        '-t',
        '45',
      ],
      { env: common, windowsHide: true, stdio: 'ignore' },
    );
    const code = await new Promise<number | null>((yes, no) => {
      child.once('error', no);
      child.once('exit', yes);
    });
    report.checks.push({
      label: name + '-start',
      exitCode: code ?? -1,
      expectedExitCode: 0,
    });
    assert.equal(code, 0, name + ' startup');
    return item;
  }
  async function stop(item: Cluster): Promise<void> {
    if (!item.initialized || item.stopped) return;
    // Only paths created in this invocation; never stop a system service or caller's cluster.
    assert.equal(
      await realpath(item.data),
      join(await realpath(output), item.name, 'data'),
    );
    if (existsSync(join(item.data, 'postmaster.pid')))
      await command(item.name + '-stop', pg('pg_ctl'), [
        'stop',
        '-D',
        item.data,
        '-m',
        'fast',
        '-w',
        '-t',
        '45',
      ]);
    await command(
      item.name + '-stopped-status',
      pg('pg_ctl'),
      ['status', '-D', item.data],
      common,
      3,
    );
    assert(!existsSync(join(item.data, 'postmaster.pid')));
    item.portClosed = await portClosed(item.port);
    assert(item.portClosed, 'Owned recovery cluster port must be closed');
    item.stopped = true;
  }
  async function snapshot(client: PrismaClientType) {
    const tables = await client.$queryRaw<
      { tablename: string }[]
    >`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`;
    const fingerprints: { table: string; count: string; digest: string }[] = [];
    for (const { tablename } of tables) {
      const [row] = await client.$queryRawUnsafe<
        { count: string; digest: string }[]
      >(
        `SELECT COUNT(*)::text AS count, md5(COALESCE(string_agg(to_jsonb(t)::text, E'\\n' ORDER BY to_jsonb(t)::text),'')) AS digest FROM public.${quote(tablename)} t`,
      );
      assert(row);
      fingerprints.push({ table: tablename, ...row });
    }
    const indexes = await client.$queryRaw<
      { indexname: string; indexdef: string }[]
    >`SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY indexname`;
    const constraints = await client.$queryRaw<
      { table_name: string; conname: string; definition: string }[]
    >`SELECT c.relname AS table_name, con.conname, pg_get_constraintdef(con.oid) AS definition FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname,con.conname`;
    const rawChecks = constraints
      .filter((item) => item.definition.startsWith('CHECK '))
      .map((item) => ({ ...item }));
    for (const item of constraints) {
      if (!item.definition.startsWith('CHECK ')) continue;
      // Reparse both sides: pg_dump deparsing can rewrite equivalent array casts.
      item.definition = await client.$transaction(async (transaction) => {
        const temp = '_recovery_check_' + randomBytes(6).toString('hex');
        await transaction.$executeRawUnsafe(
          `CREATE TEMP TABLE ${quote(temp)} (LIKE public.${quote(item.table_name)}) ON COMMIT DROP`,
        );
        await transaction.$executeRawUnsafe(
          `ALTER TABLE ${quote(temp)} ADD CONSTRAINT canonical_check ${item.definition}`,
        );
        const [row] = await transaction.$queryRaw<
          { definition: string }[]
        >`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid=${temp}::regclass AND conname='canonical_check'`;
        assert(row);
        return row.definition;
      });
    }
    await writeFile(
      join(output, `raw-check-definitions-${++snapshotNumber}.json`),
      JSON.stringify(rawChecks, null, 2),
    );
    const sequences: {
      name: string;
      last_value: string;
      is_called: boolean;
    }[] = [];
    const sequenceNames = await client.$queryRaw<
      { sequencename: string }[]
    >`SELECT sequencename FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename`;
    for (const { sequencename } of sequenceNames) {
      const [row] = await client.$queryRawUnsafe<
        { last_value: string; is_called: boolean }[]
      >(`SELECT last_value::text,is_called FROM public.${quote(sequencename)}`);
      assert(row);
      sequences.push({ name: sequencename, ...row });
    }
    const extensions = await client.$queryRaw<
      { extname: string; extversion: string }[]
    >`SELECT extname,extversion FROM pg_extension ORDER BY extname`;
    return { fingerprints, indexes, constraints, sequences, extensions };
  }
  async function databaseExists(name: string): Promise<boolean> {
    assert(maintenance);
    return (
      (
        await maintenance.$queryRaw<
          unknown[]
        >`SELECT 1 FROM pg_database WHERE datname=${name}`
      ).length === 1
    );
  }
  const restoreArgs = (directory: string, digest: string, target: string) => [
    'restore-new',
    '--directory',
    directory,
    '--manifest-sha256',
    digest,
    '--confirm-target',
    target,
  ];
  try {
    for (const file of [
      'scripts/validate-database-recovery.ts',
      'scripts/database-backup.ts',
      'package.json',
      'pnpm-lock.yaml',
    ])
      report.sourceHashes[file] = createHash('sha256')
        .update(await readFile(join(root, file)))
        .digest('hex');
    const tools = await command('tool-version', pg('pg_ctl'), ['--version']);
    assert.match(tools, /^pg_ctl \(PostgreSQL\) 17\./u);
    report.postgresTools = tools.trim();
    const c1 = await cluster('source', sourcePassword),
      sourceURL = url(c1, sourcePassword, 'linji_backup_source');
    await command(
      'create-source',
      pg('createdb'),
      ['--no-password', '--maintenance-db=postgres', 'linji_backup_source'],
      postgresEnvironment(
        databaseConnection(url(c1, sourcePassword, 'postgres')),
        common,
      ),
    );
    const sourceEnv = envFor(sourceURL),
      prismaCli = join(root, 'node_modules/prisma/build/index.js');
    await command(
      'migrate-source',
      process.execPath,
      [prismaCli, 'migrate', 'deploy'],
      sourceEnv,
    );
    await nodeScript('seed-first', 'prisma/seed.ts', sourceEnv);
    await nodeScript('seed-second', 'prisma/seed.ts', sourceEnv);
    await nodeScript('verify-source', 'scripts/verify-database.ts', sourceEnv);
    source = new PrismaClient({ datasourceUrl: sourceURL });
    const admin = await source.user.findUniqueOrThrow({
      where: { Account: 'recovery_admin' },
    });
    const project = await source.projectKnowledge.create({
      data: {
        Title: '合成备份资料',
        Content: 'synthetic-backup-sentinel-20261104：滑雪资料恢复演练。',
        Category: '合成',
        Status: 'published',
        PublishTime: new Date(),
      },
    });
    const resort = await source.skiResort.create({
      data: {
        Name: '合成恢复雪场',
        LegacyDistance: 1,
        Price: 180,
        SnowCondition: '合成',
        Description: '仅恢复演练',
        Status: 'published',
        CustomFields: { marker: '恢复动态字段', levels: [1, 2] },
      },
    });
    await source.resortRevenueRecord.create({
      data: {
        ResortId: resort.ResortId,
        ReportDate: new Date('2026-11-04'),
        RevenueAmount: '12345678.91',
        Source: 'manual',
        CreatedBy: admin.UserId,
      },
    });
    const doc = await source.ragDocument.create({
      data: {
        SourceKey: `project:${project.ProjectKnowledgeId}`,
        SourceType: 'project_doc',
        SourceId: project.ProjectKnowledgeId,
        Title: project.Title,
        Content: project.Content,
        AccessScope: 'public',
        Status: 'indexed',
        ContentHash: 'a'.repeat(64),
        SourceUpdatedAt: project.UpdateTime,
        Metadata: { synthetic: true },
      },
    });
    const vector = '[' + [1, ...Array<number>(1023).fill(0)].join(',') + ']';
    await source.$executeRaw`INSERT INTO "RagChunk" ("RagDocumentId","ChunkIndex","ChunkContent","Embedding","EmbeddingModel") VALUES (${doc.RagDocumentId},0,${project.Content},${vector}::vector,'synthetic-backup-vector')`;
    const conversation = await source.aiConversation.create({
      data: { UserId: admin.UserId, Title: '合成恢复对话' },
    });
    const question = await source.aiMessage.create({
      data: {
        ConversationId: conversation.ConversationId,
        SenderRole: 'user',
        Content: '合成问题',
        ClientRequestId: randomUUID(),
      },
    });
    await source.aiMessage.create({
      data: {
        ConversationId: conversation.ConversationId,
        SenderRole: 'assistant',
        Content: '合成回答[S1]',
        GenerationStatus: 'completed',
        ParentMessageId: question.MessageId,
        Citations: [
          {
            sourceType: 'project',
            sourceId: String(project.ProjectKnowledgeId),
          },
        ],
      },
    });
    const eventId = randomUUID();
    await source.outboxEvent.create({
      data: {
        EventId: eventId,
        EventType: 'project_doc.changed.v1',
        AggregateType: 'project_doc',
        AggregateId: String(project.ProjectKnowledgeId),
        Payload: { projectKnowledgeId: project.ProjectKnowledgeId },
        Status: 'published',
        PublishedAt: new Date(),
      },
    });
    await source.consumedEvent.create({
      data: {
        ConsumerKey: 'rag-project-knowledge-indexer.v1',
        EventId: eventId,
        EventType: 'project_doc.changed.v1',
        Status: 'completed',
        ProcessedAt: new Date(),
      },
    });
    const before = await snapshot(source);
    await writeFile(
      join(output, 'source-fingerprint.json'),
      JSON.stringify(before, null, 2),
    );
    const backupDir = join(output, 'encrypted-backup');
    const backupOutput = await cli(
      'encrypted-backup',
      ['backup', '--directory', backupDir],
      sourceEnv,
    );
    const line = backupOutput
      .split(/\r?\n/u)
      .find((item) => item.startsWith('{"action":'));
    assert(line);
    const backup = JSON.parse(line) as {
      manifestSha256: string;
      archiveSha256: string;
      bytes: number;
    };
    assert.match(backup.manifestSha256, /^[a-f0-9]{64}$/u);
    report.backup = backup;
    const bytes = await readFile(join(backupDir, 'database.dump.aes256gcm'));
    assert(
      !bytes.includes(Buffer.from('synthetic-backup-sentinel-20261104')) &&
        !bytes.subarray(0, 5).equals(Buffer.from('PGDMP')),
    );
    await cli(
      'reject-existing-backup-directory',
      ['backup', '--directory', backupDir],
      sourceEnv,
      1,
    );
    assert.deepEqual(await snapshot(source), before);
    await source.$disconnect();
    source = undefined;
    await stop(c1);
    report.sourceStoppedBeforeRestore = true;
    const c2 = await cluster('restore', targetPassword),
      target = 'linji_backup_restored';
    const targetURL = url(c2, targetPassword, target),
      targetEnv = envFor(targetURL),
      digest = backup.manifestSha256;
    maintenance = new PrismaClient({
      datasourceUrl: url(c2, targetPassword, 'postgres'),
    });
    await cli(
      'reject-untrusted-manifest',
      restoreArgs(backupDir, '0'.repeat(64), 'linji_bad_manifest'),
      envFor(url(c2, targetPassword, 'linji_bad_manifest')),
      1,
    );
    assert(!(await databaseExists('linji_bad_manifest')));
    await cli(
      'reject-wrong-key',
      restoreArgs(backupDir, digest, 'linji_bad_key'),
      {
        ...envFor(url(c2, targetPassword, 'linji_bad_key')),
        BACKUP_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
      },
      1,
    );
    assert(!(await databaseExists('linji_bad_key')));
    const tamperDir = join(output, 'tampered-backup');
    await cp(backupDir, tamperDir, { recursive: true });
    const altered = Buffer.from(bytes);
    altered[10] ^= 1;
    await writeFile(join(tamperDir, 'database.dump.aes256gcm'), altered);
    await cli(
      'reject-tampered-archive',
      restoreArgs(tamperDir, digest, 'linji_bad_archive'),
      envFor(url(c2, targetPassword, 'linji_bad_archive')),
      1,
    );
    assert(!(await databaseExists('linji_bad_archive')));
    await cli(
      'restore-new-cluster',
      restoreArgs(backupDir, digest, target),
      targetEnv,
    );
    await nodeScript(
      'verify-restored',
      'scripts/verify-database.ts',
      targetEnv,
    );
    await command(
      'restored-no-pending-migrations',
      process.execPath,
      [prismaCli, 'migrate', 'deploy'],
      targetEnv,
    );
    restored = new PrismaClient({ datasourceUrl: targetURL });
    const after = await snapshot(restored);
    assert.deepEqual(after, before);
    await writeFile(
      join(output, 'restored-fingerprint.json'),
      JSON.stringify(after, null, 2),
    );
    report.dataComparison = {
      tables: before.fingerprints.length,
      indexes: before.indexes.length,
      constraints: before.constraints.length,
      sequences: before.sequences.length,
      allRowFingerprintsEqual: true,
      allDefinitionsEqual: true,
      checksComparedAfterDatabaseReparse: true,
      allSequencesEqual: true,
    };
    const [v] = await restored.$queryRaw<
      { dimensions: number; cosine_distance: number }[]
    >`SELECT vector_dims("Embedding") AS dimensions, ("Embedding" <=> ${vector}::vector) AS cosine_distance FROM "RagChunk"`;
    assert(v);
    assert.equal(v.dimensions, 1024);
    assert.equal(v.cosine_distance, 0);
    report.vector = v;
    assert.equal(
      (
        await restored.resortRevenueRecord.findFirstOrThrow()
      ).RevenueAmount.toFixed(2),
      '12345678.91',
    );
    assert.equal(await restored.aiMessage.count(), 2);
    assert.equal(await restored.outboxEvent.count(), 1);
    assert.equal(await restored.consumedEvent.count(), 1);
    await cli(
      'reject-existing-restore-target',
      restoreArgs(backupDir, digest, target),
      targetEnv,
      1,
    );
    assert.deepEqual(await snapshot(restored), before);
    const next = await restored.projectKnowledge.create({
      data: { Title: '恢复后序列验证', Content: '合成', Category: '合成' },
    });
    assert.equal(next.ProjectKnowledgeId, project.ProjectKnowledgeId + 1);
    report.sequenceContinued = true;
    await assert.rejects(
      restored.userRole.create({
        data: { UserId: admin.UserId, RoleId: 2147483647 },
      }),
      (error: unknown) =>
        error instanceof Error && 'code' in error && error.code === 'P2003',
    );
    report.foreignKeyEnforced = true;
    // The only SQL literal here is a generated hexadecimal disposable password.
    await maintenance.$executeRawUnsafe(
      `CREATE ROLE backup_limited LOGIN CREATEDB PASSWORD '${limitedPassword}'`,
    );
    const limitedTarget = 'linji_restore_atomic_failure';
    await cli(
      'restore-atomic-failure',
      restoreArgs(backupDir, digest, limitedTarget),
      envFor(url(c2, limitedPassword, limitedTarget, 'backup_limited')),
      1,
    );
    assert(await databaseExists(limitedTarget));
    const empty = new PrismaClient({
      datasourceUrl: url(c2, targetPassword, limitedTarget),
    });
    try {
      assert.equal(
        (
          await empty.$queryRaw<
            { count: string }[]
          >`SELECT count(*)::text AS count FROM pg_tables WHERE schemaname='public'`
        )[0]?.count,
        '0',
      );
    } finally {
      await empty.$disconnect();
    }
    report.failedRestoreRetainedEmptyTarget = true;
    report.encryptedBytes = (
      await stat(join(backupDir, 'database.dump.aes256gcm'))
    ).size;
    report.plaintextDumpOnDisk = false;
    report.migrations = before.fingerprints.find(
      (item) => item.table === '_prisma_migrations',
    )?.count;
    report.extensions = before.extensions;
    report.completed = true;
  } catch (error) {
    report.error = redact(
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  } finally {
    const cleanupErrors: string[] = [];
    for (const client of [source, restored, maintenance]) {
      try {
        await client?.$disconnect();
      } catch {
        cleanupErrors.push('Prisma disconnect failed');
      }
    }
    for (const item of report.clusters) {
      try {
        await stop(item);
      } catch {
        cleanupErrors.push(item.name + ' stop/status verification failed');
      }
      try {
        await unlink(join(dirname(item.data), 'init-password.txt'));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          cleanupErrors.push(item.name + ' password-file cleanup failed');
      }
      if (existsSync(join(dirname(item.data), 'init-password.txt')))
        cleanupErrors.push(item.name + ' password file remains');
    }
    report.stopped =
      report.clusters.length === 2 &&
      report.clusters.every((item) => item.stopped && item.portClosed);
    if (cleanupErrors.length || !report.stopped) {
      report.completed = false;
      report.cleanupErrors = cleanupErrors;
      process.exitCode = 1;
    }
    await writeFile(
      join(output, 'report.json'),
      JSON.stringify(report, null, 2),
      { mode: 0o600 },
    );
    console.info(JSON.stringify(report, null, 2));
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch(() => {
    console.error(
      'Database recovery validation failed. Check explicit opt-in, native PostgreSQL 17 paths and the redacted report if created.',
    );
    process.exitCode = 1;
  });
}
