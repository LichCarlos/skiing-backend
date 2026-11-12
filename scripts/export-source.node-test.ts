import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';

const script = readFileSync(new URL('./export-source.ts', import.meta.url));
const fixtures: string[] = [];
const tempParent = realpathSync(tmpdir());
function put(root: string, name: string, value: string | Uint8Array) {
  const file = path.join(root, name);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, value);
}
function fixture() {
  const root = mkdtempSync(path.join(tempParent, 'linji-source-export-'));
  fixtures.push(root);
  const source = path.join(root, 'source');
  mkdirSync(source);
  execFileSync('git', ['init', '--quiet'], { cwd: source });
  put(source, 'scripts/export-source.ts', script);
  put(
    source,
    'package.json',
    JSON.stringify({
      name: 'fixture',
      type: 'module',
      packageManager: 'pnpm@11.25.0',
    }),
  );
  put(source, 'pnpm-lock.yaml', 'lockfileVersion: 9\n');
  put(source, 'README.md', '# 独立项目\n');
  put(
    source,
    'contracts/openapi.json',
    JSON.stringify({ info: { version: '1.50.2' }, paths: {} }),
  );
  put(source, '.gitignore', '.env\nnode_modules/\n');
  const destination = path.join(root, 'export');
  return { root, source, destination };
}
function execute(source: string, destination: string) {
  return spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      path.join(source, 'scripts/export-source.ts'),
      destination,
    ],
    { cwd: source, encoding: 'utf8' },
  );
}
function rejected(source: string, destination: string, reason: string) {
  const result = execute(source, destination);
  assert.equal(result.status, 1, result.stderr);
  assert.ok(result.stderr.includes(reason), result.stderr);
}
afterEach(() => {
  for (const root of fixtures.splice(0)) {
    const absolute = realpathSync(root);
    if (
      path.dirname(absolute) !== tempParent ||
      !path.basename(absolute).startsWith('linji-source-export-')
    ) {
      throw new Error('Refusing to remove an unexpected test fixture');
    }
    rmSync(absolute, { recursive: true, force: true });
  }
});

void test('exports current tracked/untracked bytes, omits tracked deletion, and hashes the exact files', () => {
  const { source, destination } = fixture();
  put(source, 'deleted.ts', 'old\n');
  execFileSync('git', ['add', '--', 'deleted.ts'], { cwd: source });
  rmSync(path.join(source, 'deleted.ts'));
  put(source, 'src/雪 场.ts', 'export const price = 0;\r\n');
  put(source, 'assets/sample.bin', Uint8Array.from([0, 1, 255]));
  const result = execute(source, destination);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(path.join(destination, 'deleted.ts')), false);
  assert.equal(existsSync(path.join(destination, '.git')), false);
  const manifest = JSON.parse(
    readFileSync(path.join(destination, '.source-export.json'), 'utf8'),
  ) as {
    sourceSha256: string;
    files: { path: string; bytes: number; sha256: string }[];
  };
  const digest = createHash('sha256');
  for (const entry of manifest.files) {
    const bytes = readFileSync(path.join(destination, entry.path));
    assert.deepEqual(bytes, readFileSync(path.join(source, entry.path)));
    assert.equal(bytes.length, entry.bytes);
    assert.equal(
      createHash('sha256').update(bytes).digest('hex'),
      entry.sha256,
    );
    digest.update(`${entry.sha256}\t${entry.bytes}\t${entry.path}\n`);
  }
  assert.equal(digest.digest('hex'), manifest.sourceSha256);
  assert.ok(manifest.files.some((entry) => entry.path === 'src/雪 场.ts'));
});

void test('excludes ignored credentials, logs, generated outputs, and local agent settings', () => {
  const { source, destination } = fixture();
  for (const name of [
    '.env',
    'node_modules/test.js',
    'run.log',
    'dist/main.js',
    '.next/server.js',
    '.expo/types/router.d.ts',
    '.claude/settings.json',
    'build.tsbuildinfo',
  ])
    put(source, name, 'PRIVATE');
  put(source, '.env.example', 'API_URL=\n');
  assert.equal(execute(source, destination).status, 0);
  assert.equal(
    readFileSync(path.join(destination, '.env.example'), 'utf8'),
    'API_URL=\n',
  );
  for (const name of [
    '.env',
    'node_modules',
    'run.log',
    'dist',
    '.next',
    '.expo',
    '.claude',
    'build.tsbuildinfo',
  ])
    assert.equal(existsSync(path.join(destination, name)), false);
});

void test('never overwrites an existing destination', () => {
  const { source, destination } = fixture();
  mkdirSync(destination);
  put(destination, 'sentinel', 'keep');
  rejected(source, destination, 'Destination already exists');
  assert.equal(
    readFileSync(path.join(destination, 'sentinel'), 'utf8'),
    'keep',
  );
});

