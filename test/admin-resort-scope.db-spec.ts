import { PrismaAdminResortRepository } from '../src/modules/resort-management/infrastructure/prisma-admin-resort.repository.js';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/shared/persistence/prisma.service.js';
import { AdminResortService } from '../src/modules/resort-management/application/admin-resort-service.js';
import { PrismaOutboxStore } from '../src/modules/integration-events/infrastructure/prisma-outbox.store.js';
import type { ResolvedDataScope } from '../src/modules/identity-access/domain/authorization.js';
import type { AssetStorage } from '../src/modules/assets/application/ports/asset-storage.js';

describe('Global resort scope (dedicated migrated PostgreSQL)', () => {
  const prisma = new PrismaService();
  const storage: AssetStorage = {
    put: async () => {
      throw new Error('No assets belong in this fixture');
    },
    remove: async () => {
      throw new Error('No assets belong in this fixture');
    },
    createReadUrl: async () => {
      throw new Error('No assets belong in this fixture');
    },
  };
  const service = new AdminResortService(
    new PrismaAdminResortRepository(prisma, new PrismaOutboxStore(prisma)),
    storage,
  );
  const suffix = randomUUID();
  const resortIds: number[] = [];
  let actorUserId: number;
  let actorCreated = false;
  let roleId: number | undefined;
  let resortId: number;
  const body = {
    name: `Scope DB ${suffix}`,
    price: 100,
    openStatus: 'open',
    snowCondition: 'powder',
    description: 'Isolated scope test',
  };
  const audit = () => ({
    actorUserId,
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
    const actor = await prisma.user.create({
      data: {
        Account: `rtest-${suffix}`,
        PasswordHash: 'test-disabled',
        Nickname: 'Scope test',
      },
    });
    actorUserId = actor.UserId;
    actorCreated = true;
    const permissions = await prisma.permission.findMany({
      where: {
        PermissionKey: {
          in: [
            'management:portal:enter',
            'content:resort:create-all',
            'content:resort:update-all',
            'content:resort:delete-all',
            'content:resort:publish',
            'content:resort:offline',
          ],
        },
      },
    });
    expect(permissions).toHaveLength(6);
    const role = await prisma.role.create({
      data: {
        RoleKey: `rscope-${suffix}`,
        RoleName: 'Isolated global scope fixture',
        DataScope: 'all',
        RolePermissions: {
          create: permissions.map(({ PermissionId }) => ({ PermissionId })),
        },
      },
    });
    roleId = role.RoleId;
    await prisma.userRole.create({
      data: { UserId: actorUserId, RoleId: roleId },
    });
    const resort = await prisma.skiResort.create({
      data: {
        Name: body.name,
        Price: 100,
        SnowCondition: 'powder',
        Description: body.description,
        LegacyDistance: 0,
      },
    });
    resortId = resort.ResortId;
    resortIds.push(resortId);
  });
  afterAll(async () => {
    try {
      if (actorCreated)
        await prisma.operationLog.deleteMany({
          where: { ActorUserId: actorUserId },
        });
      if (resortIds.length) {
        await prisma.outboxEvent.deleteMany({
          where: {
            AggregateType: 'ski_resort',
            AggregateId: { in: resortIds.map(String) },
          },
        });
        await prisma.skiResort.deleteMany({
          where: { ResortId: { in: resortIds } },
        });
      }
      if (actorCreated)
        await prisma.user.delete({ where: { UserId: actorUserId } });
      if (roleId) await prisma.role.delete({ where: { RoleId: roleId } });
    } finally {
      await prisma.$disconnect();
    }
  });

  it('rejects all seven operations for a selected ID, merchant, self or missing scope without side effects', async () => {
    const deniedAudit = audit();
    const scopes: (ResolvedDataScope | undefined)[] = [
      undefined,
      { kind: 'self', userId: actorUserId },
      { kind: 'merchant', merchantId: 1 },
      { kind: 'selected', ids: [resortId] },
    ];
    for (const scope of scopes) {
      const operations = [
        () => service.list({ keyword: suffix }, scope, actorUserId),
        () => service.get(resortId, scope, actorUserId),
        () => service.create(body, deniedAudit, scope),
        () => service.update(resortId, { name: 'Denied' }, deniedAudit, scope),
        () => service.remove(resortId, deniedAudit, scope),
        () => service.publish(resortId, deniedAudit, scope),
        () => service.offline(resortId, deniedAudit, scope),
      ];
      for (const operation of operations)
        await expect(operation()).rejects.toMatchObject({ status: 403 });
    }
    expect(
      await prisma.skiResort.count({ where: { Name: { contains: suffix } } }),
    ).toBe(1);
    expect(
      await prisma.skiResort.findUniqueOrThrow({
        where: { ResortId: resortId },
      }),
    ).toMatchObject({ Name: body.name, Status: 'draft', DeletedAt: null });
    expect(
      await prisma.operationLog.count({
        where: { TraceId: deniedAudit.traceId },
      }),
    ).toBe(0);
    expect(
      await prisma.outboxEvent.count({
        where: { AggregateType: 'ski_resort', AggregateId: String(resortId) },
      }),
    ).toBe(0);
  });

  it('rolls back business changes and outbox when transaction audit fails', async () => {
    await expect(
      service.update(
        resortId,
        { price: 999 },
        { ...audit(), traceId: 'x'.repeat(101) },
        { kind: 'all' },
      ),
    ).rejects.toMatchObject({ code: 'P2000' });
    expect(
      await prisma.skiResort.findUniqueOrThrow({
        where: { ResortId: resortId },
      }),
    ).toMatchObject({ Price: 100, Status: 'draft' });
    expect(
      await prisma.outboxEvent.count({
        where: { AggregateType: 'ski_resort', AggregateId: String(resortId) },
      }),
    ).toBe(0);
  });

  it('executes the global lifecycle and persists five outbox events with matching operation audits', async () => {
    const scope = { kind: 'all' } as const;
    const created = await service.create(
      { ...body, name: `Created ${suffix}` },
      audit(),
      scope,
    );
    resortIds.push(created.resortId);
    expect(
      await service.list({ keyword: suffix }, scope, actorUserId),
    ).toMatchObject({ total: 2 });
    expect(
      await service.get(created.resortId, scope, actorUserId),
    ).toMatchObject({ status: 'draft' });
    await service.update(created.resortId, { price: 200 }, audit(), scope);
    await service.publish(created.resortId, audit(), scope);
    await service.offline(created.resortId, audit(), scope);
    await service.remove(created.resortId, audit(), scope);
    expect(
      await prisma.outboxEvent.count({
        where: {
          AggregateType: 'ski_resort',
          AggregateId: String(created.resortId),
        },
      }),
    ).toBe(5);
    expect(
      await prisma.operationLog.count({
        where: {
          ActorUserId: actorUserId,
          ResourceKey: 'resort',
          TargetId: String(created.resortId),
        },
      }),
    ).toBe(5);
    await expect(
      service.get(created.resortId, scope, actorUserId),
    ).rejects.toMatchObject({ status: 404 });
  });
});
