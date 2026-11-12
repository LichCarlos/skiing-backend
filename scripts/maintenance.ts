import { existsSync } from 'node:fs';
import { PrismaService } from '../src/shared/persistence/prisma.service.js';
import { PrismaRagMaintenance } from '../src/modules/ai-assistant/infrastructure/prisma-rag-maintenance.js';
import { PrismaAssetMaintenance } from '../src/modules/assets/infrastructure/prisma-asset-maintenance.js';
import { S3AssetStorage } from '../src/modules/assets/infrastructure/s3-asset-storage.js';

async function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== '--');
  if (args.includes('--help')) {
    console.log(
      'maintenance:rag|maintenance:assets [--apply] [--after-id N] [--batch-size 1..500] [--min-age-hours 24..8760]. Default is read-only preview. Re-run without cursor to retry skipped/failed candidates.',
    );
    return;
  }
  const kind = args.shift();
  if (kind !== 'rag' && kind !== 'assets')
    throw new TypeError('Choose rag or assets');
  const input: {
    apply: boolean;
    afterId?: string;
    batchSize?: number;
    minAgeHours?: number;
  } = { apply: false };
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const option = args[i]!;
    if (seen.has(option)) throw new TypeError('Duplicate option');
    seen.add(option);
    if (option === '--apply') {
      input.apply = true;
      continue;
    }
    const value = args[++i];
    if (!value || !/^\d+$/.test(value))
      throw new TypeError('Invalid option value');
    if (option === '--after-id') input.afterId = value;
    else if (option === '--batch-size') input.batchSize = Number(value);
    else if (option === '--min-age-hours') input.minAgeHours = Number(value);
    else throw new TypeError('Unknown maintenance option');
  }
  if (existsSync('.env')) process.loadEnvFile('.env');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const prisma = new PrismaService();
  try {
    await prisma.$connect();
    const result =
      kind === 'rag'
        ? await new PrismaRagMaintenance(prisma).sweep({
            ...input,
            afterId:
              input.afterId === undefined ? undefined : Number(input.afterId),
          })
        : await new PrismaAssetMaintenance(prisma, new S3AssetStorage()).sweep(
            input,
          );
    console.log(JSON.stringify(result));
    if ('failed' in result && result.failed > 0) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
main().catch(() => {
  console.error(
    'Maintenance failed; inspect restricted service diagnostics. No credentials or storage keys are printed.',
  );
  process.exitCode = 1;
});