void test('rejects destinations inside source and relative paths before writing', () => {
  const { source } = fixture();
  rejected(source, path.join(source, 'nested'), 'must be disjoint');
  assert.equal(existsSync(path.join(source, 'nested')), false);
  rejected(source, 'relative', 'Usage:');
  assert.equal(existsSync(path.join(source, 'relative')), false);
});

void test('rejects a destination whose parent junction resolves inside source', () => {
  const { root, source } = fixture();
  const link = path.join(root, 'linked-parent');
  symlinkSync(source, link, process.platform === 'win32' ? 'junction' : 'dir');
  rejected(source, path.join(link, 'nested'), 'must be disjoint');
  assert.equal(existsSync(path.join(source, 'nested')), false);
});

void test('rejects source junctions and leaves their targets unchanged', () => {
  const { root, source, destination } = fixture();
  put(root, 'outside/sentinel', 'keep');
  symlinkSync(
    path.join(root, 'outside'),
    path.join(source, 'linked'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  rejected(source, destination, 'Source links are not supported');
  assert.equal(
    readFileSync(path.join(root, 'outside/sentinel'), 'utf8'),
    'keep',
  );
  assert.equal(existsSync(destination), false);
});

void test('rejects missing mandatory inputs before creating an export', () => {
  const { source, destination } = fixture();
  rmSync(path.join(source, 'pnpm-lock.yaml'));
  rejected(
    source,
    destination,
    'Missing mandatory source input: pnpm-lock.yaml',
  );
  assert.equal(existsSync(destination), false);
});

void test('rejects tracked environment credentials and nonfixture private keys', () => {
  for (const file of ['.env.production', 'private.key']) {
    const { source, destination } = fixture();
    put(source, file, 'PRIVATE');
    execFileSync('git', ['add', '--force', '--', file], { cwd: source });
    rejected(
      source,
      destination,
      file.startsWith('.env')
        ? 'Environment credentials'
        : 'Private credentials',
    );
    assert.equal(existsSync(destination), false);
  }
});

function verify(directory: string, expected: string, scriptRoot = directory) {
  return spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      path.join(scriptRoot, 'scripts/export-source.ts'),
      '--verify',
      directory,
      expected,
    ],
    { cwd: directory, encoding: 'utf8' },
  );
}
type ExportManifest = {
  sourceSha256: string;
  formatVersion: number;
  packageName: string;
  packageManager: string;
  openapi: { version: string; sha256: string };
  files: Array<{ path: string; bytes: number; sha256: string }>;
};
function exported() {
  const f = fixture();
  put(f.source, 'src/雪 场.ts', 'export const value = 7;\n');
  assert.equal(execute(f.source, f.destination).status, 0);
  const manifest = JSON.parse(
    readFileSync(path.join(f.destination, '.source-export.json'), 'utf8'),
  ) as ExportManifest;
  return { ...f, manifest };
}
function saveManifest(directory: string, manifest: ExportManifest) {
  writeFileSync(
    path.join(directory, '.source-export.json'),
    JSON.stringify(manifest),
  );
}
function reseal(manifest: ExportManifest) {
  manifest.sourceSha256 = createHash('sha256')
    .update(
      manifest.files
        .map((e) => e.sha256 + '\t' + e.bytes + '\t' + e.path + '\n')
        .join(''),
    )
    .digest('hex');
}

void test('verifies the relocated export without Git, dependencies, or the original checkout', () => {
  const { root, source, destination, manifest } = exported();
  renameSync(source, path.join(root, 'original-unavailable'));
  const result = verify(destination, manifest.sourceSha256);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout) as {
    verified: boolean;
    files: number;
    sourceSha256: string;
  };
  assert.equal(output.verified, true);
  assert.equal(output.files, manifest.files.length);
  assert.equal(output.sourceSha256, manifest.sourceSha256);
});

void test('rejects modified bytes even when their original length is preserved', () => {
  const { destination, manifest } = exported();
  put(destination, 'src/雪 场.ts', 'export const value = 8;\n');
  const result = verify(destination, manifest.sourceSha256);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Source file does not match/);
});

void test('rejects a missing listed source file', () => {
  const { destination, manifest } = exported();
  rmSync(path.join(destination, 'README.md'));
  const result = verify(destination, manifest.sourceSha256);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Source file set does not match/);
});

void test('rejects added source, credentials, and dependency trees before installation', () => {
  for (const name of ['src/injected.ts', '.env', 'node_modules/injected.js']) {
    const { destination, manifest } = exported();
    put(destination, name, 'unlisted');
    const result = verify(destination, manifest.sourceSha256);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Source file set does not match/);
  }
});

