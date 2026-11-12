import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = ['ls-files', '--stage', '-z'];
const entries = execFileSync('git', args, { cwd: root, encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);
const publicFixtures = new Set([
  'test/fixtures/kafka-tls/ca.pem',
  'test/fixtures/kafka-tls/broker-cert.pem',
  'test/fixtures/kafka-tls/broker-key.pem',
]);
const sizes = new Map(
  execFileSync(
    'git',
    ['cat-file', '--batch-check=%(objectname) %(objectsize)'],
    {
      cwd: root,
      encoding: 'utf8',
      input: entries.map((entry) => entry.split(' ')[1]).join('\n') + '\n',
    },
  )
    .trim()
    .split('\n')
    .map((line) => {
      const [object, size] = line.split(' ');
      return [object, Number(size)];
    }),
);
const blockedParts =
  /^(?:node_modules|\.pnpm-store|\.tools|\.next|\.expo|\.turbo|\.gradle|\.cache|\.impeccable|\.codex|\.claude|\.agents|sdk|sdks|android-sdk(?:-.*)?|cmdline-tools|platform-tools|private|secrets|backups|releases|outputs|coverage|dist(?:-.*)?|web-build)$/i;
const blockedExtension =
  /\.(?:apk|aab|ipa|exe|msi|dll|so|dylib|vhdx|gguf|onnx|safetensors|zip|7z|rar|tar|tgz|gz|zst|dump|backup|jks|keystore|p12|pfx|p8|key|pem|mobileprovision|log|tsbuildinfo)$/i;
const issues = [];
for (const entry of entries) {
  const [metadata, name] = entry.split('\t');
  const [mode, object] = metadata.split(' ');
  const parts = name.split('/');
  const basename = parts.at(-1);
  if (
    parts.slice(0, -1).some((part) => blockedParts.test(part)) ||
    /^(?:android|ios)\//i.test(name) ||
    /^(?:local\.properties|credentials\.json|.*service-account.*\.json)$/i.test(
      basename,
    ) ||
    ((basename.startsWith('.env') ||
      basename.includes('.env.') ||
      basename.endsWith('.env')) &&
      !basename.endsWith('.env.example')) ||
    (blockedExtension.test(name) && !publicFixtures.has(name))
  )
    issues.push(`${name}: generated, SDK or private file is not source`);
  if (mode !== '100644' && mode !== '100755')
    issues.push(
      `${name}: links, submodules and non-regular entries need review`,
    );
  const size = sizes.get(object);
  if (size > 10 * 1024 * 1024)
    issues.push(`${name}: exceeds the 10 MiB source review boundary`);
}
const manifest = JSON.parse(
  readFileSync(path.join(root, 'package.json'), 'utf8'),
);
if (
  !manifest.packageManager ||
  !entries.some((entry) => entry.endsWith('\tpnpm-lock.yaml'))
)
  issues.push('packageManager and pnpm-lock.yaml must be committed');
if (issues.length) {
  console.error(issues.join('\n'));
  process.exitCode = 1;
} else {
  console.log(
    `Repository boundary passed: ${entries.length} indexed source files.`,
  );
}
