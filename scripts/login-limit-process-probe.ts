import assert from 'node:assert/strict';
import { PrismaService } from '../src/shared/persistence/prisma.service.js';
import { LoginBucketKeys } from '../src/modules/identity-access/infrastructure/login-bucket-keys.js';
import { PrismaLoginAttemptStore } from '../src/modules/identity-access/infrastructure/prisma-login-attempt.store.js';

// Test helper: never accepts an arbitrary production target or returns identifiers.
const url = new URL(process.env.DATABASE_URL ?? '');
assert(['127.0.0.1', 'localhost'].includes(url.hostname));
assert(process.env.LINJI_DATABASE_TEST_DISPOSABLE === 'true');
assert(url.pathname.includes('validation'));
const count = Number(process.argv[2]);
assert(Number.isInteger(count) && count >= 1 && count <= 5);
const prisma = new PrismaService();
try {
  const store = new PrismaLoginAttemptStore(
    prisma,
    new LoginBucketKeys(process.env.LOGIN_RATE_LIMIT_SECRET ?? ''),
  );
  const results = [];
  for (let i = 0; i < count; i++)
    results.push(await store.consume('process-restart-fixture', '192.0.2.9'));
  console.info(JSON.stringify(results));
} finally {
  await prisma.$disconnect();
}
