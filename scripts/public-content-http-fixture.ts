import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';

const database = new URL(process.env.DATABASE_URL ?? '');
const path = process.env.PUBLIC_CONTENT_HTTP_FIXTURE_PATH;
assert(
  ['127.0.0.1', 'localhost'].includes(database.hostname) &&
    database.pathname === '/linji_public_content_validation' &&
    process.env.PUBLIC_CONTENT_HTTP_CONFIRM ===
      'linji_public_content_validation' &&
    path,
  'Explicit disposable public-content database and manifest path required',
);
const prisma = new PrismaClient();
interface Fixture {
  databaseName: string;
  resortIds: number[];
  articleIds: number[];
  dynamicIds: number[];
  commentIds: number[];
}
try {
  const databaseName = await prisma.$queryRaw<
    Array<{ name: string }>
  >`SELECT current_database() AS name`;
  assert.equal(databaseName[0]?.name, 'linji_public_content_validation');
  if (process.argv[2] === 'prepare') {
    assert.equal(await prisma.user.count(), 1);
    for (const count of [
      await prisma.skiResort.count(),
      await prisma.article.count(),
      await prisma.dynamic.count(),
      await prisma.asset.count(),
    ])
      assert.equal(count, 0);
    const admin = await prisma.user.findFirstOrThrow();
    const now = new Date('2026-11-03T00:00:00Z');
    const result = await prisma.$transaction(async (tx): Promise<Fixture> => {
      const assets = [];
      for (let i = 0; i < 3; i++)
        assets.push(
          await tx.asset.create({
            data: {
              OwnerUserId: admin.UserId,
              StorageKey: `public-http/image-${i}.webp`,
              OriginalName: `image-${i}.webp`,
              MimeType: 'image/webp',
              SizeBytes: 100,
              Sha256: String(i).repeat(64),
              Status: 'ready',
            },
          }),
        );
      await tx.dictionaryType.upsert({
        where: { DictType: 'knowledge.article_category' },
        create: {
          DictType: 'knowledge.article_category',
          DictName: '知识分类',
          GroupKey: 'knowledge',
          PubliclyReadable: true,
        },
        update: { Status: 'active', PubliclyReadable: true },
      });
      for (const [value, status] of [
        ['public-http', 'active'],
        ['public-http-disabled', 'disabled'],
      ] as const)
        await tx.dictionaryItem.create({
          data: {
            DictType: 'knowledge.article_category',
            Value: value,
            Label: value,
            Status: status,
          },
        });
      await tx.customFieldGroup.create({
        data: {
          EntityType: 'ski_resort',
          GroupKey: 'public_http',
          Label: '公开联调',
        },
      });
      for (const [FieldKey, DataType, IsPublic] of [
        ['public_zero', 'integer', true],
        ['public_false', 'boolean', true],
        ['internal_note', 'text', false],
      ] as const)
        await tx.customFieldDefinition.create({
          data: {
            EntityType: 'ski_resort',
            GroupKey: 'public_http',
            FieldKey,
            DataType,
            IsPublic,
            Label: FieldKey,
            Status: 'active',
          },
        });
      const merchant = await tx.merchantProfile.create({
        data: {
          UserId: admin.UserId,
          BusinessName: 'Synthetic merchant',
          Contact: 'private-contact-marker',
        },
      });
      const resortIds: number[] = [];
      for (const [index, Status] of [
        'published',
        'pending_review',
        'offline',
        'published',
      ].entries()) {
        const row = await tx.skiResort.create({
          data: {
            Name: '公开联调雪场 ' + index,
            MerchantId: merchant.MerchantId,
            Price: 0,
            LegacyDistance: 0,
            SnowCondition: 'powder',
            Description: '公开雪场正文 <script>文本</script>',
            Status,
            DeletedAt: index === 3 ? now : null,
            Province: '测试省',
            City: '测试市',
            District: null,
            Latitude: 0,
            Longitude: 0,
            Rating: 0,
            RatingCount: 0,
            CoverAssetId: assets[0]!.AssetId,
            CustomFields: {
              public_zero: 0,
              public_false: false,
              internal_note: 'private-field-marker',
            },
            OfficialUrl: 'https://example.com/snow',
          },
        });
        resortIds.push(row.ResortId);
      }
      await tx.resortImage.createMany({
        data: assets.slice(1).map((asset, SortOrder) => ({
          ResortId: resortIds[0]!,
          AssetId: asset.AssetId,
          SortOrder,
        })),
      });
      const articleIds: number[] = [];
      for (const [index, Status] of [
        'published',
        'draft',
        'withdrawn',
        'published',
        'published',
      ].entries()) {
        const row = await tx.article.create({
          data: {
            Title: '公开联调知识 ' + index,
            Summary: '滑雪知识摘要',
            Body: '滑雪知识完整正文 <b>保持文本</b>',
            Status,
            DeletedAt: index === 3 ? now : null,
            CategoryValue: index === 4 ? 'public-http-disabled' : 'public-http',
            PublishTime: index === 1 ? null : now,
            AuthorId: admin.UserId,
            AuthorName: null,
            CoverAssetId: assets[0]!.AssetId,
            CustomFields: { internal: 'private-article-marker' },
          },
        });
        articleIds.push(row.ArticleId);
      }
      const dynamicIds: number[] = [];
      for (const [index, Status] of [
        'published',
        'pending',
        'hidden',
        'published',
      ].entries()) {
        const row = await tx.dynamic.create({
          data: {
            AuthorId: admin.UserId,
            Content: '公开联调动态完整正文 ' + index,
            Status,
            DeletedAt: index === 3 ? now : null,
            ResortId: resortIds[0],
            CustomFields: { internal: 'private-dynamic-marker' },
          },
        });
        dynamicIds.push(row.DynamicId);
      }
      await tx.dynamicImage.createMany({
        data: assets.slice(0, 2).map((asset, SortOrder) => ({
          DynamicId: dynamicIds[0]!,
          AssetId: asset.AssetId,
          SortOrder,
        })),
      });
      const commentIds: number[] = [];
      for (let i = 0; i < 23; i++) {
        const row = await tx.comment.create({
          data: {
            DynamicId: dynamicIds[0]!,
            AuthorId: admin.UserId,
            Content: i < 21 ? `公开评论 ${i}` : 'private-comment-marker',
            Status: i === 21 ? 'hidden' : 'visible',
            DeletedAt: i === 22 ? now : null,
            CreateTime: now,
          },
        });
        if (i < 21) commentIds.push(row.CommentId);
      }
      return {
        databaseName: 'linji_public_content_validation',
        resortIds,
        articleIds,
        dynamicIds,
        commentIds,
      };
    });
    await writeFile(path, JSON.stringify(result, null, 2), { flag: 'wx' });
    console.info(
      'Prepared public/hidden/deleted content, ready image metadata and 21 visible comments',
    );
  } else if (process.argv[2] === 'verify') {
    const fixture = JSON.parse(await readFile(path, 'utf8')) as Fixture;
    assert.equal(fixture.databaseName, 'linji_public_content_validation');
    assert.equal(await prisma.skiResort.count(), 4);
    assert.equal(await prisma.article.count(), 5);
    assert.equal(await prisma.dynamic.count(), 4);
    assert.equal(await prisma.comment.count(), 23);
    assert.equal(await prisma.asset.count(), 3);
    const reader = await prisma.user.findUniqueOrThrow({
      where: { Account: 'public-http-reader' },
    });
    assert.equal(await prisma.user.count(), 2);
    assert.deepEqual(
      (
        await prisma.favorite.findMany({
          where: { UserId: reader.UserId },
          orderBy: { FavoriteId: 'asc' },
        })
      ).map((r) => [r.ResortId, r.ArticleId]),
      [
        [fixture.resortIds[0], null],
        [null, fixture.articleIds[0]],
      ],
    );
    assert.equal(
      await prisma.authSession.count({
        where: { UserId: reader.UserId, RevokedAt: null },
      }),
      0,
    );
    assert.equal(await prisma.outboxEvent.count(), 0);
    console.info(
      'Verified unchanged source counts, exactly two owned favorites, no active reader session and no Outbox writes',
    );
  } else throw new Error('Use prepare or verify');
} finally {
  await prisma.$disconnect();
}
