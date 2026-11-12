import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { PrismaService } from '../src/shared/persistence/prisma.service.js';
import { BcryptPasswordHasher } from '../src/modules/identity-access/infrastructure/bcrypt-password-hasher.js';

const url = new URL(process.env.DATABASE_URL ?? '');
if (
  !['localhost', '127.0.0.1'].includes(url.hostname) ||
  url.pathname !== '/linji_password_validation' ||
  process.env.PASSWORD_BROWSER_FIXTURE_CONFIRM !== 'linji_password_validation'
)
  throw new Error(
    'Only the explicitly confirmed disposable password validation DB is permitted',
  );
const path = 'storage/password-browser-fixture.json';
const prisma = new PrismaService();
interface Manifest {
  databaseName: string;
  adminAccount: string;
  adminId: number;
  targetAccount: string;
  targetId: number;
  limitedAccount: string;
  userIds: number[];
  roleId: number;
}
async function create() {
  try {
    await readFile(path);
    throw new Error('Existing fixture must be cleaned before creating another');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  assert.equal(await prisma.user.count(), 1, 'Fresh seeded database required');
  const password = process.env.PASSWORD_BROWSER_FIXTURE_PASSWORD ?? '';
  assert.ok(
    Buffer.byteLength(password) >= 8 && Buffer.byteLength(password) <= 72,
  );
  const hash = await new BcryptPasswordHasher().hash(password);
  const run = `pwd-${randomUUID().slice(0, 8)}`;
  const adminRole = await prisma.role.findUniqueOrThrow({
    where: { SystemRoleCode: 'system_admin' },
  });
  const userRole = await prisma.role.findUniqueOrThrow({
    where: { SystemRoleCode: 'registered_user' },
  });
  const keys = [
    'management:portal:enter',
    'account:profile:read',
    'system:user:list',
    'system:user:reset-password',
  ];
  const grants = await prisma.permission.findMany({
    where: { PermissionKey: { in: keys } },
  });
  assert.equal(grants.length, keys.length);
  const result = await prisma.$transaction(async (tx) => {
    const role = await tx.role.create({
      data: {
        RoleKey: `${run}-reader`,
        RoleName: 'Synthetic account reader',
        DataScope: 'all',
        RolePermissions: {
          create: grants.map((p) => ({ PermissionId: p.PermissionId })),
        },
      },
    });
    const actor = (suffix: string, roleId: number) =>
      tx.user.create({
        data: {
          Account: `${run}-${suffix}`,
          Nickname: `Synthetic ${suffix}`,
          PasswordHash: hash,
          UserRoles: { create: { RoleId: roleId } },
        },
      });
    const admin = await actor('admin', adminRole.RoleId);
    const target = await actor('target', userRole.RoleId);
    const limited = await actor('limited', role.RoleId);
    return {
      databaseName: 'linji_password_validation',
      adminAccount: admin.Account,
      adminId: admin.UserId,
      targetAccount: target.Account,
      targetId: target.UserId,
      limitedAccount: limited.Account,
      userIds: [admin.UserId, target.UserId, limited.UserId],
      roleId: role.RoleId,
    } satisfies Manifest;
  });
  await mkdir('storage', { recursive: true });
  await writeFile(path, JSON.stringify(result, null, 2));
  console.log(
    'Synthetic password browser fixture created; no credentials persisted',
  );
}
async function verify(m: Manifest) {
  const logs = await prisma.operationLog.findMany({
    where: {
      ActorUserId: m.adminId,
      ActionKey: 'system:user:reset-password',
    },
  });
  assert.equal(logs.filter((l) => l.TargetId === String(m.targetId)).length, 2);
  assert.equal(logs.filter((l) => l.TargetId === String(m.adminId)).length, 1);
  assert.ok(logs.every((l) => l.Result === 'success'));
  assert.equal(
    await prisma.authSession.count({
      where: {
        UserId: { in: [m.adminId, m.targetId] },
        RevokedAt: null,
      },
    }),
    0,
  );
  console.log(
    'Three committed resets audited; admin and target sessions revoked',
  );
}
try {
  const action = process.argv[2];
  if (action === 'create') await create();
  else {
    const m = JSON.parse(await readFile(path, 'utf8')) as Manifest;
    assert.equal(m.databaseName, 'linji_password_validation');
    if (action === 'verify') await verify(m);
    else if (action === 'cleanup') {
      await prisma.$transaction(async (tx) => {
        await tx.operationLog.deleteMany({
          where: { ActorUserId: { in: m.userIds } },
        });
        await tx.user.deleteMany({ where: { UserId: { in: m.userIds } } });
        await tx.role.delete({ where: { RoleId: m.roleId } });
      });
      await unlink(path);
      console.log('Only recorded synthetic password fixture removed');
    } else throw new Error('Use create, verify or cleanup');
  }
} finally {
  await prisma.$disconnect();
}
