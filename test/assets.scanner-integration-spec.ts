import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { PrismaService } from '../src/shared/persistence/prisma.service.js';
import { ClamAvAssetScanner } from '../src/modules/assets/infrastructure/clamav-asset-scanner.js';
import { PrismaAssetRepository } from '../src/modules/assets/infrastructure/prisma-asset.repository.js';
import { ManageAssets } from '../src/modules/assets/application/manage-assets.js';

describe('real ClamAV INSTREAM and PostgreSQL asset lifecycle', () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9ioAAAAASUVORK5CYII=',
    'base64',
  );
  // Standard harmless antivirus test pattern, built in memory; never a user file.
  const eicar = Buffer.from(
    [
      'X5O!P%@AP[4',
      '\\PZX54(P^)7CC)7}$EICAR',
      '-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*',
    ].join(''),
    'ascii',
  );
  const prisma = new PrismaService();
  const scanner = new ClamAvAssetScanner();
  const objects = new Map<string, Buffer>();
  const put = vi.fn(async (input: { key: string; body: Buffer }) => {
    objects.set(input.key, input.body);
  });
  const remove = vi.fn(async (key: string) => {
    objects.delete(key);
  });
  const storage = {
    put,
    remove,
    createReadUrl: async (key: string) =>
      `https://storage-substitute.example/${key}`,
  };
  const service = new ManageAssets(
    new PrismaAssetRepository(prisma),
    storage,
    scanner,
  );
  let ownerId: number;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL || !process.env.ASSET_INTEGRATION_CLAMAV_PORT)
      throw new Error(
        'Dedicated DATABASE_URL and ASSET_INTEGRATION_CLAMAV_PORT are required',
      );
    vi.stubEnv(
      'CLAMAV_HOST',
      process.env.ASSET_INTEGRATION_CLAMAV_HOST ?? '127.0.0.1',
    );
    vi.stubEnv('CLAMAV_PORT', process.env.ASSET_INTEGRATION_CLAMAV_PORT);
    vi.stubEnv('CLAMAV_TIMEOUT_MS', '15000');
    await prisma.$connect();
    ownerId = (
      await prisma.user.create({
        data: {
          Account: `scanner-${randomUUID()}`,
          Nickname: 'Scanner integration',
          PasswordHash: 'test-only',
          UserRoles: {
            create: {
              Role: { connect: { SystemRoleCode: 'registered_user' } },
            },
          },
        },
      })
    ).UserId;
  });

  afterAll(async () => {
    try {
      if (ownerId) {
        await prisma.asset.deleteMany({ where: { OwnerUserId: ownerId } });
        await prisma.user.delete({ where: { UserId: ownerId } });
      }
    } finally {
      await prisma.$disconnect();
      vi.unstubAllEnvs();
    }
  });

  it('accepts a clean PNG through the actual scanner TCP protocol', async () => {
    await expect(scanner.scan(png)).resolves.toBe('clean');
  });

  it('rejects the standard harmless EICAR antivirus test pattern', async () => {
    expect(eicar).toHaveLength(68);
    await expect(scanner.scan(eicar)).resolves.toBe('infected');
  });

  it('keeps concurrent scanner requests isolated', async () => {
    expect(
      await Promise.all([
        scanner.scan(png),
        scanner.scan(eicar),
        scanner.scan(png),
      ]),
    ).toEqual(['clean', 'infected', 'clean']);
  });

  it('marks the uploaded image ready only after a clean real scan and then supports owner deletion', async () => {
    const result = await service.upload({
      ownerUserId: ownerId,
      originalName: 'clean.png',
      buffer: png,
    });
    expect(result.status).toBe('ready');
    const row = await prisma.asset.findUniqueOrThrow({
      where: { AssetId: BigInt(result.assetId) },
    });
    expect(row.Status).toBe('ready');
    expect(objects.get(row.StorageKey)).toEqual(png);
    await service.remove(result.assetId, ownerId);
    expect(objects.has(row.StorageKey)).toBe(false);
    expect(
      await prisma.asset.findUniqueOrThrow({ where: { AssetId: row.AssetId } }),
    ).toMatchObject({ Status: 'deleted' });
  });

  it('persists rejected state without uploading when the scanner connection is unavailable', async () => {
    // Reserve an unused TCP port, then release it; no live scanner listens there.
    const reserve = createServer();
    await new Promise<void>((resolve) =>
      reserve.listen(0, '127.0.0.1', resolve),
    );
    const address = reserve.address();
    if (!address || typeof address === 'string')
      throw new Error('No test port');
    await new Promise<void>((resolve, reject) =>
      reserve.close((error) => (error ? reject(error) : resolve())),
    );
    const previousPort = process.env.CLAMAV_PORT;
    vi.stubEnv('CLAMAV_PORT', String(address.port));
    put.mockClear();
    try {
      await expect(
        service.upload({
          ownerUserId: ownerId,
          originalName: 'scanner-offline.png',
          buffer: png,
        }),
      ).rejects.toMatchObject({ status: 503 });
      expect(
        await prisma.asset.findFirstOrThrow({
          where: { OwnerUserId: ownerId, OriginalName: 'scanner-offline.png' },
        }),
      ).toMatchObject({ Status: 'rejected' });
      expect(put).not.toHaveBeenCalled();
    } finally {
      vi.stubEnv('CLAMAV_PORT', previousPort);
    }
  });
});
