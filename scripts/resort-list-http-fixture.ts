import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { PrismaService } from '../src/shared/persistence/prisma.service.js';
import { BcryptPasswordHasher } from '../src/modules/identity-access/infrastructure/bcrypt-password-hasher.js';
const url = new URL(process.env.DATABASE_URL ?? '');
if (
  !['localhost', '127.0.0.1'].includes(url.hostname) ||
  url.pathname !== '/linji_resort_list_validation' ||
  process.env.RESORT_LIST_FIXTURE_CONFIRM !== 'linji_resort_list_validation'
)
  throw new Error(
    'Explicitly confirmed disposable resort-list validation database required',
  );
const path =
    process.env.RESORT_LIST_FIXTURE_PATH ??
    'storage/resort-list-http-fixture.json',
  prisma = new PrismaService();
interface Manifest {
  databaseName: string;
  accounts: string[];
  userIds: number[];
  resortIds: number[];
  tagValues: string[];
  itemIds: number[];
  createdTagType: boolean;
}
async function create() {
  try {
    await readFile(path);
    throw new Error('Existing fixture must be cleaned first');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  assert.equal(await prisma.user.count(), 1, 'Fresh seeded database required');
  assert.equal(await prisma.skiResort.count(), 0);
  const password = process.env.RESORT_LIST_FIXTURE_PASSWORD ?? '';
  assert.ok(
    Buffer.byteLength(password) >= 8 && Buffer.byteLength(password) <= 72,
  );
  const hash = await new BcryptPasswordHasher().hash(password);
  const role = await prisma.role.findUniqueOrThrow({
    where: { SystemRoleCode: 'registered_user' },
  });
  const prefix = `resort-list-${randomUUID().slice(0, 8)}`;
  const manifest = await prisma.$transaction(async (tx): Promise<Manifest> => {
    const accounts: string[] = [],
      userIds: number[] = [],
      resortIds: number[] = [],
      itemIds: number[] = [];
    for (const index of [0, 1]) {
      const user = await tx.user.create({
        data: {
          Account: `${prefix}-${index}`,
          Nickname: 'Resort list user',
          PasswordHash: hash,
          UserRoles: { create: { RoleId: role.RoleId } },
        },
      });
      accounts.push(user.Account);
      userIds.push(user.UserId);
    }
    const createdTagType = !(await tx.dictionaryType.findUnique({
      where: { DictType: 'resort.fit_tag' },
    }));
    if (createdTagType)
      await tx.dictionaryType.create({
        data: {
          DictType: 'resort.fit_tag',
          DictName: 'Fit tags',
          GroupKey: 'resort',
          Status: 'active',
        },
      });
    const tagValues = ['a', 'b', 'hidden'].map((key) => `${prefix}-${key}`);
    for (const [index, value] of tagValues.entries()) {
      const item = await tx.dictionaryItem.create({
        data: {
          DictType: 'resort.fit_tag',
          Value: value,
          Label: ['Family', 'Beginner', 'Hidden-only'][index]!,
          SortOrder: index,
        },
      });
      itemIds.push(item.ItemId);
    }
    for (let index = 0; index < 23; index++) {
      const resort = await tx.skiResort.create({
        data: {
          Name: `List ${String(index).padStart(2, '0')}`,
          Price: index === 0 ? 100 : index === 1 ? 200 : 300,
          SnowCondition: 'Synthetic snow',
          Description: 'Synthetic public content',
          LegacyDistance: 0,
          Province: 'Test Province',
          City: 'Test City',
          District: 'Test District',
          Rating: index === 0 ? 4.5 : 3,
          Latitude: 0,
          Longitude: index === 0 ? 0 : 1,
          OpenStatus: 'open',
          Status: index === 22 ? 'pending_review' : 'published',
        },
      });
      resortIds.push(resort.ResortId);
      const selected =
        index === 0 ? [0, 1] : index === 1 ? [0] : index === 22 ? [2] : [1];
      await tx.resortFitTag.createMany({
        data: selected.map((i) => ({
          ResortId: resort.ResortId,
          ItemId: itemIds[i]!,
          DictType: 'resort.fit_tag',
        })),
      });
    }
    return {
      databaseName: 'linji_resort_list_validation',
      accounts,
      userIds,
      resortIds,
      tagValues,
      itemIds,
      createdTagType,
    };
  });
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(manifest, null, 2));
  console.log(
    'Created 2 users, 22 published/1 hidden resorts and 3 tags without persisted credentials',
  );
}
try {
  const action = process.argv[2];
  if (action === 'create') await create();
  else {
    const manifest = JSON.parse(await readFile(path, 'utf8')) as Manifest;
    assert.equal(manifest.databaseName, 'linji_resort_list_validation');
    assert.equal(manifest.userIds.length, 2);
    assert.equal(manifest.resortIds.length, 23);
    if (action === 'verify') {
      for (const [index, userId] of manifest.userIds.entries()) {
        const rows = await prisma.favorite.findMany({
          where: { UserId: userId },
        });
        assert.equal(rows.length, 1);
        assert.equal(rows[0]!.ResortId, manifest.resortIds[index]);
        assert.equal(rows[0]!.ArticleId, null);
      }
      console.log(
        'Exactly one isolated favorite per user persisted on different resorts',
      );
    } else if (action === 'cleanup') {
      await prisma.$transaction(async (tx) => {
        for (const [index, UserId] of manifest.userIds.entries()) {
          const user = await tx.user.findUniqueOrThrow({ where: { UserId } });
          assert.equal(user.Account, manifest.accounts[index]);
        }
        await tx.skiResort.deleteMany({
          where: { ResortId: { in: manifest.resortIds } },
        });
        await tx.dictionaryItem.deleteMany({
          where: {
            ItemId: { in: manifest.itemIds },
            Value: { in: manifest.tagValues },
          },
        });
        if (manifest.createdTagType)
          await tx.dictionaryType.delete({
            where: { DictType: 'resort.fit_tag' },
          });
        await tx.operationLog.deleteMany({
          where: { ActorUserId: { in: manifest.userIds } },
        });
        await tx.user.deleteMany({
          where: { UserId: { in: manifest.userIds } },
        });
      });
      await unlink(path);
      assert.equal(await prisma.user.count(), 1);
      assert.equal(await prisma.skiResort.count(), 0);
      assert.equal(await prisma.favorite.count(), 0);
      assert.equal(await prisma.authSession.count(), 0);
      console.log(
        'Only recorded fixture IDs removed; seed user remains, resorts/favorites/sessions=0',
      );
    } else throw new Error('Use create, verify or cleanup');
  }
} finally {
  await prisma.$disconnect();
}
