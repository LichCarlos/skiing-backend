import { PrismaRevenueRepository } from '../src/modules/resort-management/infrastructure/prisma-revenue.repository.js';
import { PrismaMerchantResortRepository } from '../src/modules/resort-management/infrastructure/prisma-merchant-resort.repository.js';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/shared/persistence/prisma.service.js';
import { MerchantResortService } from '../src/modules/resort-management/application/merchant-resort-service.js';
import { RevenueService } from '../src/modules/resort-management/application/revenue-service.js';
import { PrismaCustomFieldRepository } from '../src/modules/platform-administration/infrastructure/prisma-custom-field.repository.js';
import { PrismaOutboxStore } from '../src/modules/integration-events/infrastructure/prisma-outbox.store.js';
import type { MerchantResortAccess } from '../src/modules/resort-management/domain/resort-management-scope.js';
import type { AssetStorage } from '../src/modules/assets/application/ports/asset-storage.js';

describe('Merchant resort scope and audit (dedicated migrated PostgreSQL)', () => {
  const prisma = new PrismaService();
  const storage: AssetStorage = {
    put: async () => {
      throw new Error('This fixture must not access storage');
    },
    remove: async () => {
      throw new Error('This fixture must not access storage');
    },
    createReadUrl: async () => {
      throw new Error('This fixture must not access storage');
    },
  };
  const service = new MerchantResortService(
    new PrismaMerchantResortRepository(prisma, new PrismaOutboxStore(prisma)),
    storage,
    new PrismaCustomFieldRepository(prisma),
  );
  const revenue = new RevenueService(new PrismaRevenueRepository(prisma));
  const suffix = randomUUID();
  const userIds: number[] = [];
  const merchantIds: number[] = [];
  const resortIds: number[] = [];
  let access: MerchantResortAccess;
  let roleId: number;
  let selectedId: number;
  let unselectedId: number;
  let foreignId: number;
  const body = {
    name: `Merchant ${suffix}`,
    price: 100,
    openStatus: 'open',
    snowCondition: 'powder',
    description: 'Isolated merchant test',
  };
  const audit = () => ({
    traceId: randomUUID(),
    clientIp: null,
    userAgent: null,
  });

  beforeAll(async () => {
    if (!process.env.DATABASE_URL)
      throw new Error(
        'DATABASE_URL must explicitly identify a migrated test database',
      );
    await prisma.$connect();
    const permissions = await prisma.permission.findMany({
      where: {
        PermissionKey: {
          in: [
            'management:portal:enter',
            'resort:merchant:create',
            'resort:merchant:update',
            'resort:merchant:delete',
            'resort:merchant:submit-review',
          ],
        },
      },
    });
    roleId = (
      await prisma.role.create({
        data: {
          RoleKey: `merchant-test-${suffix}`,
          RoleName: 'Isolated merchant fixture',
          DataScope: 'merchant',
          RolePermissions: {
            create: permissions.map(({ PermissionId }) => ({ PermissionId })),
          },
        },
      })
    ).RoleId;
    for (const index of [0, 1]) {
      const user = await prisma.user.create({
        data: {
          Account: `m${index}-${suffix}`,
          PasswordHash: 'test-disabled',
          Nickname: 'Merchant test',
          UserRoles: { create: { RoleId: roleId } },
        },
      });
      userIds.push(user.UserId);
      const merchant = await prisma.merchantProfile.create({
        data: {
          UserId: user.UserId,
          BusinessName: `Merchant ${index}`,
        },
      });
      merchantIds.push(merchant.MerchantId);
    }
    for (const index of [0, 0, 1]) {
      const resort = await prisma.skiResort.create({
        data: {
          Name: body.name,
          MerchantId: merchantIds[index],
          Price: 100,
          SnowCondition: 'powder',
          Description: body.description,
          LegacyDistance: 0,
        },
      });
      resortIds.push(resort.ResortId);
    }
    [selectedId, unselectedId, foreignId] = resortIds;
    access = {
      userId: userIds[0]!,
      merchantId: merchantIds[0]!,
      scope: { kind: 'merchant', merchantId: merchantIds[0]! },
    };
    for (const [index, id] of resortIds.entries())
      await prisma.resortRevenueRecord.create({
        data: {
          ResortId: id,
          ReportDate: new Date('2026-10-01T00:00:00Z'),
          RevenueAmount: [10, 20, 900][index],
          Source: 'manual',
          CreatedBy: access.userId,
        },
      });
  });

  beforeEach(async () => {
    await prisma.roleDataScope.deleteMany({ where: { RoleId: roleId } });
  });

  afterAll(async () => {
    try {
      if (userIds.length)
        await prisma.operationLog.deleteMany({
          where: { ActorUserId: { in: userIds } },
        });
      if (resortIds.length) {
        await prisma.outboxEvent.deleteMany({
          where: {
            AggregateType: 'ski_resort',
            AggregateId: { in: resortIds.map(String) },
          },
        });
        await prisma.resortRevenueRecord.deleteMany({
          where: { ResortId: { in: resortIds } },
        });
        await prisma.skiResort.deleteMany({
          where: { ResortId: { in: resortIds } },
        });
      }
      if (merchantIds.length)
        await prisma.merchantProfile.deleteMany({
          where: { MerchantId: { in: merchantIds } },
        });
      if (userIds.length)
        await prisma.user.deleteMany({ where: { UserId: { in: userIds } } });
      if (roleId) await prisma.role.delete({ where: { RoleId: roleId } });
    } finally {
      await prisma.$disconnect();
    }
  });

  it('intersects selected IDs before paging/count and applies the same restriction to revenue', async () => {
    const selected: MerchantResortAccess = {
      ...access,
      scope: { kind: 'selected', ids: [selectedId, foreignId] },
    };
    await prisma.roleDataScope.create({
      data: {
        RoleId: roleId,
        ResourceKey: 'resort',
        ScopeType: 'selected',
        ScopeConfig: { selectedIds: [selectedId, foreignId] },
      },
    });
    const first = await service.list({ ...selected, pageSize: 1 });
    expect(first).toMatchObject({
      total: 1,
      items: [{ resortId: selectedId }],
    });
    expect(
      await service.list({ ...selected, pageSize: 1, page: 2 }),
    ).toMatchObject({ total: 1, items: [] });
    for (const id of [unselectedId, foreignId]) {
      await expect(
        service.get({ ...selected, resortId: id }),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        service.update(
          { ...selected, resortId: id, body: { price: 500 } },
          audit(),
        ),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        service.remove({ ...selected, resortId: id }, audit()),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        service.submitReview({ ...selected, resortId: id }, audit()),
      ).rejects.toMatchObject({ status: 404 });
    }
    await expect(
      service.create({ ...selected, body }, audit()),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      await revenue.merchantList(selected, { page: 1, pageSize: 20 }),
    ).toMatchObject({
      total: 1,
      items: [{ resortId: selectedId, revenueAmount: '10.00' }],
    });
    expect(
      await revenue.merchantSummary(selected, {
        page: 1,
        pageSize: 20,
        fromDate: '2026-10-01',
        toDate: '2026-10-01',
      }),
    ).toMatchObject({ totalAmount: '10.00', daily: [{ amount: '10.00' }] });
    await expect(
      revenue.merchantSummary(selected, {
        resortId: foreignId,
        page: 1,
        pageSize: 20,
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(
      await prisma.outboxEvent.count({
        where: {
          AggregateType: 'ski_resort',
          AggregateId: { in: resortIds.map(String) },
        },
      }),
    ).toBe(0);
  });

  it('limits self and all to the current account and requires an active profile', async () => {
    for (const scope of [
      { kind: 'all' } as const,
      { kind: 'self', userId: access.userId } as const,
    ]) {
      expect(await service.list({ ...access, scope })).toMatchObject({
        total: 2,
      });
      await expect(
        service.get({ ...access, scope, resortId: foreignId }),
      ).rejects.toMatchObject({ status: 404 });
    }
    const forged: MerchantResortAccess = {
      ...access,
      merchantId: merchantIds[1]!,
      scope: { kind: 'all' },
    };
    expect(await service.list(forged)).toMatchObject({ total: 0 });
    await expect(
      service.create({ ...forged, body }, audit()),
    ).rejects.toMatchObject({ status: 403 });
    await prisma.merchantProfile.update({
      where: { MerchantId: access.merchantId! },
      data: { Status: 'disabled' },
    });
    try {
      expect(await service.list(access)).toMatchObject({ total: 0 });
      await expect(service.customFieldSchema(access)).rejects.toMatchObject({
        status: 403,
      });
      await expect(
        service.create({ ...access, body }, audit()),
      ).rejects.toMatchObject({ status: 403 });
    } finally {
      await prisma.merchantProfile.update({
        where: { MerchantId: access.merchantId! },
        data: { Status: 'active' },
      });
    }
  });

  it('persists four lifecycle events and matching actor audits', async () => {
    const created = await service.create(
      { ...access, body: { ...body, name: `Lifecycle ${suffix}` } },
      audit(),
    );
    resortIds.push(created.resortId);
    const input = { ...access, resortId: created.resortId };
    await service.update({ ...input, body: { price: 200 } }, audit());
    await service.submitReview(input, audit());
    await service.remove(input, audit());
    expect(
      await prisma.outboxEvent.count({
        where: {
          AggregateType: 'ski_resort',
          AggregateId: String(created.resortId),
        },
      }),
    ).toBe(4);
    expect(
      await prisma.operationLog.count({
        where: {
          ActorUserId: access.userId,
          ResourceKey: 'resort',
          TargetId: String(created.resortId),
        },
      }),
    ).toBe(4);
    await expect(service.get(input)).rejects.toMatchObject({ status: 404 });
  });

  it('rolls back resort and outbox when the audit insert fails', async () => {
    const name = `Rollback ${suffix}`;
    const before = await prisma.outboxEvent.count({
      where: {
        AggregateType: 'ski_resort',
        AggregateId: { in: resortIds.map(String) },
      },
    });
    // TraceId exceeds the physical varchar(100), forcing a genuine database failure after the event insert.
    await expect(
      service.update(
        { ...access, resortId: selectedId, body: { name } },
        { ...audit(), traceId: 'x'.repeat(101) },
      ),
    ).rejects.toThrow();
    expect(
      await prisma.skiResort.findUniqueOrThrow({
        where: { ResortId: selectedId },
      }),
    ).toMatchObject({ Name: body.name });
    expect(
      await prisma.outboxEvent.count({
        where: {
          AggregateType: 'ski_resort',
          AggregateId: { in: resortIds.map(String) },
        },
      }),
    ).toBe(before);
    expect(
      await prisma.operationLog.count({
        where: { ActorUserId: access.userId, TraceId: 'x'.repeat(101) },
      }),
    ).toBe(0);
  });
});
