import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(
  realpathSync.native(fileURLToPath(new URL('../', import.meta.url))),
);
const manifestName = '.source-export.json';
const omittedDirectories = new Set([
  '.git',
  'node_modules',
  '.pnpm-store',
  '.next',
  '.turbo',
  '.expo',
  'coverage',
  'storage',
  'test-results',
  'playwright-report',
  '.claude',
  '.codex',
  '.agents',
]);
const fixtureKeys = new Set([
  'test/fixtures/kafka-tls/broker-cert.pem',
  'test/fixtures/kafka-tls/broker-key.pem',
  'test/fixtures/kafka-tls/ca.pem',
]);
const mandatory = [
  'package.json',
  'pnpm-lock.yaml',
  'README.md',
  'contracts/openapi.json',
];

function hash(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

function within(parent: string, target: string) {
  const relative = path.relative(parent, target);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== '..' &&
      !path.isAbsolute(relative))
  );
}

function sourceFiles() {
  const gitRoot = realpathSync.native(
    execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: root,
      encoding: 'utf8',
    }).trim(),
  );
  if (path.relative(root, gitRoot) !== '')
    throw new Error('Run from a standalone repository, not a parent checkout');
  const paths = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    },
  )
    .split('\0')
    .filter(Boolean);
  const selected: string[] = [];
  for (const name of new Set(paths)) {
    const parts = name.split('/');
    if (
      path.isAbsolute(name) ||
      /[\\:]/.test(name) ||
      name.split('').some((character) => character.charCodeAt(0) < 32) ||
      parts.some((part) => part === '..' || part === '.' || !part)
    ) {
      throw new Error('Unsafe source filename');
    }
    if (
      name === manifestName ||
      /\.(?:log|tsbuildinfo|apk|aab|ipa)$/.test(name) ||
      parts
        .slice(0, -1)
        .some(
          (part) => omittedDirectories.has(part) || /^dist(?:-|$)/.test(part),
        ) ||
      /^(?:ios|android|web-build)\//.test(name)
    )
      continue;
    const basename = parts[parts.length - 1]!;
    if (
      (basename.startsWith('.env') || basename.includes('.env.')) &&
      !basename.endsWith('.env.example')
    ) {
      throw new Error('Environment credentials are not source inputs');
    }
    if (
      /\.(?:pem|key|p12|pfx|jks|mobileprovision)$/i.test(name) &&
      !fixtureKeys.has(name)
    ) {
      throw new Error('Private credentials are not source inputs');
    }
    const source = path.join(root, name);
    if (!existsSync(source)) {
      // A tracked deletion belongs to the current working tree, not the export.
      // Broken symlinks still require rejection.
      try {
        if (lstatSync(source).isSymbolicLink())
          throw new Error('Source links are not supported');
      } catch (error) {
        if (!(
          error instanceof Error &&
          'code' in error &&
          error.code === 'ENOENT'
        ))
          throw error;
      }
      continue;
    }
    for (let index = 1; index <= parts.length; index++) {
      if (
        lstatSync(path.join(root, ...parts.slice(0, index))).isSymbolicLink()
      ) {
        throw new Error('Source links are not supported');
      }
    }
    if (!lstatSync(source).isFile())
      throw new Error('Source input must be a regular file');
    selected.push(name);
  }
  selected.sort();
  for (const file of mandatory) {
    if (!selected.includes(file))
      throw new Error(`Missing mandatory source input: ${file}`);
  }
  return selected;
}

