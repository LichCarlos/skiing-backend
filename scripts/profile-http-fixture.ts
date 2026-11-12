import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { PrismaService } from '../src/shared/persistence/prisma.service.js';
import { BcryptPasswordHasher } from '../src/modules/identity-access/infrastructure/bcrypt-password-hasher.js';

const url = new URL(process.env.DATABASE_URL ?? '');
if (
  !['localhost', '127.0.0.1'].includes(url.hostname) ||
  url.pathname !== '/linji_profile_validation' ||
  process.env.PROFILE_HTTP_FIXTURE_CONFIRM !== 'linji_profile_validation'
)
  throw new Error(
    'Explicitly confirmed disposable profile validation database required',
  );
const path = 'storage/profile-http-fixture.json';
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
  const password = process.env.PROFILE_HTTP_FIXTURE_PASSWORD ?? '';
  assert.ok(
    Buffer.byteLength(password) >= 8 && Buffer.byteLength(password) <= 72,
  );
  const hash = await new BcryptPasswordHasher().hash(password);
  const role = await prisma.role.findUniqueOrThrow({
    where: { SystemRoleCode: 'registered_user' },
  });
  const prefix = `profile-${randomUUID().slice(0, 8)}`;
  const users = await prisma.$transaction(
    [0, 1].map((i) =>
      prisma.user.create({
        data: {
          Account: `${prefix}-${i}`,
          Nickname: 'Original profile',
          PasswordHash: hash,
          Avatar: 'https://legacy.example/avatar.png',
          UserRoles: { create: { RoleId: role.RoleId } },
        },
      }),
    ),
  );
  const manifest: Manifest = {
    databaseName: 'linji_profile_validation',
    accounts: users.map((u) => u.Account),
    userIds: users.map((u) => u.UserId),
  };
  await mkdir('storage', { recursive: true });
  await writeFile(path, JSON.stringify(manifest, null, 2));
  console.log('Synthetic profile fixture created; no credentials persisted');
}
try {
  const action = process.argv[2];
  if (action === 'create') await create();
  else {
    const manifest = JSON.parse(await readFile(path, 'utf8')) as Manifest;
    assert.equal(manifest.databaseName, 'linji_profile_validation');
    assert.equal(manifest.userIds.length, 2);
    if (action === 'verify') {
      for (const [index, id] of manifest.userIds.entries()) {
        const user = await prisma.user.findUniqueOrThrow({
          where: { UserId: id },
        });
        assert.equal(user.Account, manifest.accounts[index]);
        assert.equal(
          user.Nickname,
          index === 0 ? 'Profile cleared' : 'Committed unknown',
        );
        assert.equal(user.AvatarAssetId, null);
        assert.equal(
          user.Avatar,
          index === 0 ? null : 'https://legacy.example/avatar.png',
        );
        assert.equal(
          await prisma.operationLog.count({
            where: {
              ActorUserId: id,
              ActionKey: 'account:profile:update',
              Result: 'success',
            },
          }),
          index === 0 ? 2 : 1,
        );
      }
      console.log(
        'Persisted nicknames/legacy-avatar semantics and exactly 2+1 successful audits verified',
      );
    } else if (action === 'cleanup') {
      await prisma.$transaction(async (tx) => {
        for (const [index, id] of manifest.userIds.entries()) {
          const user = await tx.user.findUniqueOrThrow({
            where: { UserId: id },
          });
          assert.equal(user.Account, manifest.accounts[index]);
        }
        await tx.operationLog.deleteMany({
          where: { ActorUserId: { in: manifest.userIds } },
        });
        await tx.user.deleteMany({
          where: { UserId: { in: manifest.userIds } },
        });
      });
      await unlink(path);
      assert.equal(await prisma.user.count(), 1);
      assert.equal(await prisma.operationLog.count(), 0);
      assert.equal(await prisma.authSession.count(), 0);
      console.log(
        'Only fixture IDs removed; User=1 OperationLog=0 AuthSession=0',
      );
    } else throw new Error('Use create, verify or cleanup');
  }
} finally {
  await prisma.$disconnect();
}
