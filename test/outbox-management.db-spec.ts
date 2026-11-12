import { randomUUID } from 'node:crypto';
import { Module, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { IdentityAccessModule } from '../src/modules/identity-access/identity-access.module.js';
import { BcryptPasswordHasher } from '../src/modules/identity-access/infrastructure/bcrypt-password-hasher.js';
import { configureHttp } from '../src/shared/http/configure-http.js';
import { DatabaseModule } from '../src/shared/persistence/database.module.js';
import { PrismaService } from '../src/shared/persistence/prisma.service.js';
import { OutboxEventsController } from '../src/modules/integration-events/presentation/http/outbox-events.controller.js';
import { ManageOutboxEvents } from '../src/modules/integration-events/application/manage-outbox-events.js';
import { OUTBOX_MANAGEMENT_REPOSITORY } from '../src/modules/integration-events/application/ports/outbox-management-repository.js';
import { PrismaOutboxManagementRepository } from '../src/modules/integration-events/infrastructure/prisma-outbox-management.repository.js';
import { PrismaOutboxStore } from '../src/modules/integration-events/infrastructure/prisma-outbox.store.js';
import { PrismaInboxExecutor } from '../src/modules/integration-events/infrastructure/prisma-inbox.executor.js';

@Module({
  imports: [DatabaseModule],
  controllers: [OutboxEventsController],
  providers: [
    ManageOutboxEvents,
    PrismaOutboxManagementRepository,
    {
      provide: OUTBOX_MANAGEMENT_REPOSITORY,
      useExisting: PrismaOutboxManagementRepository,
    },
  ],
})
class EventManagementTestModule {}

describe('D-05 Outbox management HTTP / real PostgreSQL', () => {
  const prefix = `events-${randomUUID().slice(0, 8)}`;
  const users: number[] = [];
  const roles: number[] = [];
  const ids: string[] = [];
  const timestamp = new Date('2026-10-30T00:00:00Z');
  let app: INestApplication<App>;
  let http: App;
  let prisma: PrismaService;
  let admin: { id: number; token: string };
  let member: typeof admin;
  let custom: typeof admin;
  let adminRoleId: number;
  let first: string;
  let second: string;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL)
      throw new Error('Dedicated migrated database required');
    vi.stubEnv(
      'JWT_ACCESS_SECRET',
      'events-validation-secret-at-least-32-characters',
    );
    const module = await Test.createTestingModule({
      imports: [IdentityAccessModule, EventManagementTestModule],
    }).compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.init();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);
    const adminRole = await prisma.role.findUniqueOrThrow({
      where: { SystemRoleCode: 'system_admin' },
    });
    adminRoleId = adminRole.RoleId;
    admin = await account(adminRoleId);
    member = await account(
      (
        await prisma.role.findUniqueOrThrow({
          where: { SystemRoleCode: 'registered_user' },
        })
      ).RoleId,
    );
    const grants = await prisma.permission.findMany({
      where: {
        PermissionKey: {
          in: [
            'management:portal:enter',
            'system:event:list',
            'system:event:retry',
          ],
        },
      },
    });
    expect(grants).toHaveLength(3);
    const role = await prisma.role.create({
      data: {
        RoleKey: prefix,
        RoleName: prefix,
        DataScope: 'all',
        RolePermissions: {
          create: grants.map(({ PermissionId }) => ({ PermissionId })),
        },
      },
    });
    roles.push(role.RoleId);
    custom = await account(role.RoleId);
    first = await event('failed');
    second = await event('failed');
  });
  afterAll(async () => {
    try {
      if (prisma) {
        await prisma.consumedEvent.deleteMany({
          where: { EventId: { in: ids } },
        });
        await prisma.outboxEvent.deleteMany({
          where: { EventId: { in: ids } },
        });
        await prisma.operationLog.deleteMany({
          where: { ActorUserId: { in: users } },
        });
        await prisma.user.deleteMany({ where: { UserId: { in: users } } });
        await prisma.role.deleteMany({ where: { RoleId: { in: roles } } });
      }
    } finally {
      await app?.close();
      vi.unstubAllEnvs();
    }
  });
  async function account(roleId: number) {
    const password = 'events-validation-password';
    const user = await prisma.user.create({
      data: {
        Account: `${prefix}-${users.length}`,
        Nickname: prefix,
        PasswordHash: await new BcryptPasswordHasher().hash(password),
        UserRoles: { create: { RoleId: roleId } },
      },
    });
    users.push(user.UserId);
    const response = await request(http)
      .post('/api/v1/auth/login')
      .send({ account: user.Account, password })
      .expect(200);
    return { id: user.UserId, token: response.body.data.accessToken as string };
  }
  async function event(
    status: string,
    patch: {
      MaxAttempts?: number;
      Attempts?: number;
      CreatedAt?: Date;
      AggregateId?: string;
    } = {},
  ) {
    const row = await prisma.outboxEvent.create({
      data: {
        EventType: `${prefix}.changed`,
        AggregateType: prefix,
        AggregateId: '42',
        Status: status,
        Attempts: 8,
        MaxAttempts: 8,
        Payload: { password: 'payload-sensitive' },
        LastError: 'error-sensitive',
        LockToken: status === 'processing' ? randomUUID() : null,
        LockedAt: status === 'processing' ? timestamp : null,
        PublishedAt: status === 'published' ? timestamp : null,
        AvailableAt: new Date('2099-01-01T00:00:00Z'),
        CreatedAt: timestamp,
        ...patch,
      },
    });
    ids.push(row.EventId);
    return row.EventId;
  }
  function list(query: Record<string, unknown> = {}, token = admin.token) {
    return request(http)
      .get('/api/v1/admin/events')
      .auth(token, { type: 'bearer' })
      .query({ aggregateType: prefix, ...query });
  }
  function retry(
    id: string,
    body: object = { reason: '  operator retry  ' },
    token = admin.token,
  ) {
    return request(http)
      .post(`/api/v1/admin/events/${id}/retry`)
      .auth(token, { type: 'bearer' })
      .send(body);
  }

  it('rejects anonymous, user and custom roles even with every action grant', async () => {
    await request(http).get('/api/v1/admin/events').expect(401);
    for (const actor of [member, custom]) {
      await list({}, actor.token).expect(403);
      await retry(first, { reason: 'test' }, actor.token).expect(403);
    }
  });
  it('checks live grant revocation for old JWTs', async () => {
    for (const PermissionKey of [
      'management:portal:enter',
      'system:event:list',
      'system:event:retry',
    ]) {
      const { PermissionId } = await prisma.permission.findUniqueOrThrow({
        where: { PermissionKey },
      });
      const key = { RoleId: adminRoleId, PermissionId };
      await prisma.rolePermission.delete({
        where: { RoleId_PermissionId: key },
      });
      try {
        if (PermissionKey !== 'system:event:retry') await list().expect(403);
        if (PermissionKey !== 'system:event:list')
          await retry(first).expect(403);
      } finally {
        await prisma.rolePermission.create({ data: key });
      }
    }
  });
  it('applies identical exact filters to count and rows, includes both time bounds and orders UUID ties', async () => {
    const query = {
      status: 'failed',
      eventType: `${prefix}.changed`,
      aggregateId: '42',
      fromTime: timestamp.toISOString(),
      toTime: '2026-10-30T08:00:00+08:00',
      pageSize: 1,
    };
    const sorted = [first, second].sort().reverse();
    const a = await list(query).expect(200);
    expect(a.body.data).toMatchObject({
      total: 2,
      page: 1,
      pageSize: 1,
      hasNext: true,
    });
    expect(a.body.data.items[0].eventId).toBe(sorted[0]);
    const b = await list({ ...query, page: 2 }).expect(200);
    expect(b.body.data).toMatchObject({ total: 2, hasNext: false });
    expect(b.body.data.items[0].eventId).toBe(sorted[1]);
    for (const filter of [
      { eventType: prefix },
      { aggregateId: "' OR 1=1 --" },
      { status: 'published' },
      { fromTime: '2026-10-30T00:00:01Z' },
    ]) {
      expect((await list(filter).expect(200)).body.data).toMatchObject({
        items: [],
        total: 0,
        hasNext: false,
      });
    }
  });
  it('returns only the metadata whitelist', async () => {
    const response = await list().expect(200);
    expect(Object.keys(response.body.data.items[0]).sort()).toEqual(
      [
        'eventId',
        'eventType',
        'aggregateType',
        'aggregateId',
        'status',
        'attempts',
        'maxAttempts',
        'availableAt',
        'lockedAt',
        'occurredAt',
        'publishedAt',
        'createdAt',
      ].sort(),
    );
    for (const hidden of [
      'payload',
      'Payload',
      'LastError',
      'lastError',
      'LockToken',
      'lockToken',
      'sensitive',
    ])
      expect(response.text).not.toContain(hidden);
  });
  it.each([
    { page: 0 },
    { pageSize: 101 },
    { page: Number.MAX_SAFE_INTEGER, pageSize: 100 },
    { status: 'unknown' },
    { fromTime: '2026-02-30T00:00:00Z' },
    { toTime: '2026-10-30T00:00:00' },
    { fromTime: '2026-10-31T00:00:00Z', toTime: '2026-10-30T00:00:00Z' },
    { eventType: 'x'.repeat(201) },
    { aggregateId: 'x'.repeat(101) },
    { payload: 'forged' },
  ])('rejects invalid list query %j', async (query) => {
    await list(query).expect(400);
  });
  it('retains identity, payload and attempts, adds budget, clears lease, schedules now and audits atomically', async () => {
    const id = await event('failed');
    const start = Date.now();
    const response = await retry(id).expect(200);
    expect(response.body.data).toMatchObject({
      eventId: id,
      status: 'pending',
      attempts: 8,
      maxAttempts: 16,
      lockedAt: null,
    });
    const row = await prisma.outboxEvent.findUniqueOrThrow({
      where: { EventId: id },
    });
    expect(row).toMatchObject({
      EventId: id,
      Payload: { password: 'payload-sensitive' },
      Attempts: 8,
      MaxAttempts: 16,
      LockToken: null,
      LockedAt: null,
      LastError: 'error-sensitive',
    });
    expect(row.AvailableAt.getTime()).toBeGreaterThanOrEqual(start);
    expect(row.AvailableAt.getTime()).toBeLessThanOrEqual(Date.now());
    const logs = await prisma.operationLog.findMany({
      where: { TargetId: id },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      ActorUserId: admin.id,
      ActionKey: 'system:event:retry',
      Reason: 'operator retry',
      ResourceKey: 'outbox-event',
    });
    expect(JSON.stringify(logs[0]?.Metadata)).not.toMatch(
      /sensitive|payload|lockToken/i,
    );
    await retry(id).expect(409);
  });
  it.each(['pending', 'processing', 'published'])(
    'rejects retry of %s without changing the record',
    async (status) => {
      const id = await event(status);
      const before = await prisma.outboxEvent.findUniqueOrThrow({
        where: { EventId: id },
      });
      await retry(id).expect(409);
      expect(
        await prisma.outboxEvent.findUnique({ where: { EventId: id } }),
      ).toEqual(before);
    },
  );
  it('returns 404 for missing UUID and 400 for invalid identifiers or reasons', async () => {
    await retry(randomUUID()).expect(404);
    await retry('not-a-uuid').expect(400);
    for (const body of [
      {},
      { reason: null },
      { reason: 1 },
      { reason: '   ' },
      { reason: 'x'.repeat(501) },
      { reason: 'test', status: 'pending' },
    ])
      await retry(first, body).expect(400);
  });
  it('returns 409 on budget overflow without changing attempts or audit', async () => {
    const id = await event('failed', { MaxAttempts: 2147483640 });
    await retry(id).expect(409);
    expect(
      (await prisma.outboxEvent.findUniqueOrThrow({ where: { EventId: id } }))
        .MaxAttempts,
    ).toBe(2147483640);
    expect(await prisma.operationLog.count({ where: { TargetId: id } })).toBe(
      0,
    );
  });
  it('permits only one concurrent retry and creates exactly one audit record', async () => {
    const id = await event('failed');
    let release!: () => void, locked!: () => void;
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holding = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "EventId" FROM "OutboxEvent" WHERE "EventId" = ${id}::uuid FOR UPDATE`;
        locked();
        await gate;
      },
      { timeout: 15000 },
    );
    await ready;
    const requests = Promise.all([
      retry(id).then((value) => value),
      retry(id).then((value) => value),
    ]);
    try {
      const deadline = Date.now() + 8000;
      let waiting = 0;
      while (Date.now() < deadline) {
        const rows = await prisma.$queryRaw<
          { count: number }[]
        >`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%OutboxEvent%'`;
        waiting = rows[0].count;
        if (waiting >= 2) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(waiting).toBeGreaterThanOrEqual(2);
    } finally {
      release();
      await holding;
    }
    const responses = await requests;
    expect(
      responses.map((response) => response.status).sort((a, b) => a - b),
    ).toEqual([200, 409]);
    expect(await prisma.operationLog.count({ where: { TargetId: id } })).toBe(
      1,
    );
    expect(
      (await prisma.outboxEvent.findUniqueOrThrow({ where: { EventId: id } }))
        .MaxAttempts,
    ).toBe(16);
  });
  it('revalidates actor status, technical role and active permissions inside the transaction', async () => {
    const repo = app.get(PrismaOutboxManagementRepository);
    const audit = { actorUserId: admin.id, traceId: prefix };
    const id = await event('failed');
    await prisma.user.update({
      where: { UserId: admin.id },
      data: { Status: 'disabled' },
    });
    try {
      await expect(repo.retry(id, 'test', audit)).rejects.toThrow();
    } finally {
      await prisma.user.update({
        where: { UserId: admin.id },
        data: { Status: 'active' },
      });
    }
    await expect(
      repo.retry(id, 'test', { ...audit, actorUserId: custom.id }),
    ).rejects.toThrow();
    const permission = await prisma.permission.findUniqueOrThrow({
      where: { PermissionKey: 'system:event:retry' },
    });
    await prisma.permission.update({
      where: { PermissionId: permission.PermissionId },
      data: { Status: 'disabled' },
    });
    try {
      await expect(repo.retry(id, 'test', audit)).rejects.toThrow();
    } finally {
      await prisma.permission.update({
        where: { PermissionId: permission.PermissionId },
        data: { Status: 'active' },
      });
    }
    expect(
      (await prisma.outboxEvent.findUniqueOrThrow({ where: { EventId: id } }))
        .Status,
    ).toBe('failed');
  });
  it('rolls back the event when real audit INSERT fails', async () => {
    const id = await event('failed');
    const before = await prisma.outboxEvent.findUniqueOrThrow({
      where: { EventId: id },
    });
    await expect(
      app
        .get(PrismaOutboxManagementRepository)
        .retry(id, 'test', { actorUserId: admin.id, traceId: 'x'.repeat(101) }),
    ).rejects.toThrow();
    expect(
      await prisma.outboxEvent.findUnique({ where: { EventId: id } }),
    ).toEqual(before);
    expect(await prisma.operationLog.count({ where: { TargetId: id } })).toBe(
      0,
    );
  });
  it('locates microsecond-created events using the VO millisecond window without an equality timestamp filter', async () => {
    const aggregateId = `precision-${randomUUID()}`;
    const id = await event('failed', { AggregateId: aggregateId });
    try {
      await prisma.$executeRaw`UPDATE "OutboxEvent"
        SET "CreatedAt" = ${'2026-11-01T00:00:00.123456Z'}::timestamptz
        WHERE "EventId" = ${id}::uuid`;
      const original = await list({ aggregateId }).expect(200);
      const row = original.body.data.items[0];
      expect(row.eventId).toBe(id);
      expect(row.createdAt).toBe('2026-11-01T00:00:00.123Z');
      const exact = await list({
        aggregateId,
        fromTime: row.createdAt,
        toTime: row.createdAt,
      }).expect(200);
      expect(exact.body.data.items).toEqual([]);
      const lookup = await list({
        aggregateId,
        eventType: row.eventType,
        fromTime: row.createdAt,
        toTime: new Date(new Date(row.createdAt).getTime() + 1).toISOString(),
        page: 1,
        pageSize: 100,
      }).expect(200);
      expect(lookup.body.data).toMatchObject({
        items: [row],
        total: 1,
        page: 1,
        hasNext: false,
      });
    } finally {
      await prisma.outboxEvent.deleteMany({ where: { EventId: id } });
    }
  });
  it('feeds the existing delivery store with the same EventId and keeps completed Inbox idempotency', async () => {
    const id = await event('failed', {
      CreatedAt: new Date('2000-01-01T00:00:00Z'),
    });
    const inbox = new PrismaInboxExecutor(prisma);
    const identity = {
      eventId: id,
      eventType: `${prefix}.changed`,
      consumerKey: prefix,
    };
    const claim = await inbox.claim(identity);
    expect(claim).not.toBeNull();
    expect(await inbox.complete(identity, claim!)).toBe(true);
    await retry(id).expect(200);
    const store = new PrismaOutboxStore(prisma);
    const [delivery] = await store.claimBatch(1, 60_000);
    expect(delivery).toMatchObject({
      eventId: id,
      attempts: 9,
      maxAttempts: 16,
      payload: { password: 'payload-sensitive' },
    });
    expect(await store.markPublished(delivery!, new Date())).toBe(true);
    expect(await inbox.claim(identity)).toBeNull();
  });
});
