import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { PrismaService } from '../src/shared/persistence/prisma.service.js';
const url = new URL(process.env.DATABASE_URL ?? '');
if (
  !['localhost', '127.0.0.1'].includes(url.hostname) ||
  url.pathname !== '/linji_knowledge_list_validation' ||
  process.env.KNOWLEDGE_LIST_FIXTURE_CONFIRM !==
    'linji_knowledge_list_validation'
)
  throw new Error(
    'Explicitly confirmed disposable knowledge-list database required',
  );
const prisma = new PrismaService();
const path = 'storage/knowledge-list-http-fixture.json';
try {
  if (process.argv[2] === 'prepare') {
    assert.equal(await prisma.user.count(), 1);
    assert.equal(await prisma.article.count(), 0);
    await prisma.dictionaryType.upsert({
      where: { DictType: 'knowledge.article_category' },
      create: {
        DictType: 'knowledge.article_category',
        DictName: 'Knowledge validation',
        GroupKey: 'knowledge',
        PubliclyReadable: true,
      },
      update: { PubliclyReadable: true, Status: 'active' },
    });
    for (const [Value, Status] of [
      ['validation-a', 'active'],
      ['validation-b', 'active'],
      ['validation-inactive', 'disabled'],
    ] as const)
      await prisma.dictionaryItem.create({
        data: {
          DictType: 'knowledge.article_category',
          Label: Value,
          Value,
          Status,
        },
      });
    const articleIds: number[] = [];
    for (let i = 0; i < 18; i++) {
      const row = await prisma.article.create({
        data: {
          Title:
            i === 0
              ? 'Literal %_ snow'
              : 'Knowledge ' + String(i).padStart(2, '0'),
          Summary: i === 1 ? 'MixedCase Keyword' : 'validation summary',
          Body: 'Public validation body',
          CategoryValue:
            i === 17
              ? 'validation-inactive'
              : i % 2
                ? 'validation-b'
                : 'validation-a',
          Status: i === 15 ? 'draft' : i === 16 ? 'withdrawn' : 'published',
          PublishTime: i === 15 ? null : new Date('2026-11-02T00:00:00Z'),
          DeletedAt: i === 14 ? new Date() : null,
          AuthorName: i % 2 ? 'Synthetic author' : null,
        },
      });
      articleIds.push(row.ArticleId);
    }
    await mkdir('storage', { recursive: true });
    await writeFile(
      path,
      JSON.stringify({
        databaseName: 'linji_knowledge_list_validation',
        accounts: ['knowledge-mobile-a', 'knowledge-mobile-b'],
        articleIds,
        categoryValues: ['validation-a', 'validation-b'],
      }),
    );
    console.log(
      'Prepared 14 public and 4 excluded articles with deterministic same-time ID ordering',
    );
  } else if (process.argv[2] === 'verify') {
    const manifest = JSON.parse(await readFile(path, 'utf8')) as {
      accounts: string[];
      articleIds: number[];
    };
    const users = await prisma.user.findMany({
      where: { Account: { in: manifest.accounts } },
      orderBy: { Account: 'asc' },
    });
    assert.equal(users.length, 2);
    const favorites = await prisma.favorite.findMany({
      orderBy: { UserId: 'asc' },
    });
    assert.equal(favorites.length, 2);
    assert.deepEqual(
      favorites.map((row) => [row.UserId, row.ArticleId]),
      [
        [users[0]!.UserId, manifest.articleIds[0]],
        [users[1]!.UserId, manifest.articleIds[1]],
      ],
    );
    assert.equal(await prisma.article.count(), 18);
    assert.equal(await prisma.user.count(), 3);
    console.log(
      'Verified 18 unchanged articles, two accounts and distinct article favorite ownership',
    );
  } else throw new Error('Use prepare or verify');
} finally {
  await prisma.$disconnect();
}
