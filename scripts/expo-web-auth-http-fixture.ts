import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { compare } from 'bcryptjs';
import { PrismaService } from '../src/shared/persistence/prisma.service.js';

const databaseName = 'linji_expo_web_validation';
const url = new URL(process.env.DATABASE_URL ?? '');
if (
  !['localhost', '127.0.0.1'].includes(url.hostname) ||
  url.pathname !== '/' + databaseName ||
  process.env.EXPO_WEB_FIXTURE_CONFIRM !== databaseName
)
  throw new Error('Explicitly confirmed disposable Expo Web database required');
const prisma = new PrismaService();
const path = 'storage/expo-web-auth-http-fixture.json';
try {
  if (process.argv[2] === 'prepare') {
    assert.equal(await prisma.user.count(), 1);
    assert.equal(await prisma.authSession.count(), 0);
    await mkdir('storage', { recursive: true });
    await writeFile(
      path,
      JSON.stringify({ databaseName, account: 'expo-web-validation-user' }),
    );
    console.log(
      'Prepared noncredential manifest for one browser-protocol HTTP account',
    );
  } else if (process.argv[2] === 'verify') {
    const manifest = JSON.parse(await readFile(path, 'utf8')) as {
      account: string;
    };
    const user = await prisma.user.findUniqueOrThrow({
      where: { Account: manifest.account },
    });
    assert.equal(await prisma.user.count(), 2);
    assert.equal(user.Nickname, 'Browser HTTP verified');
    const replacement = process.env.EXPO_WEB_FIXTURE_REPLACEMENT;
    assert.ok(replacement);
    assert.ok(await compare(replacement, user.PasswordHash));
    assert.equal(
      await prisma.authSession.count({
        where: { UserId: user.UserId, RevokedAt: null },
      }),
      1,
    );
    assert.ok(
      (await prisma.authSession.count({
        where: { UserId: user.UserId, RevokedAt: { not: null } },
      })) >= 3,
    );
    assert.ok(
      (await prisma.authRefreshToken.count({
        where: { Session: { UserId: user.UserId }, ConsumedAt: { not: null } },
      })) >= 2,
    );
    console.log(
      'Verified account/profile/password, revoked sessions and one active session after intentionally lost refresh response',
    );
  } else throw new Error('Use prepare or verify');
} finally {
  await prisma.$disconnect();
}
