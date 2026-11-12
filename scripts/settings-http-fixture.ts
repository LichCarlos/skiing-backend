import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { PrismaService } from '../src/shared/persistence/prisma.service.js';
import { BcryptPasswordHasher } from '../src/modules/identity-access/infrastructure/bcrypt-password-hasher.js';

const url = new URL(process.env.DATABASE_URL ?? '');
if (
  !['localhost', '127.0.0.1'].includes(url.hostname) ||
  url.pathname !== '/linji_settings_validation' ||
  process.env.SETTINGS_HTTP_FIXTURE_CONFIRM !== 'linji_settings_validation'
)
  throw new Error(
    'Explicitly confirmed disposable settings validation database required',
  );
const path = 'storage/settings-http-fixture.json';
const prisma = new PrismaService();
interface Manifest {
  databaseName: string;
  accounts: string[];
  userIds: number[];
}
async function create() {
  try {
    await readFile(path);
    throw new Error('Existing fixture must be cleaned first');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  assert.equal(await prisma.user.count(), 1, 'Fresh seeded database required');
  const password = process.env.SETTINGS_HTTP_FIXTURE_PASSWORD ?? '';
  assert.ok(
    Buffer.byteLength(password) >= 8 && Buffer.byteLength(password) <= 72,
  );
  const hash = await new BcryptPasswordHasher().hash(password);
  const role = await prisma.role.findUniqueOrThrow({
    where: { SystemRoleCode: 'registered_user' },
  });
  const prefix = `settings-${randomUUID().slice(0, 8)}`;
  const users = await prisma.$transaction(
    [0, 1].map((i) =>
      prisma.user.create({
        data: {
          Account: `${prefix}-${i}`,
          Nickname: 'Synthetic settings user',
          PasswordHash: hash,
          UserRoles: { create: { RoleId: role.RoleId } },
        },
      }),
    ),
  );
  const manifest: Manifest = {
    databaseName: 'linji_settings_validation',
    accounts: users.map((u) => u.Account),
    userIds: users.map((u) => u.UserId),
  };
  await mkdir('storage', { recursive: true });
  await writeFile(path, JSON.stringify(manifest, null, 2));
  console.log('Synthetic settings fixture created without persisted passwords');
}
try {
  const action = process.argv[2];
  if (action === 'create') await create();
  else {
    const manifest = JSON.parse(await readFile(path, 'utf8')) as Manifest;
    assert.equal(manifest.databaseName, 'linji_settings_validation');
    if (action === 'verify') {
      for (const id of manifest.userIds) {
        assert.equal(
          await prisma.operationLog.count({
            where: {
              ActorUserId: id,
              ActionKey: 'account:password:change',
              Result: 'success',
            },
          }),
          1,
        );
        assert.equal(
          await prisma.authSession.count({
            where: { UserId: id, RevokedAt: null },
          }),
          0,
        );
      }
      console.log(
        'Two real password changes audited once; all fixture sessions revoked',
      );
    } else if (action === 'cleanup') {
      await prisma.$transaction(async (tx) => {
        await tx.operationLog.deleteMany({
          where: { ActorUserId: { in: manifest.userIds } },
        });
        await tx.user.deleteMany({
          where: { UserId: { in: manifest.userIds } },
        });
      });
      await unlink(path);
      console.log(
        'Only recorded synthetic settings users and audit rows removed',
      );
    } else throw new Error('Use create, verify or cleanup');
  }
} finally {
  await prisma.$disconnect();
}
