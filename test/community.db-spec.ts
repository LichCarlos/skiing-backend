import { randomUUID } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../src/shared/persistence/prisma.service.js';
import { PrismaCommunityUnitOfWork } from '../src/modules/community/infrastructure/prisma-community-unit-of-work.js';
import { CommunityWrites } from '../src/modules/community/application/community-writes.js';
import { AdminCommunityService } from '../src/modules/community/application/admin-community-service.js';
import { PrismaAdminCommunityReader } from '../src/modules/community/infrastructure/prisma-admin-community.reader.js';
import { PrismaOwnDynamicsReader } from '../src/modules/community/infrastructure/prisma-own-dynamics.reader.js';

describe('Community PostgreSQL transactions (dedicated migrated test database)', () => {
  const prisma = new PrismaService();
  const uow = new PrismaCommunityUnitOfWork(prisma);
  const writes = new CommunityWrites(uow);
  const users: number[] = [];
  let roleId: number;
  const dynamics: number[] = [];
  const assets: bigint[] = [];
  const resorts: number[] = [];
  let authorId: number;
  let otherId: number;
  beforeAll(async () => {
    if (!process.env.DATABASE_URL)
      throw new Error(
        'DATABASE_URL must explicitly identify a migrated test database',
      );
    await prisma.$connect();
    const keys = [
      'community:dynamic:create',
      'community:dynamic:update-own',
      'community:comment:create',
      'community:like:toggle',
      'content:dynamic:moderate',
      'management:portal:enter',
    ];
    const permissions = await prisma.permission.findMany({
      where: { PermissionKey: { in: keys } },
    });
    expect(permissions).toHaveLength(keys.length);
    const role = await prisma.role.create({
      data: {
        RoleKey: `community-db-${randomUUID()}`,
        RoleName: 'Community DB validation',
        DataScope: 'self',
        RolePermissions: {
          create: permissions.map((p) => ({ PermissionId: p.PermissionId })),
        },
      },
    });
    roleId = role.RoleId;
    for (let i = 0; i < 2; i++) {
      const user = await prisma.user.create({
        data: {
          Account: `community-${randomUUID()}`,
          Nickname: 'Isolated DB test',
          PasswordHash: 'test-login-disabled',
          Status: 'active',
          UserRoles: { create: { RoleId: roleId } },
        },
      });
      users.push(user.UserId);
    }
    [authorId, otherId] = [users[0]!, users[1]!];
  });
  afterAll(async () => {
    try {
      if (dynamics.length) {
        await prisma.operationLog.deleteMany({
          where: { ActorUserId: { in: users }, ResourceKey: 'community' },
        });
        await prisma.outboxEvent.deleteMany({
          where: {
            AggregateType: 'Dynamic',
            AggregateId: { in: dynamics.map(String) },
          },
        });
        await prisma.dynamic.deleteMany({
          where: { DynamicId: { in: dynamics }, AuthorId: { in: users } },
        });
      }
      if (assets.length)
        await prisma.asset.deleteMany({
          where: { AssetId: { in: assets }, OwnerUserId: { in: users } },
        });
      if (resorts.length)
        await prisma.skiResort.deleteMany({
          where: { ResortId: { in: resorts } },
        });
      if (users.length)
        await prisma.user.deleteMany({ where: { UserId: { in: users } } });
      if (roleId) await prisma.role.delete({ where: { RoleId: roleId } });
    } finally {
      await prisma.$disconnect();
    }
  });
  async function createTrackedDynamic() {
    const result = await writes.createDynamic(authorId, {
      content: 'DB transaction test',
      imageAssetIds: [],
    });
    dynamics.push(result.dynamicId);
    return result.dynamicId;
  }
  it('preserves image order, ownership and the create/update outbox in actual database transactions', async () => {
    for (let i = 0; i < 2; i++) {
      const asset = await prisma.asset.create({
        data: {
          OwnerUserId: authorId,
          StorageKey: `db-test/${randomUUID()}`,
          OriginalName: 'test.png',
          MimeType: 'image/png',
          SizeBytes: 100n,
          Sha256: '0'.repeat(64),
          Status: 'ready',
        },
      });
      assets.push(asset.AssetId);
    }
    const orderedIds = [assets[1]!, assets[0]!].map(String);
    const created = await writes.createDynamic(authorId, {
      content: ' ordered ',
      imageAssetIds: orderedIds,
    });
    dynamics.push(created.dynamicId);
    const stored = await prisma.dynamic.findUniqueOrThrow({
      where: { DynamicId: created.dynamicId },
      include: { Images: { orderBy: { SortOrder: 'asc' } } },
    });
    expect(stored.Images.map((image) => image.AssetId.toString())).toEqual(
      orderedIds,
    );
    expect(stored.Content).toBe('ordered');
    await expect(
      writes.updateDynamic(otherId, created.dynamicId, {
        content: 'forbidden',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(
      await prisma.outboxEvent.count({
        where: {
          AggregateType: 'Dynamic',
          AggregateId: String(created.dynamicId),
        },
      }),
    ).toBe(1);
    await prisma.dynamic.update({
      where: { DynamicId: created.dynamicId },
      data: { Status: 'published' },
    });
    await writes.updateDynamic(authorId, created.dynamicId, {
      content: 'edited',
    });
    expect(
      await prisma.dynamic.findUniqueOrThrow({
        where: { DynamicId: created.dynamicId },
      }),
    ).toMatchObject({ Status: 'pending', Content: 'edited' });
    expect(
      await prisma.outboxEvent.count({
        where: {
          AggregateType: 'Dynamic',
          AggregateId: String(created.dynamicId),
        },
      }),
    ).toBe(2);
  });
  it('round-trips owner image IDs, preserves omitted bindings, detaches null and replaces image order without deleting assets', async () => {
    const imageIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const asset = await prisma.asset.create({
        data: {
          OwnerUserId: authorId,
          StorageKey: `db-test/${randomUUID()}`,
          OriginalName: 'edit.png',
          MimeType: 'image/png',
          SizeBytes: 100n,
          Sha256: '0'.repeat(64),
          Status: 'ready',
        },
      });
      assets.push(asset.AssetId);
      imageIds.push(String(asset.AssetId));
    }
    const resort = await prisma.skiResort.create({
      data: {
        Name: 'D-37 test resort',
        LegacyDistance: 0,
        Price: 100,
        SnowCondition: 'powder',
        Description: 'test',
        Status: 'published',
      },
    });
    resorts.push(resort.ResortId);
    const created = await writes.createDynamic(authorId, {
      content: 'before',
      imageAssetIds: imageIds.slice(0, 2),
      resortId: resort.ResortId,
    });
    dynamics.push(created.dynamicId);
    await writes.updateDynamic(authorId, created.dynamicId, {
      content: 'keep references',
    });
    const reader = new PrismaOwnDynamicsReader(prisma, {
      put: async () => undefined,
      remove: async () => undefined,
      createReadUrl: async (key) => `https://assets.test/${key}`,
    });
    const unchanged = await reader.find(authorId, created.dynamicId);
    expect(unchanged?.resort?.resortId).toBe(resort.ResortId);
    expect(unchanged?.images.map((image) => image.assetId)).toEqual(
      imageIds.slice(0, 2),
    );
    expect(await reader.find(otherId, created.dynamicId)).toBeNull();
    const replacement = [imageIds[1]!, imageIds[2]!, imageIds[0]!];
    await writes.updateDynamic(authorId, created.dynamicId, {
      resortId: null,
      imageAssetIds: replacement,
    });
    const edited = await reader.find(authorId, created.dynamicId);
    expect(edited?.resort).toBeNull();
    expect(edited?.images.map((image) => image.assetId)).toEqual(replacement);
    expect(edited?.imageUrls).toEqual(edited?.images.map((image) => image.url));
    await writes.updateDynamic(authorId, created.dynamicId, {
      resortId: resort.ResortId,
      imageAssetIds: [],
    });
    const cleared = await reader.find(authorId, created.dynamicId);
    expect(cleared?.resort?.resortId).toBe(resort.ResortId);
    expect(cleared?.images).toEqual([]);
    expect(
      await prisma.asset.count({
        where: { AssetId: { in: imageIds.map(BigInt) } },
      }),
    ).toBe(3);
    await prisma.skiResort.update({
      where: { ResortId: resort.ResortId },
      data: { Status: 'pending_review' },
    });
    await expect(
      writes.updateDynamic(authorId, created.dynamicId, {
        resortId: resort.ResortId,
      }),
    ).rejects.toThrow('Resort not found');
    expect(
      await prisma.outboxEvent.count({
        where: {
          AggregateType: 'Dynamic',
          AggregateId: String(created.dynamicId),
        },
      }),
    ).toBe(4);
  });
  it('rolls back content and outbox when a later transaction step fails', async () => {
    const id = await createTrackedDynamic();
    const before = await prisma.outboxEvent.count({
      where: { AggregateType: 'Dynamic', AggregateId: String(id) },
    });
    await expect(
      uow.run(async (tx) => {
        await tx.updateDynamic(
          id,
          { content: 'must rollback', imageAssetIds: [] },
          'hidden',
        );
        await tx.dynamicChanged(id);
        throw new Error('intentional test abort');
      }),
    ).rejects.toThrow('intentional test abort');
    expect(
      await prisma.dynamic.findUniqueOrThrow({ where: { DynamicId: id } }),
    ).toMatchObject({ Content: 'DB transaction test', Status: 'pending' });
    expect(
      await prisma.outboxEvent.count({
        where: { AggregateType: 'Dynamic', AggregateId: String(id) },
      }),
    ).toBe(before);
  });
  it('commits moderation state, audit and outbox together, and rolls them back if the audit actor is invalid', async () => {
    const id = await createTrackedDynamic();
    const reader = new PrismaAdminCommunityReader(prisma, {
      put: async () => undefined,
      remove: async () => undefined,
      createReadUrl: async () => 'https://unused.test/image',
    });
    const admin = new AdminCommunityService(reader, uow);
    const audit = {
      actorUserId: authorId,
      traceId: randomUUID(),
      clientIp: null,
      userAgent: null,
    };
    await admin.moderateDynamic(
      id,
      { action: 'approve', reason: ' approved ' },
      audit,
    );
    const log = await prisma.operationLog.findFirstOrThrow({
      where: { TraceId: audit.traceId },
    });
    expect(log).toMatchObject({
      ActorUserId: authorId,
      Reason: 'approved',
      ActionKey: 'community.dynamic.approve',
    });
    expect(
      await prisma.dynamic.findUniqueOrThrow({ where: { DynamicId: id } }),
    ).toMatchObject({ Status: 'published', ModeratedByUserId: authorId });
    await expect(
      admin.moderateDynamic(
        id,
        { action: 'hide' },
        { ...audit, actorUserId: 0 },
      ),
    ).rejects.toThrow();
    expect(
      await prisma.dynamic.findUniqueOrThrow({ where: { DynamicId: id } }),
    ).toMatchObject({ Status: 'published' });
    expect(
      await prisma.outboxEvent.count({
        where: { AggregateType: 'Dynamic', AggregateId: String(id) },
      }),
    ).toBe(2);
    expect(
      await prisma.operationLog.count({ where: { TraceId: audit.traceId } }),
    ).toBe(1);
  });
  it('keeps repeated concurrent likes unique and owner soft-delete removes public availability', async () => {
    const id = await createTrackedDynamic();
    await prisma.dynamic.update({
      where: { DynamicId: id },
      data: { Status: 'published' },
    });
    await Promise.all([
      writes.setLiked(otherId, id, true),
      writes.setLiked(otherId, id, true),
    ]);
    expect(
      await prisma.likeRecord.count({
        where: { DynamicId: id, UserId: otherId },
      }),
    ).toBe(1);
    await writes.removeDynamic(authorId, id);
    await expect(
      writes.createComment(otherId, id, { content: 'late comment' }),
    ).rejects.toThrow();
    expect(
      await prisma.dynamic.findUniqueOrThrow({ where: { DynamicId: id } }),
    ).toMatchObject({ DeletedAt: expect.any(Date) });
  });
});