void test('rejects an externally pinned digest mismatch and a malformed pin', () => {
  const { destination } = exported();
  for (const pin of ['0'.repeat(64), '../invalid']) {
    const result = verify(destination, pin);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /digest|SHA-256/);
  }
});

void test('rejects a rehashed modified manifest against the original external digest', () => {
  const { destination, manifest } = exported();
  const expected = manifest.sourceSha256;
  put(destination, 'src/雪 场.ts', 'modified');
  const entry = manifest.files.find((e) => e.path === 'src/雪 场.ts')!;
  entry.bytes = 8;
  entry.sha256 = createHash('sha256').update('modified').digest('hex');
  reseal(manifest);
  saveManifest(destination, manifest);
  const result = verify(destination, expected);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /digest/);
});

void test('rejects traversal, absolute paths, ADS and duplicate manifest entries before reading source', () => {
  for (const name of [
    '../outside',
    'C:/outside',
    '/outside',
    'src/file:stream',
    'src/../outside',
    'src\\outside',
  ]) {
    const { destination, manifest } = exported();
    manifest.files[0]!.path = name;
    reseal(manifest);
    saveManifest(destination, manifest);
    const result = verify(destination, manifest.sourceSha256);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unsafe|sorted/);
  }
  const { destination, manifest } = exported();
  manifest.files.push({ ...manifest.files[0]! });
  reseal(manifest);
  saveManifest(destination, manifest);
  const result = verify(destination, manifest.sourceSha256);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /sorted/);
});

void test('rejects manifest length, digest, version and structure errors', () => {
  const changes = [
    (m: ExportManifest) => {
      m.formatVersion = 2;
    },
    (m: ExportManifest) => {
      m.files[0]!.bytes = -1;
    },
    (m: ExportManifest) => {
      m.files[0]!.bytes = 1.5;
    },
    (m: ExportManifest) => {
      m.files[0]!.sha256 = 'invalid';
    },
    (m: ExportManifest) => {
      m.files = [];
    },
  ];
  for (const change of changes) {
    const { destination, manifest } = exported();
    change(manifest);
    reseal(manifest);
    saveManifest(destination, manifest);
    assert.equal(verify(destination, manifest.sourceSha256).status, 1);
  }
  const { destination, manifest } = exported();
  writeFileSync(path.join(destination, '.source-export.json'), '{broken');
  assert.equal(verify(destination, manifest.sourceSha256).status, 1);
});

void test('rejects package metadata and OpenAPI metadata inconsistent with hashed files', () => {
  for (const key of [
    'packageName',
    'packageManager',
    'apiVersion',
    'apiDigest',
  ]) {
    const { destination, manifest } = exported();
    if (key === 'apiVersion') manifest.openapi.version = 'wrong';
    else if (key === 'apiDigest') manifest.openapi.sha256 = '0'.repeat(64);
    else if (key === 'packageName') manifest.packageName = 'wrong';
    else manifest.packageManager = 'wrong';
    saveManifest(destination, manifest);
    const result = verify(destination, manifest.sourceSha256);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /metadata/);
  }
});

void test('rejects file and directory junctions without reading or modifying their targets', () => {
  const { root, destination, manifest } = exported();
  const sourceDir = path.join(destination, 'src');
  const outside = path.join(root, 'outside');
  renameSync(sourceDir, outside);
  symlinkSync(
    outside,
    sourceDir,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const result = verify(destination, manifest.sourceSha256);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /links/);
  assert.equal(
    readFileSync(path.join(outside, '雪 场.ts'), 'utf8'),
    'export const value = 7;\n',
  );
});

void test('rejects a symlinked manifest even when the linked manifest bytes are valid', () => {
  const { root, source, destination, manifest } = exported();
  const outside = path.join(root, 'outside-manifest.json');
  const file = path.join(destination, '.source-export.json');
  renameSync(file, outside);
  symlinkSync(outside, file, 'file');
  const result = verify(destination, manifest.sourceSha256, source);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /manifest/);
});

void test('rejects missing, relative and surplus verification arguments without mutation', () => {
  const { source, destination, manifest } = exported();
  for (const args of [
    ['--verify'],
    ['--verify', 'relative', manifest.sourceSha256],
    ['--verify', destination, manifest.sourceSha256, 'extra'],
  ]) {
    const result = spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        path.join(source, 'scripts/export-source.ts'),
        ...args,
      ],
      { cwd: source, encoding: 'utf8' },
    );
    assert.equal(result.status, 1);
  }
  assert.equal(
    readFileSync(path.join(destination, 'README.md'), 'utf8'),
    '# 独立项目\n',
  );
});