function run() {
  const requested = process.argv[2];
  if (process.argv.length !== 3 || !requested || !path.isAbsolute(requested)) {
    throw new Error(
      'Usage: pnpm source:export <new absolute directory; parent must exist>',
    );
  }
  const absolute = path.resolve(requested);
  const destination = path.join(
    realpathSync.native(path.dirname(absolute)),
    path.basename(absolute),
  );
  if (within(root, destination) || within(destination, root))
    throw new Error('Source and destination must be disjoint');
  if (existsSync(destination))
    throw new Error('Destination already exists; it will not be overwritten');
  const files = sourceFiles();
  const pkg = JSON.parse(
    readFileSync(path.join(root, 'package.json'), 'utf8'),
  ) as { name: string; packageManager: string };
  const contract = readFileSync(path.join(root, 'contracts/openapi.json'));
  const api = JSON.parse(contract.toString('utf8')) as {
    info: { version: string };
  };
  mkdirSync(destination);
  const entries = files.map((file) => {
    const source = path.join(root, file);
    const target = path.join(destination, file);
    const before = readFileSync(source);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(source, target);
    if (hash(readFileSync(target)) !== hash(before))
      throw new Error('Source changed during export');
    return { path: file, bytes: before.length, sha256: hash(before) };
  });
  if (
    JSON.stringify(sourceFiles()) !== JSON.stringify(files) ||
    entries.some(
      (entry) =>
        hash(readFileSync(path.join(root, entry.path))) !== entry.sha256,
    )
  ) {
    throw new Error(
      'Source changed during export; retain this directory for diagnosis and use a new destination',
    );
  }
  const sourceSha256 = hash(
    Buffer.from(
      entries
        .map((entry) => `${entry.sha256}\t${entry.bytes}\t${entry.path}\n`)
        .join(''),
    ),
  );
  const manifest = {
    formatVersion: 1,
    createdAt: new Date().toISOString(),
    packageName: pkg.name,
    packageManager: pkg.packageManager,
    sourceSha256,
    openapi: { version: api.info.version, sha256: hash(contract) },
    files: entries,
  };
  writeFileSync(
    path.join(destination, manifestName),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { flag: 'wx' },
  );
  console.log(
    JSON.stringify({
      destination,
      files: entries.length,
      sourceSha256,
      openapi: manifest.openapi,
    }),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function safeSourcePath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !path.isAbsolute(value) &&
    !/[\\:]/.test(value) &&
    !value.split('').some((character) => character.charCodeAt(0) < 32) &&
    value
      .split('/')
      .every((part) => part !== '.' && part !== '..' && part.length > 0)
  );
}
function verifySourceExport() {
  const [, , , requested, expected] = process.argv;
  if (process.argv.length !== 5 || !requested || !path.isAbsolute(requested))
    throw new Error(
      'Usage: pnpm source:verify <pristine absolute export directory> <externally pinned SHA-256>',
    );
  if (!expected || !/^[a-f0-9]{64}$/.test(expected))
    throw new Error('Expected source SHA-256 is required');
  const directory = realpathSync.native(requested);
  const manifestPath = path.join(directory, manifestName);
  const manifestStat = lstatSync(manifestPath);
  if (
    manifestStat.isSymbolicLink() ||
    !manifestStat.isFile() ||
    manifestStat.size > 32 * 1024 * 1024
  )
    throw new Error('Invalid source manifest file');
  const manifest: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (
    !isRecord(manifest) ||
    manifest.formatVersion !== 1 ||
    typeof manifest.packageName !== 'string' ||
    typeof manifest.packageManager !== 'string' ||
    !isRecord(manifest.openapi) ||
    typeof manifest.openapi.version !== 'string' ||
    typeof manifest.openapi.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(manifest.openapi.sha256) ||
    !Array.isArray(manifest.files) ||
    manifest.files.length === 0
  )
    throw new Error('Invalid source manifest structure');
  const entries: Array<{ path: string; bytes: number; sha256: string }> = [];
  let previous: string | undefined;
  for (const entry of manifest.files) {
    if (
      !isRecord(entry) ||
      !safeSourcePath(entry.path) ||
      entry.path === manifestName
    )
      throw new Error('Unsafe source manifest path');
    if (previous !== undefined && entry.path <= previous)
      throw new Error('Source manifest entries must be unique and sorted');
    if (
      typeof entry.bytes !== 'number' ||
      !Number.isSafeInteger(entry.bytes) ||
      entry.bytes < 0 ||
      typeof entry.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(entry.sha256)
    )
      throw new Error('Invalid source manifest file metadata');
    entries.push({
      path: entry.path,
      bytes: entry.bytes,
      sha256: entry.sha256,
    });
    previous = entry.path;
  }
  for (const file of mandatory)
    if (!entries.some((entry) => entry.path === file))
      throw new Error('Missing mandatory source manifest entry');
  const digest = hash(
    Buffer.from(
      entries
        .map(
          (entry) =>
            entry.sha256 + '\t' + entry.bytes + '\t' + entry.path + '\n',
        )
        .join(''),
    ),
  );
  if (manifest.sourceSha256 !== digest || digest !== expected)
    throw new Error('Source digest does not match externally pinned digest');
  const actual: string[] = [];
  function walk(relative: string) {
    const current = path.join(directory, relative);
    for (const name of readdirSync(current)) {
      const child = relative ? relative + '/' + name : name;
      const stat = lstatSync(path.join(directory, child));
      if (stat.isSymbolicLink())
        throw new Error('Source links are not supported');
      if (stat.isDirectory()) walk(child);
      else if (stat.isFile()) actual.push(child);
      else throw new Error('Source entries must be regular files');
    }
  }
  walk('');
  actual.sort();
  if (
    JSON.stringify(actual) !==
    JSON.stringify([...entries.map((entry) => entry.path), manifestName].sort())
  )
    throw new Error(
      'Source file set does not match manifest; verify before installing dependencies or configuring secrets',
    );
  for (const entry of entries) {
    const bytes = readFileSync(path.join(directory, entry.path));
    if (bytes.length !== entry.bytes || hash(bytes) !== entry.sha256)
      throw new Error('Source file does not match manifest');
  }
  const pkg: unknown = JSON.parse(
    readFileSync(path.join(directory, 'package.json'), 'utf8'),
  );
  const apiBytes = readFileSync(path.join(directory, 'contracts/openapi.json'));
  const api: unknown = JSON.parse(apiBytes.toString('utf8'));
  if (
    !isRecord(pkg) ||
    pkg.name !== manifest.packageName ||
    pkg.packageManager !== manifest.packageManager ||
    !isRecord(api) ||
    !isRecord(api.info) ||
    api.info.version !== manifest.openapi.version ||
    hash(apiBytes) !== manifest.openapi.sha256
  )
    throw new Error('Source package/OpenAPI metadata does not match manifest');
  console.log(
    JSON.stringify({
      verified: true,
      files: entries.length,
      sourceSha256: digest,
      openapi: manifest.openapi,
    }),
  );
}

try {
  if (process.argv[2] === '--verify') verifySourceExport();
  else run();
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'Source export failed',
  );
  process.exitCode = 1;
}
