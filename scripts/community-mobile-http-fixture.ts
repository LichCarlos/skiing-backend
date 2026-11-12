import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { PrismaService } from '../src/shared/persistence/prisma.service.js';

const database = new URL(process.env.DATABASE_URL ?? '');
if (
  !['localhost', '127.0.0.1'].includes(database.hostname) ||
  database.pathname !== '/linji_community_mobile_validation' ||
  process.env.COMMUNITY_MOBILE_FIXTURE_CONFIRM !==
    'linji_community_mobile_validation'
)
  throw new Error(
    'Explicitly confirmed disposable community mobile database required',
  );
const prisma = new PrismaService();
try {
  if (process.argv[2] === 'prepare') {
    assert.equal(
      await prisma.user.count(),
      1,
      'Fresh seeded database required',
    );
    assert.equal(await prisma.dynamic.count(), 0);
    assert.equal(await prisma.comment.count(), 0);
    await mkdir('storage', { recursive: true });
    await writeFile(
      'storage/community-mobile-http-fixture.json',
      JSON.stringify({
        databaseName: 'linji_community_mobile_validation',
        accounts: ['community-mobile-a', 'community-mobile-b'],
      }),
    );
    console.log('Disposable community HTTP fixture prepared');
  } else if (process.argv[2] === 'verify') {
    const users = await prisma.user.findMany({
      where: { Account: { in: ['community-mobile-a', 'community-mobile-b'] } },
      orderBy: { Account: 'asc' },
    });
    assert.equal(users.length, 2);
    const rows = await prisma.dynamic.findMany({
      where: { AuthorId: { in: users.map((user) => user.UserId) } },
    });
    assert.equal(rows.length, 24);
    assert.equal(rows.filter((row) => row.Status === 'pending').length, 1);
    assert.equal(rows.filter((row) => row.Status === 'hidden').length, 1);
    assert.equal(
      rows.filter((row) => row.Status === 'published' && row.DeletedAt === null)
        .length,
      21,
    );
    const removed = rows.filter((row) => row.DeletedAt !== null);
    assert.equal(removed.length, 1);
    assert.equal(removed[0]!.AuthorId, users[0]!.UserId);
    const comments = await prisma.comment.findMany({
      where: { DynamicId: removed[0]!.DynamicId },
    });
    assert.equal(comments.length, 21);
    assert(comments.every((row) => row.AuthorId === users[0]!.UserId));
    assert.equal(comments.filter((row) => row.DeletedAt !== null).length, 1);
    assert.equal(
      comments.filter((row) => row.Content === 'community-mobile-unconfirmed')
        .length,
      1,
    );
    const likes = await prisma.likeRecord.findMany();
    assert.equal(likes.length, 1);
    assert.equal(likes[0]!.UserId, users[0]!.UserId);
    assert.equal(likes[0]!.DynamicId, removed[0]!.DynamicId);
    assert.equal(await prisma.user.count(), 3);
    console.log(
      'Community persistence verified: 24 dynamics / 21 remaining public, 21 comments / one lost-response POST, one soft-deleted dynamic and comment, one account-owned like.',
    );
  } else throw new Error('Use prepare or verify');
} finally {
  await prisma.$disconnect();
}
