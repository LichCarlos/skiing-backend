import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { hash } from 'bcryptjs';
import { PrismaService } from '../src/shared/persistence/prisma.service.js';
import { PrismaRevenueImportRepository } from '../src/modules/resort-management/infrastructure/prisma-revenue-import.repository.js';
import { RevenueImportService } from '../src/modules/resort-management/application/revenue-import.service.js';
const url = new URL(process.env.DATABASE_URL ?? ''),
  path = process.env.REVENUE_HTTP_FIXTURE_PATH,
  password = process.env.ADMIN_AUTH_HTTP_PASSWORD;
assert(
  url.hostname === '127.0.0.1' &&
    url.pathname === '/linji_revenue_recovery_validation' &&
    process.env.REVENUE_HTTP_CONFIRM === 'linji_revenue_recovery_validation' &&
    path &&
    password,
  'Explicit disposable revenue HTTP database and password required',
);
const prisma = new PrismaService();
type Fixture = {
  databaseName: string;
  adminAccount: string;
  writerRoleId: number;
  actors: Array<{
    userId: number;
    account: string;
    merchantId: number;
    resortId: number;
  }>;
};
try {
  const current = await prisma.$queryRaw<
    Array<{ name: string }>
  >`SELECT current_database() AS name`;
  assert.equal(current[0]?.name, 'linji_revenue_recovery_validation');
  if (process.argv[2] === 'prepare') {
    assert.equal(await prisma.user.count(), 1);
    assert.equal(await prisma.skiResort.count(), 0);
    const admin = await prisma.user.findFirstOrThrow();
    assert.equal(admin.Account, 'revenue_http_root');
    const keys = [
      'management:portal:enter',
      'account:profile:read',
      'revenue:system:list',
      'revenue:system:upsert',
      'revenue:merchant:list',
    ];
    const permissions = await prisma.permission.findMany({
      where: { PermissionKey: { in: keys } },
    });
    assert.equal(permissions.length, keys.length);
    const role = await prisma.role.create({
      data: {
        RoleKey: 'revenue_http_writer',
        RoleName: '收益联调自定义角色',
        DataScope: 'all',
        RolePermissions: {
          create: permissions.map((p) => ({ PermissionId: p.PermissionId })),
        },
        DataScopes: { create: { ResourceKey: 'resort', ScopeType: 'all' } },
      },
    });
    const actors: Fixture['actors'] = [];
    for (const suffix of ['a', 'b']) {
      const user = await prisma.user.create({
        data: {
          Account: `revenue_http_${suffix}`,
          Nickname: `收益联调${suffix}`,
          PasswordHash: await hash(password, 10),
          MerchantProfile: {
            create: { BusinessName: `合成收益商家${suffix}` },
          },
          UserRoles: { create: { RoleId: role.RoleId } },
        },
        include: { MerchantProfile: true },
      });
      const resort = await prisma.skiResort.create({
        data: {
          MerchantId: user.MerchantProfile!.MerchantId,
          Name: `合成收益雪场${suffix}`,
          LegacyDistance: 0,
          Price: 100,
          SnowCondition: 'powder',
          Description: '收益恢复验证',
          Status: 'draft',
        },
      });
      actors.push({
        userId: user.UserId,
        account: user.Account,
        merchantId: user.MerchantProfile!.MerchantId,
        resortId: resort.ResortId,
      });
    }
    await writeFile(
      path,
      JSON.stringify(
        {
          databaseName: current[0]!.name,
          adminAccount: admin.Account,
          writerRoleId: role.RoleId,
          actors,
        } satisfies Fixture,
        null,
        2,
      ),
      { flag: 'wx' },
    );
    console.info(
      'Prepared isolated two-merchant revenue fixture with configurable grants',
    );
  } else if (process.argv[2] === 'recover') {
    const service = new RevenueImportService(
      new PrismaRevenueImportRepository(prisma),
    );
    await service.recover();
    console.info(
      'Executed one real application recovery pass; no Kafka transport substituted',
    );
  } else if (process.argv[2] === 'verify') {
    const fixture = JSON.parse(await readFile(path, 'utf8')) as Fixture;
    const result = JSON.parse(
      await readFile(join(dirname(path), 'client-result.json'), 'utf8'),
    ) as {
      completed: boolean;
      requestIds: string[];
      importIds: string[];
      checks: Record<string, boolean>;
      rejectedTraceIds: string[];
    };
    assert(result.completed);
    assert(Object.values(result.checks).every((v) => v === true));
    assert.equal(Object.keys(result.checks).length, 10);
    assert.equal(
      result.checks[
        'complete admin revenue projection, date/resort filters and later empty page'
      ],
      true,
    );
    assert.equal(
      result.checks[
        'actual logout during admin revenue read rejects old content and explicit login restores it'
      ],
      true,
    );
    assert.equal(result.requestIds.length, 2);
    assert.equal(result.importIds.length, 2);
    assert.equal(await prisma.revenueWriteRequest.count(), 2);
    assert.equal(await prisma.revenueImportJob.count(), 2);
    assert.equal(await prisma.resortRevenueRecord.count(), 28);
    assert.equal(await prisma.revenueImportRow.count(), 30);
    const manual = await prisma.resortRevenueRecord.findUniqueOrThrow({
      where: {
        ResortId_ReportDate: {
          ResortId: fixture.actors[0]!.resortId,
          ReportDate: new Date('2026-11-01T00:00:00Z'),
        },
      },
    });
    assert.equal(manual.RevenueAmount.toFixed(2), '2.34');
    assert.equal(manual.Source, 'manual');
    assert.equal(manual.Note, 'later');
    const jobs = await prisma.revenueImportJob.findMany({
      orderBy: { CreateTime: 'asc' },
    });
    assert.deepEqual(
      jobs.map((j) => [
        j.Status,
        j.TotalRows,
        j.ProcessedRows,
        j.SucceededRows,
        j.FailedRows,
      ]),
      [
        ['completed', 4, 4, 2, 2],
        ['completed', 26, 26, 25, 1],
      ],
    );
    assert(
      jobs.every(
        (j) =>
          j.LockToken === null &&
          j.LeaseUntil === null &&
          j.ActorUserId === fixture.actors[0]!.userId,
      ),
    );
    assert.equal(
      await prisma.revenueImportRow.count({ where: { Status: 'succeeded' } }),
      27,
    );
    assert.equal(
      await prisma.revenueImportRow.count({ where: { Status: 'failed' } }),
      3,
    );
    assert.equal(
      await prisma.resortRevenueRecord.count({
        where: { ReportDate: new Date('2026-10-26T00:00:00Z') },
      }),
      0,
    );
    assert.equal(
      await prisma.operationLog.count({
        where: { ActionKey: 'revenue:system:upsert' },
      }),
      29,
    );
    assert.equal(
      await prisma.operationLog.count({
        where: { ActionKey: 'revenue:system:import' },
      }),
      2,
    );
    assert.equal(
      await prisma.operationLog.count({
        where: { TraceId: { in: result.rejectedTraceIds } },
      }),
      0,
    );
    const events = await prisma.outboxEvent.findMany();
    assert.equal(events.length, 2);
    for (const event of events) {
      assert.equal(event.EventType, 'revenue.import.requested.v1');
      assert.deepEqual(Object.keys(event.Payload as object), ['jobId']);
      assert(result.importIds.includes(event.AggregateId));
      assert.equal(event.Status, 'pending');
    }
    assert.equal(await prisma.consumedEvent.count(), 0);
    assert.equal(await prisma.ragDocument.count(), 0);
    assert.equal(
      await prisma.authSession.count({ where: { RevokedAt: null } }),
      0,
    );
    console.info(
      'Verified 2 idempotent writes, 2 import jobs/30 rows, 28 revenue records, 29 row-write audits, 2 metadata-only pending Outbox events and revoked sessions',
    );
  } else throw new Error('Expected prepare/recover/verify');
} finally {
  await prisma.$disconnect();
}
