import { spawn } from 'node:child_process';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const format = 'linji-postgresql-encrypted-backup-v1';
const archiveName = 'database.dump.aes256gcm';
const aad = Buffer.from(format);
interface Connection {
  host: string;
  port: string;
  database: string;
  username: string;
  password: string;
  ssl: Record<string, string>;
}
interface Manifest {
  format: typeof format;
  createdAt: string;
  source: { host: string; port: string; database: string };
  archive: { file: typeof archiveName; bytes: number; sha256: string };
  encryption: { algorithm: 'aes-256-gcm'; iv: string; tag: string };
  pgDumpVersion: string;
}
export function databaseConnection(value: string): Connection {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Valid DATABASE_URL required');
  }
  const database = decodeURIComponent(url.pathname.slice(1));
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !url.hostname ||
    !/^[a-zA-Z][a-zA-Z0-9_]{0,62}$/u.test(database) ||
    !url.username ||
    !url.password ||
    url.hash
  )
    throw new Error(
      'Explicit PostgreSQL host, safe database name and credentials required',
    );
  const ssl: Record<string, string> = {};
  const mapping: Record<string, string> = {
    sslmode: 'PGSSLMODE',
    sslrootcert: 'PGSSLROOTCERT',
    sslcert: 'PGSSLCERT',
    sslkey: 'PGSSLKEY',
  };
  const ignored = new Set([
    'schema',
    'connection_limit',
    'pool_timeout',
    'connect_timeout',
  ]);
  for (const [key, item] of url.searchParams) {
    if (ignored.has(key)) {
      if (key === 'schema' && item !== 'public')
        throw new Error('Only public application schema is supported');
      continue;
    }
    if (!mapping[key] || !item || url.searchParams.getAll(key).length !== 1)
      throw new Error('Unsupported or duplicate database connection option');
    if (
      key === 'sslmode' &&
      ![
        'disable',
        'allow',
        'prefer',
        'require',
        'verify-ca',
        'verify-full',
      ].includes(item)
    )
      throw new Error('Invalid sslmode');
    ssl[mapping[key]!] = item;
  }
  return {
    host: url.hostname.replace(/^\[|\]$/gu, ''),
    port: url.port || '5432',
    database,
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ssl,
  };
}
export function postgresEnvironment(
  connection: Connection,
  original: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const env = { ...original };
  for (const key of Object.keys(env))
    if (
      /^PG/iu.test(key) ||
      key === 'DATABASE_URL' ||
      key === 'BACKUP_ENCRYPTION_KEY'
    )
      delete env[key];
  return {
    ...env,
    PGHOST: connection.host,
    PGPORT: connection.port,
    PGDATABASE: connection.database,
    PGUSER: connection.username,
    PGPASSWORD: connection.password,
    PGCONNECT_TIMEOUT: '15',
    PGAPPNAME: 'linji-backup',
    ...connection.ssl,
  };
}
export function validateManifest(value: unknown): Manifest {
  const m = value as Manifest | null;
  if (
    !m ||
    m.format !== format ||
    !m.source ||
    typeof m.source.host !== 'string' ||
    !m.source.host ||
    !/^[1-9]\d{0,4}$/u.test(m.source.port) ||
    Number(m.source.port) > 65535 ||
    !/^[a-zA-Z][a-zA-Z0-9_]{0,62}$/u.test(m.source.database) ||
    !m.archive ||
    m.archive.file !== archiveName ||
    !Number.isSafeInteger(m.archive.bytes) ||
    m.archive.bytes < 1 ||
    !/^[a-f0-9]{64}$/u.test(m.archive.sha256) ||
    !m.encryption ||
    m.encryption.algorithm !== 'aes-256-gcm' ||
    !/^[a-f0-9]{24}$/u.test(m.encryption.iv) ||
    !/^[a-f0-9]{32}$/u.test(m.encryption.tag) ||
    typeof m.pgDumpVersion !== 'string' ||
    !m.pgDumpVersion.startsWith('pg_dump (PostgreSQL) 17.') ||
    typeof m.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(m.createdAt))
  )
    throw new Error('Invalid backup manifest');
  return m;
}
export function restoreArguments(database: string): string[] {
  return [
    '--no-password',
    '--exit-on-error',
    '--single-transaction',
    '--no-owner',
    '--no-acl',
    '--dbname',
    database,
  ];
}
async function digest(file: string) {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk);
    bytes += (chunk as Buffer).length;
  }
  return { sha256: hash.digest('hex'), bytes };
}
function encryptionKey() {
  const value = process.env.BACKUP_ENCRYPTION_KEY ?? '';
  if (!/^[a-fA-F0-9]{64}$/u.test(value))
    throw new Error(
      'BACKUP_ENCRYPTION_KEY must be an independently stored 32-byte hexadecimal secret',
    );
  return Buffer.from(value, 'hex');
}
function launch(binary: string, args: string[], env: NodeJS.ProcessEnv) {
  const child = spawn(binary, args, {
    env,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 30 * 60_000,
  });
  // Native diagnostics may echo credentials or database content. Expose only status.
  child.stderr.resume();
  const done = new Promise<void>((yes, no) => {
    child.once('error', () => no(new Error('PostgreSQL tool could not start')));
    child.once('close', (code) =>
      code === 0
        ? yes()
        : no(
            new Error(
              'PostgreSQL tool failed; no target database is overwritten or removed',
            ),
          ),
    );
  });
  void done.catch(() => undefined);
  return { child, done };
}
async function textCommand(
  binary: string,
  args: string[],
  env: NodeJS.ProcessEnv,
) {
  const { child, done } = launch(binary, args, env);
  child.stdin.end();
  let output = '';
  for await (const part of child.stdout) {
    output += String(part);
    if (output.length > 8192) {
      child.kill();
      throw new Error('Unexpected PostgreSQL tool output');
    }
  }
  await done;
  return output.trim();
}
function outside(parent: string, target: string) {
  const path = relative(parent, target);
  return path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path);
}
async function externalDirectory(value: string, create: boolean) {
  if (!isAbsolute(value))
    throw new Error('Absolute directory outside this repository required');
  const root = await realpath(fileURLToPath(new URL('../', import.meta.url)));
  const path = resolve(value);
  if (!outside(root, path))
    throw new Error('Backup directory must be outside the repository');
  const parent = await realpath(resolve(path, '..'));
  if (!outside(root, join(parent, basename(path))))
    throw new Error('Backup parent resolves inside the repository');
  if (create) await mkdir(path, { mode: 0o700 }); // EEXIST prevents overwriting an existing package.
  const actual = await realpath(path);
  if (!outside(root, actual))
    throw new Error('Backup directory resolves inside the repository');
  return actual;
}
async function ordinaryFile(file: string) {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error('Regular backup file required');
  return stat;
}
function decipher(manifest: Manifest, key: Buffer) {
  const cipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(manifest.encryption.iv, 'hex'),
  );
  cipher.setAAD(aad);
  cipher.setAuthTag(Buffer.from(manifest.encryption.tag, 'hex'));
  return cipher;
}
export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') {
    console.log(
      'backup --directory <new absolute path> --pg-bin <PostgreSQL 17 bin>\nrestore-new --directory <backup path> --pg-bin <PostgreSQL 17 bin> --manifest-sha256 <external trusted digest> --confirm-target <new database name>\nUses DATABASE_URL and BACKUP_ENCRYPTION_KEY. Restore creates a NEW database via postgres maintenance database; never overwrites, drops, cleans or retries an existing target.',
    );
    return;
  }
  const [command, ...rest] = args,
    options = new Map<string, string>();
  if (!['backup', 'restore-new'].includes(command ?? '') || rest.length % 2)
    throw new Error('Use --help for exact backup/restore-new syntax');
  for (let i = 0; i < rest.length; i += 2) {
    const name = rest[i]!,
      value = rest[i + 1]!;
    if (
      ![
        '--directory',
        '--pg-bin',
        '--manifest-sha256',
        '--confirm-target',
      ].includes(name) ||
      options.has(name) ||
      !value ||
      value.startsWith('--')
    )
      throw new Error('Invalid or duplicate command option');
    options.set(name, value);
  }
  if (
    !options.has('--directory') ||
    !options.has('--pg-bin') ||
    !isAbsolute(options.get('--pg-bin')!)
  )
    throw new Error('Absolute directory and pg-bin required');
  if (command === 'backup' && options.size !== 2)
    throw new Error('Unexpected backup option');
  const connection = databaseConnection(process.env.DATABASE_URL ?? ''),
    env = postgresEnvironment(connection, process.env),
    key = encryptionKey();
  const pg = (name: string) =>
    join(
      options.get('--pg-bin')!,
      name + (process.platform === 'win32' ? '.exe' : ''),
    );
  const version = await textCommand(pg('pg_dump'), ['--version'], env);
  if (!version.startsWith('pg_dump (PostgreSQL) 17.'))
    throw new Error('PostgreSQL 17 tools required');
  if (command === 'backup') {
    const directory = await externalDirectory(
        options.get('--directory')!,
        true,
      ),
      file = join(directory, archiveName);
    const iv = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(aad);
    const { child, done } = launch(
      pg('pg_dump'),
      [
        '--no-password',
        '--format=custom',
        '--no-owner',
        '--no-acl',
        '--serializable-deferrable',
      ],
      env,
    );
    child.stdin.end();
    try {
      await Promise.all([
        done,
        pipeline(
          child.stdout,
          cipher,
          createWriteStream(file, { flags: 'wx', mode: 0o600 }),
        ),
      ]);
    } catch {
      child.kill();
      await done.catch(() => undefined);
      throw new Error(
        'Encrypted backup failed; incomplete directory retained without a valid manifest',
      );
    }
    const manifest: Manifest = {
      format,
      createdAt: new Date().toISOString(),
      source: {
        host: connection.host,
        port: connection.port,
        database: connection.database,
      },
      archive: { file: archiveName, ...(await digest(file)) },
      encryption: {
        algorithm: 'aes-256-gcm',
        iv: iv.toString('hex'),
        tag: cipher.getAuthTag().toString('hex'),
      },
      pgDumpVersion: version,
    };
    const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
    await writeFile(join(directory, 'manifest.json'), bytes, {
      flag: 'wx',
      mode: 0o600,
    });
    console.log(
      JSON.stringify({
        action: 'backup',
        encrypted: true,
        manifestSha256: createHash('sha256').update(bytes).digest('hex'),
        archiveSha256: manifest.archive.sha256,
        bytes: manifest.archive.bytes,
      }),
    );
    return;
  }
  if (
    options.size !== 4 ||
    options.get('--confirm-target') !== connection.database ||
    !/^[a-f0-9]{64}$/u.test(options.get('--manifest-sha256') ?? '') ||
    ['postgres', 'template0', 'template1'].includes(connection.database)
  )
    throw new Error(
      'Explicit new target confirmation and externally trusted manifest digest required',
    );
  const directory = await externalDirectory(options.get('--directory')!, false),
    manifestFile = join(directory, 'manifest.json');
  if ((await ordinaryFile(manifestFile)).size > 65536)
    throw new Error('Manifest size exceeds limit');
  const bytes = await readFile(manifestFile);
  if (
    createHash('sha256').update(bytes).digest('hex') !==
    options.get('--manifest-sha256')
  )
    throw new Error('Trusted manifest digest mismatch');
  const manifest = validateManifest(JSON.parse(bytes.toString('utf8')));
  if (
    manifest.source.database === connection.database &&
    manifest.source.host === connection.host &&
    manifest.source.port === connection.port
  )
    throw new Error('Restore source and target must differ');
  const file = join(directory, archiveName);
  await ordinaryFile(file);
  const archive = await digest(file);
  if (
    archive.bytes !== manifest.archive.bytes ||
    archive.sha256 !== manifest.archive.sha256
  )
    throw new Error('Encrypted archive digest mismatch');
  // Authenticate the entire archive BEFORE createdb or pg_restore can modify a target.
  try {
    await pipeline(
      createReadStream(file),
      decipher(manifest, key),
      new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
      }),
    );
  } catch {
    throw new Error('Backup authentication failed; target was not created');
  }
  await textCommand(
    pg('createdb'),
    [
      '--no-password',
      '--maintenance-db=postgres',
      '--template=template0',
      connection.database,
    ],
    env,
  );
  const { child, done } = launch(
    pg('pg_restore'),
    restoreArguments(connection.database),
    env,
  );
  child.stdout.resume();
  try {
    await Promise.all([
      done,
      pipeline(createReadStream(file), decipher(manifest, key), child.stdin),
    ]);
  } catch {
    child.kill();
    await done.catch(() => undefined);
    throw new Error(
      'Restore failed; new target retained for inspection, never automatically dropped or retried',
    );
  }
  console.log(
    JSON.stringify({
      action: 'restore-new',
      restored: true,
      manifestSha256: options.get('--manifest-sha256'),
      target: connection.database,
      applicationVerificationRequired: true,
      workersMustRemainStopped: true,
    }),
  );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch(() => {
    console.error(
      'Database backup/restore failed. Check configuration, trusted digest, secret and new-target status; credentials and native diagnostics are suppressed.',
    );
    process.exitCode = 1;
  });
}
