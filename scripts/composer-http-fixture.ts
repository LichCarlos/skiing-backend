import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { PrismaService } from '../src/shared/persistence/prisma.service.js';

const database = new URL(process.env.DATABASE_URL ?? '');
if (
  !['localhost', '127.0.0.1'].includes(database.hostname) ||
  database.pathname !== '/linji_composer_validation' ||
  process.env.COMPOSER_FIXTURE_CONFIRM !== 'linji_composer_validation'
)
  throw new Error('Explicitly confirmed disposable composer database required');
const prisma = new PrismaService();
const statsPath = 'storage/composer-storage-stats.json';
const manifestPath = 'storage/composer-http-fixture.json';
const stats = { puts: 0, deletes: 0, gets: 0 };
if (process.argv[2] === 'serve') {
  assert.equal(await prisma.user.count(), 1);
  assert.equal(await prisma.dynamic.count(), 0);
  assert.equal(await prisma.asset.count(), 0);
  const resort = await prisma.skiResort.create({
    data: {
      Name: 'composer-public-resort',
      Description: 'composer fixture resort',
      LegacyDistance: 0,
      Price: 100,
      SnowCondition: 'powder',
      Status: 'published',
    },
  });
  await mkdir('storage', { recursive: true });
  await writeFile(
    manifestPath,
    JSON.stringify({
      databaseName: 'linji_composer_validation',
      resortId: resort.ResortId,
      accounts: ['composer-mobile-a', 'composer-mobile-b'],
    }),
  );
  await writeFile(statsPath, JSON.stringify(stats));
  const objects = new Map<string, Buffer>();
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1:62932');
      assert.match(
        url.pathname,
        /^\/composer-fixture\/assets\/[1-9]\d*\/[a-z0-9-]+\.(png|jpe?g|webp)$/,
      );
      if (request.method === 'PUT' || request.method === 'DELETE')
        assert.match(
          request.headers.authorization ?? '',
          /^AWS4-HMAC-SHA256 Credential=composer-local\//,
        );
      if (request.method === 'PUT') {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of request) {
          size += Buffer.byteLength(chunk);
          assert(size < 11 * 1024 * 1024);
          chunks.push(Buffer.from(chunk));
        }
        objects.set(url.pathname, Buffer.concat(chunks));
        stats.puts++;
        response.writeHead(200, { ETag: '"composer-synthetic-etag"' });
        response.end();
      } else if (request.method === 'DELETE') {
        objects.delete(url.pathname);
        stats.deletes++;
        response.writeHead(204);
        response.end();
      } else if (request.method === 'GET') {
        assert.equal(url.searchParams.get('X-Amz-Expires'), '900');
        assert(url.searchParams.has('X-Amz-Signature'));
        const bytes = objects.get(url.pathname);
        stats.gets++;
        response.writeHead(bytes ? 200 : 404, { 'content-type': 'image/png' });
        response.end(bytes);
      } else {
        response.writeHead(405);
        response.end();
      }
      await writeFile(statsPath, JSON.stringify(stats));
    })().catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  await new Promise<void>((resolve) =>
    server.listen(62932, '127.0.0.1', resolve),
  );
  await prisma.$disconnect();
  console.log(
    'Composer synthetic S3 HTTP fixture ready on 62932; signature presence is checked, cryptographic signature verification is not implemented.',
  );
} else if (process.argv[2] === 'verify') {
  try {
    const users = await prisma.user.findMany({
      where: { Account: { in: ['composer-mobile-a', 'composer-mobile-b'] } },
      orderBy: { Account: 'asc' },
    });
    assert.equal(users.length, 2);
    const dynamics = await prisma.dynamic.findMany({
      include: { Images: { orderBy: { SortOrder: 'asc' } } },
    });
    assert.equal(dynamics.length, 2);
    const a = dynamics.find((row) => row.AuthorId === users[0]!.UserId)!;
    const b = dynamics.find((row) => row.AuthorId === users[1]!.UserId)!;
    assert.equal(a.Content, 'composer-final-edit');
    assert.equal(a.Status, 'pending');
    assert.equal(a.ResortId, null);
    assert.equal(a.Images.length, 2);
    assert.equal(b.Content, 'composer-lost-response');
    assert.equal(b.Status, 'pending');
    assert.equal(b.Images.length, 0);
    const assets = await prisma.asset.findMany({ orderBy: { AssetId: 'asc' } });
    assert.equal(assets.length, 3);
    assert(
      assets.every(
        (asset) =>
          asset.OwnerUserId === users[0]!.UserId && asset.Status === 'ready',
      ),
    );
    assert.equal(a.Images[0]!.AssetId, assets[1]!.AssetId);
    assert.equal(a.Images[1]!.AssetId, assets[2]!.AssetId);
    const storageStats = JSON.parse(
      await readFile(statsPath, 'utf8'),
    ) as typeof stats;
    assert.equal(storageStats.puts, 3);
    assert.equal(storageStats.deletes, 0);
    assert(storageStats.gets >= 1);
    assert.equal(await prisma.user.count(), 3);
    console.log(
      'Composer persistence verified: two pending dynamics, one lost-response creation, exact edited text/unlink/order, three owner-ready assets and only three S3 PUTs.',
    );
  } finally {
    await prisma.$disconnect();
  }
} else {
  await prisma.$disconnect();
  throw new Error('Use serve or verify');
}
