import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { IdentityAccessModule } from '../src/modules/identity-access/identity-access.module.js';
import { BcryptPasswordHasher } from '../src/modules/identity-access/infrastructure/bcrypt-password-hasher.js';
import { RevenueService } from '../src/modules/resort-management/application/revenue-service.js';
import { RevenueImportService } from '../src/modules/resort-management/application/revenue-import.service.js';
import { REVENUE_IMPORT_REPOSITORY } from '../src/modules/resort-management/application/ports/revenue-import-repository.js';
import { PrismaRevenueImportRepository } from '../src/modules/resort-management/infrastructure/prisma-revenue-import.repository.js';
import { RevenueImportEventHandler } from '../src/modules/resort-management/application/revenue-import-event-handler.js';
import { PrismaInboxExecutor } from '../src/modules/integration-events/infrastructure/prisma-inbox.executor.js';
import { REVENUE_REPOSITORY } from '../src/modules/resort-management/application/ports/revenue-repository.js';
import { PrismaRevenueRepository } from '../src/modules/resort-management/infrastructure/prisma-revenue.repository.js';
import {
  AdminRevenueController,
  MerchantRevenueController,
} from '../src/modules/resort-management/presentation/http/revenue.controller.js';
import { PrismaService } from '../src/shared/persistence/prisma.service.js';
import { configureHttp } from '../src/shared/http/configure-http.js';

describe('Revenue HTTP, CSV and audit (dedicated real PostgreSQL)', () => {
  const prefix = `rev_${randomUUID().slice(0, 8)}`;
  const userIds: number[] = [],
    merchantIds: number[] = [],
    resortIds: number[] = [],
    writerRoleIds: number[] = [];
  let app: INestApplication<App>, http: App, prisma: PrismaService;
  let service: RevenueService;
  let repository: PrismaRevenueRepository;
  let imports: RevenueImportService,
    importRepository: PrismaRevenueImportRepository;
  let admin: Account,
    secondAdmin: Account,
    merchant: Account,
    foreign: Account,
    member: Account;
  let merchantRoleId: number;
  const header = 'resortId,reportDate,revenueAmount,note';
  const base = '/api/v1';
  interface Account {
    id: number;
    token: string;
  }

  beforeAll(async () => {
    if (!process.env.DATABASE_URL)
      throw new Error('Dedicated migrated DATABASE_URL required');
    vi.stubEnv(
      'JWT_ACCESS_SECRET',
      'revenue-validation-secret-at-least-32-characters',
    );
    const module = await Test.createTestingModule({
      imports: [IdentityAccessModule],
      controllers: [MerchantRevenueController, AdminRevenueController],
      providers: [
        RevenueService,
        RevenueImportService,
        {
          provide: REVENUE_IMPORT_REPOSITORY,
          useClass: PrismaRevenueImportRepository,
        },
        { provide: REVENUE_REPOSITORY, useClass: PrismaRevenueRepository },
      ],
    }).compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.init();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);
    service = app.get(RevenueService);
    repository = app.get(REVENUE_REPOSITORY);
    imports = app.get(RevenueImportService);
    importRepository = app.get(REVENUE_IMPORT_REPOSITORY);
    const adminRole = await prisma.role.findUniqueOrThrow({
      where: { SystemRoleCode: 'system_admin' },
    });
    const userRole = await prisma.role.findUniqueOrThrow({
      where: { SystemRoleCode: 'registered_user' },
    });
    const permissions = await prisma.permission.findMany({
      where: {
        PermissionKey: {
          in: ['management:portal:enter', 'revenue:merchant:list'],
        },
      },
    });
    expect(permissions).toHaveLength(2);
    const role = await prisma.role.create({
      data: {
        RoleKey: prefix,
        RoleName: 'Revenue reader',
        DataScope: 'merchant',
        RolePermissions: {
          create: permissions.map(({ PermissionId }) => ({ PermissionId })),
        },
      },
    });
    merchantRoleId = role.RoleId;
    admin = await account(adminRole.RoleId);
    secondAdmin = await account(adminRole.RoleId);
    merchant = await account(merchantRoleId);
    foreign = await account(merchantRoleId);
    member = await account(userRole.RoleId);
    for (const actor of [merchant, foreign]) {
      const profile = await prisma.merchantProfile.create({
        data: { UserId: actor.id, BusinessName: prefix },
      });
      merchantIds.push(profile.MerchantId);
    }
  });

  afterAll(async () => {
    try {
      if (prisma) {
        const jobs = await prisma.revenueImportJob.findMany({
          where: { ActorUserId: { in: userIds } },
          select: { JobId: true },
        });
        const ids = jobs.map((job) => job.JobId);
        await prisma.consumedEvent.deleteMany({
          where: {
            EventId: {
              in: (
                await prisma.outboxEvent.findMany({
                  where: {
                    AggregateType: 'revenue_import',
                    AggregateId: { in: ids },
                  },
                  select: { EventId: true },
                })
              ).map((event) => event.EventId),
            },
          },
        });
        await prisma.outboxEvent.deleteMany({
          where: { AggregateType: 'revenue_import', AggregateId: { in: ids } },
        });
        await prisma.revenueImportRow.deleteMany({
          where: { JobId: { in: ids } },
        });
        await prisma.revenueImportJob.deleteMany({
          where: { JobId: { in: ids } },
        });
        await prisma.revenueWriteRequest.deleteMany({
          where: { ActorUserId: { in: userIds } },
        });
        await prisma.operationLog.deleteMany({
          where: { ActorUserId: { in: userIds } },
        });
        await prisma.resortRevenueRecord.deleteMany({
          where: { ResortId: { in: resortIds } },
        });
        await prisma.skiResort.deleteMany({
          where: { ResortId: { in: resortIds } },
        });
        await prisma.merchantProfile.deleteMany({
          where: { MerchantId: { in: merchantIds } },
        });
        await prisma.user.deleteMany({ where: { UserId: { in: userIds } } });
        await prisma.role.deleteMany({
          where: { RoleId: { in: writerRoleIds } },
        });
        if (merchantRoleId)
          await prisma.role.delete({ where: { RoleId: merchantRoleId } });
      }
    } finally {
      await app?.close();
      vi.unstubAllEnvs();
    }
  });

  async function account(roleId: number): Promise<Account> {
    const password = 'revenue-validation-password';
    const user = await prisma.user.create({
      data: {
        Account: `${prefix}_${userIds.length}`,
        Nickname: 'Revenue operator',
        PasswordHash: await new BcryptPasswordHasher().hash(password),
        UserRoles: { create: { RoleId: roleId } },
      },
    });
    userIds.push(user.UserId);
    const response = await request(http)
      .post(`${base}/auth/login`)
      .send({ account: user.Account, password })
      .expect(200);
    return { id: user.UserId, token: response.body.data.accessToken as string };
  }
  async function resort(ownerIndex = 0, deleted = false) {
    const record = await prisma.skiResort.create({
      data: {
        MerchantId: merchantIds[ownerIndex],
        Name: `${prefix}_${resortIds.length}`,
        Price: 100,
        LegacyDistance: 0,
        SnowCondition: 'powder',
        Description: 'Revenue fixture',
        ...(deleted ? { DeletedAt: new Date() } : {}),
      },
    });
    resortIds.push(record.ResortId);
    return record.ResortId;
  }
  function put(
    resortId: number,
    reportDate = '2026-10-01',
    amount = '12.34',
    actor = admin,
    requestId: string = randomUUID(),
  ) {
    return request(http)
      .put(`${base}/admin/revenue`)
      .set('Idempotency-Key', requestId)
      .auth(actor.token, { type: 'bearer' })
      .send({ resortId, reportDate, revenueAmount: amount, note: '  note  ' });
  }
  function upload(
    csv: string | Buffer,
    actor = admin,
    filename = 'revenue.csv',
    contentType = 'text/csv',
    requestId: string = randomUUID(),
  ) {
    return request(http)
      .post(`${base}/admin/revenue/import`)
      .set('Idempotency-Key', requestId)
      .auth(actor.token, { type: 'bearer' })
      .attach('file', typeof csv === 'string' ? Buffer.from(csv) : csv, {
        filename,
        contentType,
      });
  }
  function list(query: object = {}, actor = merchant) {
    return request(http)
      .get(`${base}/merchant/revenue`)
      .auth(actor.token, { type: 'bearer' })
      .query(query);
  }
  async function finishImport(
    jobId: string,
    actor = admin,
    inspectRevokedFixture = false,
  ) {
    for (let attempt = 0; attempt < 205; attempt++) {
      await imports.run(jobId);
      const job = await prisma.revenueImportJob.findUniqueOrThrow({
        where: { JobId: jobId },
      });
      if (job.Status !== 'completed' && job.Status !== 'failed') continue;
      if (inspectRevokedFixture) {
        const rows = await prisma.revenueImportRow.findMany({
          where: { JobId: jobId },
          orderBy: { RowNumber: 'asc' },
        });
        return {
          result: {
            totalRows: job.TotalRows,
            succeededRows: job.SucceededRows,
            failedRows: job.FailedRows,
            results: rows.map((row) => ({
              rowNumber: row.RowNumber,
              success: row.Status === 'succeeded',
              revenueId: row.RevenueId,
              error: row.Error,
            })),
          },
        };
      }
      return (
        await request(http)
          .get(`${base}/admin/revenue/imports/${jobId}`)
          .auth(actor.token, { type: 'bearer' })
          .expect(200)
      ).body.data as {
        result: {
          totalRows: number;
          succeededRows: number;
          failedRows: number;
          results: {
            rowNumber: number;
            success: boolean;
            revenueId: number | null;
            error: string | null;
          }[];
        };
      };
    }
    throw new Error('Import did not reach terminal state');
  }
  function summary(query: object = {}, actor = merchant) {
    return request(http)
      .get(`${base}/merchant/revenue/summary`)
      .auth(actor.token, { type: 'bearer' })
      .query(query);
  }
  function logs(resortId: number) {
    return prisma.operationLog.findMany({
      where: {
        ActorUserId: { in: userIds },
        ResourceKey: 'revenue',
        Metadata: { path: ['after', 'resortId'], equals: resortId },
      },
      orderBy: { OperationLogId: 'asc' },
    });
  }

  async function writerRole(scope = 'all') {
    const permissions = await prisma.permission.findMany({
      where: {
        PermissionKey: {
          in: ['management:portal:enter', 'revenue:system:upsert'],
        },
      },
    });
    expect(permissions).toHaveLength(2);
    const role = await prisma.role.create({
      data: {
        RoleKey: `${prefix}_writer_${writerRoleIds.length}`,
        RoleName: 'Revenue validation writer',
        DataScope: scope,
        RolePermissions: {
          create: permissions.map(({ PermissionId }) => ({ PermissionId })),
        },
      },
    });
    writerRoleIds.push(role.RoleId);
    return role.RoleId;
  }

  function importGet(jobId: string, actor = admin) {
    return request(http)
      .get(`${base}/admin/revenue/imports/${jobId}`)
      .auth(actor.token, { type: 'bearer' });
  }
  async function importFixture(count = 2) {
    const roleId = await writerRole(),
      actor = await account(roleId),
      id = await resort();
    const bytes = Buffer.from(
      `${header}\n` +
        Array.from(
          { length: count },
          (_, i) =>
            `${id},2026-10-${String(i + 1).padStart(2, '0')},${i + 1},private-note`,
        ).join('\n'),
    );
    return { roleId, actor, id, bytes };
  }
  it('creates one durable job plus a jobId-only Outbox and replays the same file without rewriting later values', async () => {
    const { actor, id, bytes } = await importFixture(),
      key = randomUUID();
    const accepted = await upload(
      bytes,
      actor,
      'a.csv',
      'text/csv',
      key,
    ).expect(202);
    const jobId = accepted.body.data.jobId as string;
    expect(accepted.body.data).toMatchObject({
      status: 'pending',
      totalRows: 2,
      processedRows: 0,
      result: null,
    });
    expect(
      await prisma.resortRevenueRecord.count({ where: { ResortId: id } }),
    ).toBe(0);
    const events = await prisma.outboxEvent.findMany({
      where: { AggregateId: jobId, AggregateType: 'revenue_import' },
    });
    expect(events).toHaveLength(1);
    expect(events[0].Payload).toEqual({ jobId });
    const terminal = await finishImport(jobId, actor);
    expect(terminal.result).toMatchObject({ succeededRows: 2, failedRows: 0 });
    await put(id, '2026-10-01', '99').expect(200);
    const replay = await upload(
      bytes,
      actor,
      'renamed.csv',
      'text/csv',
      key.toUpperCase(),
    ).expect(202);
    expect(replay.body.data.jobId).toBe(jobId);
    expect(replay.body.data.result).toEqual(terminal.result);
    expect(await logs(id)).toHaveLength(3);
    expect(
      (await adminList({ resortId: id }).expect(200)).body.data.items.find(
        (row: { reportDate: string }) => row.reportDate === '2026-10-01',
      ).revenueAmount,
    ).toBe('99.00');
    expect(JSON.stringify(replay.body)).not.toMatch(
      /private-note|FileHash|LockToken|TraceId|Input/,
    );
  });
  it('binds the idempotency key to exact bytes including BOM and rejects changed files', async () => {
    const { actor, bytes } = await importFixture(),
      key = randomUUID();
    await upload(bytes, actor, 'a.csv', 'text/csv', key).expect(202);
    const mismatch = await upload(
      Buffer.concat([Buffer.from('\uFEFF'), bytes]),
      actor,
      'a.csv',
      'text/csv',
      key,
    ).expect(409);
    expect(mismatch.body.details[0].code).toBe('REVENUE_IMPORT_MISMATCH');
    expect(
      await prisma.revenueImportJob.count({ where: { ActorUserId: actor.id } }),
    ).toBe(1);
  });
  it('isolates job queries and identical UUIDs by actor, preserving current authorization', async () => {
    const f = await importFixture(),
      other = await account(await writerRole()),
      key = randomUUID();
    const first = await upload(
      f.bytes,
      f.actor,
      'a.csv',
      'text/csv',
      key,
    ).expect(202);
    await importGet(first.body.data.jobId, other).expect(404);
    const second = await upload(
      f.bytes,
      other,
      'a.csv',
      'text/csv',
      key,
    ).expect(202);
    expect(second.body.data.jobId).not.toBe(first.body.data.jobId);
    await removeWriteAccess('action revoked', f.actor, f.roleId);
    await importGet(first.body.data.jobId, f.actor).expect(403);
    await upload(f.bytes, f.actor, 'a.csv', 'text/csv', key).expect(403);
  });
  it('serializes concurrent same-key submissions into one committed job and one Outbox', async () => {
    const { actor, bytes } = await importFixture(),
      key = randomUUID();
    const responses = await Promise.all([
      upload(bytes, actor, 'a.csv', 'text/csv', key),
      upload(bytes, actor, 'a.csv', 'text/csv', key),
    ]);
    expect(responses.some((r) => r.status === 202)).toBe(true);
    expect(responses.every((r) => [202, 409].includes(r.status))).toBe(true);
    const jobs = await prisma.revenueImportJob.findMany({
      where: { ActorUserId: actor.id, RequestId: key },
    });
    expect(jobs).toHaveLength(1);
    expect(
      await prisma.outboxEvent.count({ where: { AggregateId: jobs[0].JobId } }),
    ).toBe(1);
    expect(
      (await upload(bytes, actor, 'a.csv', 'text/csv', key).expect(202)).body
        .data.jobId,
    ).toBe(jobs[0].JobId);
  });
  it('rolls back job, rows and Outbox when the real creation audit insert fails', async () => {
    const { actor, bytes } = await importFixture(),
      key = randomUUID();
    await expect(
      imports.create(bytes, key, {
        actorUserId: actor.id,
        traceId: 'x'.repeat(101),
        clientIp: null,
        userAgent: null,
      }),
    ).rejects.toMatchObject({ code: 'P2000' });
    expect(
      await prisma.revenueImportJob.count({ where: { ActorUserId: actor.id } }),
    ).toBe(0);
    expect(
      await prisma.operationLog.count({ where: { ActorUserId: actor.id } }),
    ).toBe(0);
  });
  it('recovers an expired lease, skips a committed row and fences an old worker', async () => {
    const { actor, id, bytes } = await importFixture();
    const accepted = await upload(bytes, actor).expect(202),
      jobId = accepted.body.data.jobId as string;
    const old = await importRepository.claim(jobId);
    expect(old).not.toBeNull();
    expect(await importRepository.claim(jobId)).toBeNull();
    expect(await importRepository.processOne(old!)).toBe('processed');
    await put(id, '2026-10-01', '77').expect(200);
    await prisma.revenueImportJob.update({
      where: { JobId: jobId },
      data: { LeaseUntil: new Date(Date.now() - 1) },
    });
    await imports.recover();
    expect(await importRepository.processOne(old!)).toBe('lost');
    const terminal = await importGet(jobId, actor).expect(200);
    expect(terminal.body.data).toMatchObject({
      status: 'completed',
      processedRows: 2,
      succeededRows: 2,
    });
    const record = await prisma.resortRevenueRecord.findFirstOrThrow({
      where: { ResortId: id, ReportDate: new Date('2026-10-01') },
    });
    expect(record.RevenueAmount.toFixed(2)).toBe('77.00');
    expect(await logs(id)).toHaveLength(3);
  });
  it('keeps a row pending and progress unchanged after its actual audit insert rolls back', async () => {
    const { actor, id, bytes } = await importFixture();
    const jobId = (await upload(bytes, actor).expect(202)).body.data
      .jobId as string;
    const faulted = prisma.$extends({
      query: {
        operationLog: {
          create({ args, query }) {
            args.data.TraceId = 'x'.repeat(101);
            return query(args);
          },
        },
      },
    });
    const failing = new RevenueImportService(
      new PrismaRevenueImportRepository(faulted as unknown as PrismaService),
    );
    await expect(failing.run(jobId)).rejects.toMatchObject({ code: 'P2000' });
    const state = await prisma.revenueImportJob.findUniqueOrThrow({
      where: { JobId: jobId },
    });
    expect(state.ProcessedRows).toBe(0);
    expect(state.FailureAttempts).toBe(1);
    expect(
      await prisma.resortRevenueRecord.count({ where: { ResortId: id } }),
    ).toBe(0);
    expect(await logs(id)).toHaveLength(0);
    await prisma.revenueImportJob.update({
      where: { JobId: jobId },
      data: { NextAttemptAt: new Date(0) },
    });
    expect((await finishImport(jobId, actor)).result.succeededRows).toBe(2);
  });
  it('marks infrastructure exhaustion failed without claiming earlier committed rows rolled back', async () => {
    const { actor, id, bytes } = await importFixture();
    const jobId = (await upload(bytes, actor).expect(202)).body.data
      .jobId as string;
    const claim = await importRepository.claim(jobId);
    await importRepository.processOne(claim!);
    await prisma.revenueImportJob.update({
      where: { JobId: jobId },
      data: { FailureAttempts: 7 },
    });
    await importRepository.defer(claim!);
    const result = await importGet(jobId, actor).expect(200);
    expect(result.body.data).toMatchObject({
      status: 'failed',
      totalRows: 2,
      processedRows: 2,
      succeededRows: 1,
      failedRows: 1,
      result: { succeededRows: 1, failedRows: 1 },
    });
    expect(await logs(id)).toHaveLength(1);
    expect(await importRepository.claim(jobId)).toBeNull();
  });
  it('deduplicates Kafka delivery through real Inbox and resumes durable pending work', async () => {
    const { actor, id, bytes } = await importFixture();
    const jobId = (await upload(bytes, actor).expect(202)).body.data
      .jobId as string;
    const row = await prisma.outboxEvent.findFirstOrThrow({
      where: { AggregateId: jobId },
    });
    const handler = new RevenueImportEventHandler(
      new PrismaInboxExecutor(prisma),
      imports,
    );
    const event = {
      eventId: row.EventId,
      eventType: row.EventType,
      aggregateType: row.AggregateType,
      aggregateId: row.AggregateId,
      occurredAt: row.OccurredAt,
      payload: { jobId },
    };
    expect(await handler.handle(event)).toBe(true);
    expect(await handler.handle(event)).toBe(false);
    expect(await logs(id)).toHaveLength(2);
    expect(
      await prisma.consumedEvent.count({
        where: { EventId: row.EventId, Status: 'completed' },
      }),
    ).toBe(1);
  });
  it('clears terminal inputs after seven days and results after thirty while preserving the key tombstone', async () => {
    const { actor, bytes } = await importFixture(),
      key = randomUUID();
    const jobId = (
      await upload(bytes, actor, 'a.csv', 'text/csv', key).expect(202)
    ).body.data.jobId as string;
    await finishImport(jobId, actor);
    await prisma.revenueImportJob.update({
      where: { JobId: jobId },
      data: {
        TerminalAt: new Date(Date.now() - 8 * 86400000),
        InputExpiresAt: new Date(Date.now() - 86400000),
      },
    });
    await importRepository.retain();
    const rows = await prisma.revenueImportRow.findMany({
      where: { JobId: jobId },
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.Input === null)).toBe(true);
    expect(
      (await importGet(jobId, actor).expect(200)).body.data.result
        .succeededRows,
    ).toBe(2);
    await prisma.revenueImportJob.update({
      where: { JobId: jobId },
      data: {
        TerminalAt: new Date('2026-01-01'),
        InputExpiresAt: new Date('2026-01-08'),
        ResultExpiresAt: new Date('2026-01-31'),
      },
    });
    await importGet(jobId, actor).expect(410);
    await importRepository.retain();
    expect(
      await prisma.revenueImportRow.count({ where: { JobId: jobId } }),
    ).toBe(0);
    const tombstone = await prisma.revenueImportJob.findUniqueOrThrow({
      where: { JobId: jobId },
    });
    expect(tombstone.FileHash).toHaveLength(64);
    expect(tombstone.ResultsPurgedAt).not.toBeNull();
    await upload(bytes, actor, 'a.csv', 'text/csv', key).expect(409);
  });
  it('enforces per-actor capacity and creation rate but permits existing-key replay', async () => {
    const { actor, bytes } = await importFixture();
    const keys = Array.from({ length: 5 }, () => randomUUID());
    for (const key of keys)
      await upload(bytes, actor, 'a.csv', 'text/csv', key).expect(202);
    await upload(bytes, actor).expect(429);
    await upload(bytes, actor, 'a.csv', 'text/csv', keys[0]).expect(202);
    expect(
      await prisma.revenueImportJob.count({ where: { ActorUserId: actor.id } }),
    ).toBe(5);
  });

  function result(requestId: string, actor = admin) {
    return request(http)
      .get(`${base}/admin/revenue/requests/${requestId}`)
      .auth(actor.token, { type: 'bearer' });
  }
  function adminList(query: object = {}, actor = admin) {
    return request(http)
      .get(`${base}/admin/revenue`)
      .auth(actor.token, { type: 'bearer' })
      .query(query);
  }
  async function reader(scope = 'all', ids?: number[]) {
    const roleId = await writerRole(scope);
    const grant = await prisma.permission.findUniqueOrThrow({
      where: { PermissionKey: 'revenue:system:list' },
    });
    await prisma.rolePermission.create({
      data: { RoleId: roleId, PermissionId: grant.PermissionId },
    });
    if (ids)
      await prisma.roleDataScope.create({
        data: {
          RoleId: roleId,
          ResourceKey: 'resort',
          ScopeType: 'selected',
          ScopeConfig: { selectedIds: ids },
        },
      });
    return { actor: await account(roleId), roleId };
  }
  it('replays the original response without overwriting a later value or duplicating audit', async () => {
    const id = await resort(),
      key = randomUUID();
    const first = await put(id, '2026-10-01', '12.3', admin, key).expect(200);
    await put(id, '2026-10-01', '99').expect(200);
    const replay = await put(
      id,
      '2026-10-01',
      '12.30',
      admin,
      key.toUpperCase(),
    ).expect(200);
    expect(replay.body.data).toEqual(first.body.data);
    expect(
      (await adminList({ resortId: id }).expect(200)).body.data.items[0]
        .revenueAmount,
    ).toBe('99.00');
    expect(await logs(id)).toHaveLength(2);
    const saved = await result(key).expect(200);
    expect(saved.body.data).toMatchObject({
      requestId: key,
      status: 'completed',
      result: { revenueAmount: '12.30' },
    });
    expect(Object.keys(saved.body.data.result).sort()).toEqual(
      [
        'revenueId',
        'resortId',
        'reportDate',
        'revenueAmount',
        'source',
        'createdAt',
        'updatedAt',
      ].sort(),
    );
    await result(key, secondAdmin).expect(404);
  });
  it('normalizes omitted, null and blank notes and rejects a changed body under the same key', async () => {
    const id = await resort(),
      key = randomUUID();
    const send = (note?: string | null) =>
      request(http)
        .put(`${base}/admin/revenue`)
        .auth(admin.token, { type: 'bearer' })
        .set('Idempotency-Key', key)
        .send({
          resortId: id,
          reportDate: '2026-10-01',
          revenueAmount: '01.00',
          ...(note === undefined ? {} : { note }),
        });
    const initial = await send().expect(200);
    for (const note of [null, '   '])
      expect((await send(note).expect(200)).body.data).toEqual(
        initial.body.data,
      );
    const mismatch = await send('changed').expect(409);
    expect(mismatch.body.details[0].code).toBe('REVENUE_REQUEST_MISMATCH');
    expect(await logs(id)).toHaveLength(1);
  });
  it.each([undefined, '', 'invalid', '00000000-0000-0000-0000-000000000000'])(
    'requires a valid UUID header: %s',
    async (key) => {
      const id = await resort();
      const call = request(http)
        .put(`${base}/admin/revenue`)
        .auth(admin.token, { type: 'bearer' });
      if (key !== undefined) call.set('Idempotency-Key', key);
      await call
        .send({ resortId: id, reportDate: '2026-10-01', revenueAmount: '1' })
        .expect(400);
      expect(await logs(id)).toHaveLength(0);
    },
  );
  it('keeps expired keys as permanent tombstones after bounded payload cleanup', async () => {
    const id = await resort(),
      key = randomUUID();
    await put(id, '2026-10-01', '1', admin, key).expect(200);
    const where = {
      ActorUserId_Operation_RequestId: {
        ActorUserId: admin.id,
        Operation: 'revenue.upsert',
        RequestId: key,
      },
    };
    await prisma.revenueWriteRequest.update({
      where,
      data: {
        CompletedAt: new Date('2026-01-01'),
        ExpiresAt: new Date('2026-02-01'),
      },
    });
    await result(key).expect(410);
    expect(
      (await put(id, '2026-10-01', '1', admin, key).expect(409)).body.details[0]
        .code,
    ).toBe('REVENUE_REQUEST_EXPIRED');
    expect(await repository.purgeExpiredResults()).toBeGreaterThanOrEqual(1);
    const tombstone = await prisma.revenueWriteRequest.findUniqueOrThrow({
      where,
    });
    expect(tombstone.Result).toBeNull();
    expect(tombstone.RequestHash).toHaveLength(64);
    await result(key).expect(410);
    await put(id, '2026-10-01', '2', admin, key).expect(409);
    expect(await logs(id)).toHaveLength(1);
  });
  it('requires current write authorization on both replay and own result query', async () => {
    const roleId = await writerRole(),
      actor = await account(roleId),
      id = await resort(),
      key = randomUUID();
    await put(id, '2026-10-01', '1', actor, key).expect(200);
    await removeWriteAccess('action revoked', actor, roleId);
    await put(id, '2026-10-01', '1', actor, key).expect(403);
    await result(key, actor).expect(403);
    expect(await logs(id)).toHaveLength(1);
  });
  it('returns an in-progress business code without waiting for the same live request lock', async () => {
    const id = await resort(),
      key = randomUUID();
    await prisma.$transaction(async (tx) => {
      const name = `revenue.upsert:${admin.id}:${key}`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${name}, 0))::text`;
      const busy = await put(id, '2026-10-01', '1', admin, key).expect(409);
      expect(busy.body.details[0].code).toBe('REVENUE_REQUEST_IN_PROGRESS');
      await result(key).expect(404);
    });
    await put(id, '2026-10-01', '1', admin, key).expect(200);
    expect(await logs(id)).toHaveLength(1);
  });
  it('rolls back the request result together with revenue and the actual failing audit insert', async () => {
    const id = await resort(),
      key = randomUUID();
    await expect(
      service.upsertIdempotent(
        { resortId: id, reportDate: '2026-10-01', revenueAmount: '5' },
        key,
        {
          actorUserId: admin.id,
          traceId: 'x'.repeat(101),
          clientIp: null,
          userAgent: null,
        },
      ),
    ).rejects.toThrow();
    await result(key).expect(404);
    expect(await logs(id)).toHaveLength(0);
    expect(
      await prisma.resortRevenueRecord.count({ where: { ResortId: id } }),
    ).toBe(0);
    await put(id, '2026-10-01', '5', admin, key).expect(200);
  });
  it('isolates identical request UUIDs by actor', async () => {
    const id = await resort(),
      key = randomUUID();
    await put(id, '2026-10-01', '1', admin, key).expect(200);
    await put(id, '2026-10-01', '2', secondAdmin, key).expect(200);
    expect((await result(key).expect(200)).body.data.result.revenueAmount).toBe(
      '1.00',
    );
    expect(
      (await result(key, secondAdmin).expect(200)).body.data.result
        .revenueAmount,
    ).toBe('2.00');
    expect(await logs(id)).toHaveLength(2);
  });
  it('applies global and selected read scope before list/count without implicit merchant ownership', async () => {
    const own = await resort(),
      other = await resort(1),
      deleted = await resort(0, true);
    for (const id of [own, other]) {
      await put(id, '2026-10-01', '1').expect(200);
      await put(id, '2026-10-02', '2').expect(200);
    }
    const { actor } = await reader('all', [other]);
    const first = await adminList({ pageSize: 1 }, actor).expect(200);
    expect(first.body.data).toMatchObject({
      total: 2,
      hasNext: true,
      items: [{ resortId: other, reportDate: '2026-10-02' }],
    });
    expect(
      (await adminList({ pageSize: 1, page: 2 }, actor).expect(200)).body.data
        .items[0].reportDate,
    ).toBe('2026-10-01');
    for (const resortId of [own, deleted, 2147483647])
      await adminList({ resortId }, actor).expect(404);
    expect(
      (
        await adminList({
          resortId: own,
          fromDate: '2026-10-01',
          toDate: '2026-10-01',
        }).expect(200)
      ).body.data.total,
    ).toBe(1);
    await adminList({}, merchant).expect(403);
  });
  it.each(['self', 'merchant'])(
    'rejects unsupported global read scope %s',
    async (scope) => {
      const { actor } = await reader(scope);
      await adminList({}, actor).expect(403);
    },
  );
  it('rejects mixed read scopes and rechecks changes after the read guard', async () => {
    const { actor, roleId } = await reader();
    const other = await reader('self');
    await prisma.userRole.create({
      data: { UserId: actor.id, RoleId: other.roleId },
    });
    await adminList({}, actor).expect(403);
    await prisma.userRole.delete({
      where: { UserId_RoleId: { UserId: actor.id, RoleId: other.roleId } },
    });
    const original = repository.adminPage.bind(repository);
    const spy = vi
      .spyOn(repository, 'adminPage')
      .mockImplementationOnce(async (...args) => {
        await prisma.role.update({
          where: { RoleId: roleId },
          data: { Status: 'disabled' },
        });
        return original(...args);
      });
    try {
      await adminList({}, actor).expect(403);
    } finally {
      spy.mockRestore();
    }
  });
  it.each([
    { fromDate: '2026-02-30' },
    { fromDate: '2026-10-02', toDate: '2026-10-01' },
    { fromDate: '2025-01-01', toDate: '2026-01-03' },
    { page: 2147483647, pageSize: 100 },
    { pageSize: 101 },
  ])('rejects invalid admin read input with 400: %j', async (query) => {
    await adminList(query).expect(400);
  });

  async function removeWriteAccess(
    kind: string,
    actor: Account,
    roleId: number,
  ) {
    if (kind === 'account disabled') {
      await prisma.user.update({
        where: { UserId: actor.id },
        data: { Status: 'disabled' },
      });
    } else if (kind === 'role disabled') {
      await prisma.role.update({
        where: { RoleId: roleId },
        data: { Status: 'disabled' },
      });
    } else if (kind === 'role unbound') {
      await prisma.userRole.deleteMany({ where: { UserId: actor.id } });
    } else if (kind === 'scope conflict') {
      await prisma.userRole.create({
        data: { UserId: actor.id, RoleId: await writerRole('self') },
      });
    } else {
      const permission = await prisma.permission.findUniqueOrThrow({
        where: {
          PermissionKey:
            kind === 'portal revoked'
              ? 'management:portal:enter'
              : 'revenue:system:upsert',
        },
      });
      await prisma.rolePermission.delete({
        where: {
          RoleId_PermissionId: {
            RoleId: roleId,
            PermissionId: permission.PermissionId,
          },
        },
      });
    }
  }

  it.each([
    'account disabled',
    'role disabled',
    'role unbound',
    'portal revoked',
    'action revoked',
    'scope conflict',
  ])(
    'rejects a write when %s commits after HTTP Guard but before the transaction',
    async (kind) => {
      const roleId = await writerRole();
      const actor = await account(roleId);
      const id = await resort();
      await put(id, '2026-10-01', '10', actor).expect(200);
      const original = repository.upsertIdempotent.bind(repository);
      const spy = vi
        .spyOn(repository, 'upsertIdempotent')
        .mockImplementationOnce(async (...args) => {
          await removeWriteAccess(kind, actor, roleId);
          return original(...args);
        });
      try {
        await put(id, '2026-10-01', '99', actor).expect(403);
      } finally {
        spy.mockRestore();
      }
      expect(
        (
          await prisma.resortRevenueRecord.findFirstOrThrow({
            where: { ResortId: id },
          })
        ).RevenueAmount.toFixed(2),
      ).toBe('10.00');
      expect(await logs(id)).toHaveLength(1);
    },
  );

  it('rejects direct application writes from missing and unauthorized actors without revenue or audit', async () => {
    const id = await resort();
    for (const actorUserId of [
      0,
      -1,
      Number.NaN,
      2147483647,
      member.id,
      merchant.id,
    ]) {
      await expect(
        service.upsert(
          {
            resortId: id,
            reportDate: '2026-10-01',
            revenueAmount: '12',
          },
          'manual',
          {
            actorUserId,
            traceId: 'revenue-direct-denied',
            clientIp: null,
            userAgent: null,
          },
        ),
      ).rejects.toMatchObject({ status: 403 });
    }
    expect(
      await prisma.resortRevenueRecord.count({ where: { ResortId: id } }),
    ).toBe(0);
    expect(await logs(id)).toHaveLength(0);
  });

  it('rechecks each independent CSV row after an earlier row commits and access is revoked', async () => {
    const roleId = await writerRole();
    const actor = await account(roleId);
    const id = await resort();
    const original = importRepository.processOne.bind(importRepository);
    const spy = vi
      .spyOn(importRepository, 'processOne')
      .mockImplementationOnce(async (...args) => {
        const row = await original(...args);
        await removeWriteAccess('action revoked', actor, roleId);
        return row;
      });
    try {
      const accepted = await upload(
        `${header}\n${id},2026-10-01,10,first\n${id},2026-10-02,20,second\n${id},2026-10-03,30,third`,
        actor,
      ).expect(202);
      const response = {
        body: {
          data: (await finishImport(accepted.body.data.jobId, actor, true))
            .result,
        },
      };
      expect(response.body.data).toMatchObject({
        succeededRows: 1,
        failedRows: 2,
      });
      expect(response.body.data.results.slice(1)).toEqual([
        {
          rowNumber: 3,
          success: false,
          revenueId: null,
          error: '当前账号无有效导入权限，该行未提交',
        },
        {
          rowNumber: 4,
          success: false,
          revenueId: null,
          error: '当前账号无有效导入权限，该行未提交',
        },
      ]);
    } finally {
      spy.mockRestore();
    }
    expect(
      await prisma.resortRevenueRecord.count({ where: { ResortId: id } }),
    ).toBe(1);
    expect(await logs(id)).toHaveLength(1);
  });

  it('keeps merchant revenue read-only and requires authentication, management entry and action grants', async () => {
    const id = await resort();
    await request(http).get(`${base}/merchant/revenue`).expect(401);
    await request(http).put(`${base}/admin/revenue`).send({}).expect(401);
    for (const actor of [member, merchant]) {
      await put(id, '2026-10-01', '1', actor).expect(403);
      await upload(`${header}\n${id},2026-10-01,1,note`, actor).expect(403);
    }
    await list({}, member).expect(403);
    await request(http)
      .put(`${base}/merchant/revenue`)
      .auth(merchant.token, { type: 'bearer' })
      .send({})
      .expect(404);
    for (const PermissionKey of [
      'management:portal:enter',
      'revenue:merchant:list',
    ]) {
      const grant = await prisma.permission.findUniqueOrThrow({
        where: { PermissionKey },
      });
      const key = { RoleId: merchantRoleId, PermissionId: grant.PermissionId };
      await prisma.rolePermission.delete({
        where: { RoleId_PermissionId: key },
      });
      try {
        await list().expect(403);
        await summary().expect(403);
      } finally {
        await prisma.rolePermission.create({ data: key });
      }
    }
    expect(await logs(id)).toHaveLength(0);
  });

  it('upserts a unique resort/date with exact decimals and preserves the original creator on later updates', async () => {
    const id = await resort();
    const created = await put(id, '2026-10-01', '9999999999.99')
      .set('User-Agent', 'x'.repeat(700))
      .expect(200);
    expect(created.body.data).toMatchObject({
      resortId: id,
      revenueAmount: '9999999999.99',
      source: 'manual',
      note: 'note',
      createdBy: { userId: admin.id },
    });
    const updated = await put(id, '2026-10-01', '0.10', secondAdmin).expect(
      200,
    );
    expect(updated.body.data).toMatchObject({
      revenueId: created.body.data.revenueId,
      revenueAmount: '0.10',
      createdBy: { userId: admin.id },
    });
    expect(
      await prisma.resortRevenueRecord.count({ where: { ResortId: id } }),
    ).toBe(1);
    const audit = await logs(id);
    expect(audit).toHaveLength(2);
    expect(audit[0].UserAgent).toHaveLength(500);
    expect(audit[1]).toMatchObject({
      ActorUserId: secondAdmin.id,
      Metadata: {
        before: { revenueAmount: '9999999999.99' },
        after: { revenueAmount: '0.10' },
      },
    });
    expect(JSON.stringify(updated.body)).not.toMatch(
      /PasswordHash|passwordHash|MerchantProfile|Contact/,
    );
  });

  it('uses identical merchant ownership and inclusive date filters for rows/count/summary/daily totals', async () => {
    const own = await resort(),
      other = await resort(1);
    await put(own, '2026-10-01', '0.10').expect(200);
    await put(own, '2026-10-02', '0.20').expect(200);
    await put(own, '2026-10-03', '50').expect(200);
    await put(other, '2026-10-01', '900').expect(200);
    const query = {
      resortId: own,
      fromDate: '2026-10-01',
      toDate: '2026-10-02',
      pageSize: 1,
    };
    const first = await list(query).expect(200);
    expect(first.body.data).toMatchObject({
      total: 2,
      page: 1,
      pageSize: 1,
      hasNext: true,
      items: [{ reportDate: '2026-10-02', revenueAmount: '0.20' }],
    });
    const next = await list({ ...query, page: 2 }).expect(200);
    expect(next.body.data).toMatchObject({
      total: 2,
      hasNext: false,
      items: [{ reportDate: '2026-10-01' }],
    });
    const aggregate = await summary(query).expect(200);
    expect(aggregate.body.data).toMatchObject({
      resortId: own,
      totalAmount: '0.30',
      daily: [
        { date: '2026-10-01', amount: '0.10' },
        { date: '2026-10-02', amount: '0.20' },
      ],
    });
    await summary({ ...query, resortId: other }).expect(404);
    expect(
      (await list({ ...query, resortId: other }).expect(200)).body.data,
    ).toMatchObject({ total: 0, items: [] });
  });

  it('intersects selected IDs with merchant ownership and rejects conflicting role scopes', async () => {
    const selected = await resort(),
      unselected = await resort(),
      other = await resort(1);
    for (const id of [selected, unselected, other]) await put(id).expect(200);
    await prisma.roleDataScope.create({
      data: {
        RoleId: merchantRoleId,
        ResourceKey: 'resort',
        ScopeType: 'selected',
        ScopeConfig: { selectedIds: [selected, other] },
      },
    });
    try {
      const result = await list({
        fromDate: '2026-10-01',
        toDate: '2026-10-01',
      }).expect(200);
      expect(result.body.data).toMatchObject({
        total: 1,
        items: [{ resortId: selected }],
      });
      expect(
        (
          await summary({
            fromDate: '2026-10-01',
            toDate: '2026-10-01',
          }).expect(200)
        ).body.data.totalAmount,
      ).toBe('12.34');
      for (const id of [unselected, other])
        await summary({ resortId: id }).expect(404);
      const adminRole = await prisma.role.findUniqueOrThrow({
        where: { SystemRoleCode: 'system_admin' },
      });
      await prisma.userRole.create({
        data: { UserId: merchant.id, RoleId: adminRole.RoleId },
      });
      try {
        await list().expect(403);
      } finally {
        await prisma.userRole.delete({
          where: {
            UserId_RoleId: { UserId: merchant.id, RoleId: adminRole.RoleId },
          },
        });
      }
    } finally {
      await prisma.roleDataScope.delete({
        where: {
          RoleId_ResourceKey: { RoleId: merchantRoleId, ResourceKey: 'resort' },
        },
      });
    }
  });

  it('hides soft-deleted resorts and disabled merchant profiles from every revenue projection', async () => {
    const id = await resort();
    await put(id).expect(200);
    await prisma.skiResort.update({
      where: { ResortId: id },
      data: { DeletedAt: new Date() },
    });
    expect((await list({ resortId: id }).expect(200)).body.data.total).toBe(0);
    await summary({ resortId: id }).expect(404);
    await put(id).expect(422);
    await prisma.merchantProfile.update({
      where: { MerchantId: merchantIds[0] },
      data: { Status: 'disabled' },
    });
    try {
      await list().expect(403);
      await summary().expect(403);
    } finally {
      await prisma.merchantProfile.update({
        where: { MerchantId: merchantIds[0] },
        data: { Status: 'active' },
      });
    }
  });

  it.each([
    { revenueAmount: '1e3' },
    { revenueAmount: '-1' },
    { revenueAmount: '1.001' },
    { revenueAmount: '10000000000' },
    { revenueAmount: null },
    { reportDate: '2026-02-30' },
    { reportDate: '2026-99-99' },
    { resortId: 2147483648 },
    { createdBy: 123 },
  ])(
    'rejects invalid manual input without records or audit: %j',
    async (patch) => {
      const id = await resort();
      const response = await request(http)
        .put(`${base}/admin/revenue`)
        .set('Idempotency-Key', randomUUID())
        .auth(admin.token, { type: 'bearer' })
        .send({
          resortId: id,
          reportDate: '2026-10-01',
          revenueAmount: '1.00',
          ...patch,
        });
      expect([400, 422]).toContain(response.status);
      expect(
        await prisma.resortRevenueRecord.count({ where: { ResortId: id } }),
      ).toBe(0);
      expect(await logs(id)).toHaveLength(0);
    },
  );

  it('rejects invalid query ranges and integer overflow without exposing database errors', async () => {
    for (const query of [
      { fromDate: '2026-02-30' },
      { fromDate: '2026-99-99' },
      { fromDate: '2026-10-02', toDate: '2026-10-01' },
      { page: '1e30' },
      { resortId: 2147483648 },
      { pageSize: 101 },
      { merchantId: merchantIds[1] },
    ]) {
      const response = await list(query);
      expect([400, 422]).toContain(response.status);
      expect(JSON.stringify(response.body)).not.toMatch(
        /Prisma|SELECT|\bP20\d\d\b/,
      );
    }
  });

  it('imports BOM/quoted UTF-8 rows, rejects duplicate and invalid rows, and commits each valid row separately', async () => {
    const id = await resort(),
      deleted = await resort(0, true);
    const csv = `\uFEFF${header}\r\n${id},2026-10-01,0.10,"雪场,说明"\r\n${id},2026-10-01,99,duplicate\r\n${id},2026-10-02,0.20,"line one\nline two"\r\n${deleted},2026-10-03,5,deleted\r\n${id},2026-02-30,1,bad date\r\n${id},2026-10-04,1.001,bad amount\r\n${id},2026-10-05,1,extra,column`;
    const accepted = await upload(csv).expect(202);
    const response = {
      body: { data: (await finishImport(accepted.body.data.jobId)).result },
    };
    expect(response.body.data).toMatchObject({
      totalRows: 7,
      succeededRows: 2,
      failedRows: 5,
    });
    expect(
      response.body.data.results.map(
        (row: { rowNumber: number; success: boolean }) => [
          row.rowNumber,
          row.success,
        ],
      ),
    ).toEqual([
      [2, true],
      [3, false],
      [4, true],
      [5, false],
      [6, false],
      [7, false],
      [8, false],
    ]);
    const records = await prisma.resortRevenueRecord.findMany({
      where: { ResortId: id },
      orderBy: { ReportDate: 'asc' },
    });
    expect(
      records.map((row) => [
        row.RevenueAmount.toFixed(2),
        row.Source,
        row.Note,
        row.CreatedBy,
      ]),
    ).toEqual([
      ['0.10', 'import', '雪场,说明', admin.id],
      ['0.20', 'import', 'line one\nline two', admin.id],
    ]);
    expect(await logs(id)).toHaveLength(2);
    expect(await logs(deleted)).toHaveLength(0);
    expect(JSON.stringify(response.body)).not.toMatch(
      /雪场,说明|line one|Prisma/,
    );
  });

  it.each([
    ['wrong header', Buffer.from('amount,date\n1,2026-10-01')],
    ['invalid UTF-8', Buffer.from([0xc3, 0x28])],
    ['malformed quoting', Buffer.from(`${header}\n"unterminated`)],
    [
      'too many rows',
      Buffer.from(`${header}\n` + 'bad,2026-10-01,1,n\n'.repeat(5001)),
    ],
  ])(
    'rejects an entire malformed CSV before any writes: %s',
    async (_label, csv) => {
      const before = await prisma.operationLog.count({
        where: { ActorUserId: admin.id },
      });
      await upload(csv).expect(400);
      expect(
        await prisma.operationLog.count({ where: { ActorUserId: admin.id } }),
      ).toBe(before);
    },
  );

  it('enforces multipart filename, MIME, missing file and 10 MiB limits; accepts 5000 row reports', async () => {
    await upload(header, admin, 'wrong.txt').expect(400);
    await upload(header, admin, 'valid.csv', 'application/json').expect(400);
    await request(http)
      .post(`${base}/admin/revenue/import`)
      .auth(admin.token, { type: 'bearer' })
      .expect(400);
    await upload(Buffer.alloc(10 * 1024 * 1024 + 1)).expect(413);
    const accepted = await upload(
      `${header}\n` + 'bad,2026-10-01,1,n\n'.repeat(5000),
    ).expect(202);
    const response = {
      body: { data: (await finishImport(accepted.body.data.jobId)).result },
    };
    expect(response.body.data).toMatchObject({
      totalRows: 5000,
      succeededRows: 0,
      failedRows: 5000,
    });
  });

  it('rolls back both a created row and an updated row when the actual audit INSERT fails', async () => {
    const id = await resort();
    const audit = {
      actorUserId: admin.id,
      traceId: 'x'.repeat(101),
      clientIp: null,
      userAgent: null,
    };
    const body = {
      resortId: id,
      reportDate: '2026-10-01',
      revenueAmount: '50',
    };
    await expect(service.upsert(body, 'manual', audit)).rejects.toMatchObject({
      code: 'P2000',
    });
    expect(
      await prisma.resortRevenueRecord.count({ where: { ResortId: id } }),
    ).toBe(0);
    await put(id, '2026-10-01', '10').expect(200);
    await expect(service.upsert(body, 'manual', audit)).rejects.toMatchObject({
      code: 'P2000',
    });
    expect(
      (
        await prisma.resortRevenueRecord.findFirstOrThrow({
          where: { ResortId: id },
        })
      ).RevenueAmount.toFixed(2),
    ).toBe('10.00');
    expect(await logs(id)).toHaveLength(1);
    const result = await service.importCsv(
      Buffer.from(`${header}\n${id},2026-10-01,90,n\n${id},2026-10-02,80,n`),
      audit,
    );
    expect(result).toMatchObject({ succeededRows: 0, failedRows: 2 });
    expect(JSON.stringify(result)).not.toMatch(/Prisma|TraceId|P2000/);
    expect(
      await prisma.resortRevenueRecord.count({ where: { ResortId: id } }),
    ).toBe(1);
    expect(await logs(id)).toHaveLength(1);
  });

  it('serializes concurrent updates so a committed audit before-value cannot be stale', async () => {
    const id = await resort();
    await put(id, '2026-10-01', '10').expect(200);
    const record = await prisma.resortRevenueRecord.findFirstOrThrow({
      where: { ResortId: id },
    });
    let release!: () => void, locked!: () => void;
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holding = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "RevenueId" FROM "ResortRevenueRecord" WHERE "RevenueId" = ${record.RevenueId} FOR UPDATE`;
        locked();
        await gate;
      },
      { timeout: 15000 },
    );
    await ready;
    const requests = Promise.all([
      put(id, '2026-10-01', '20').then((value) => value),
      put(id, '2026-10-01', '30').then((value) => value),
    ]);
    try {
      const deadline = Date.now() + 8000;
      let waiting = 0;
      while (Date.now() < deadline) {
        const rows = await prisma.$queryRaw<
          { count: number }[]
        >`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%ResortRevenueRecord%'`;
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
    const audit = await logs(id);
    expect(audit).toHaveLength(2);
    const winner = responses.find((response) => response.status === 200)!;
    expect(audit[1].Metadata).toMatchObject({
      before: { revenueAmount: '10.00' },
      after: { revenueAmount: winner.body.data.revenueAmount },
    });
    expect(
      (
        await prisma.resortRevenueRecord.findUniqueOrThrow({
          where: { RevenueId: record.RevenueId },
        })
      ).RevenueAmount.toFixed(2),
    ).toBe(winner.body.data.revenueAmount);
  });

  it('does not attach revenue when a concurrent resort removal wins the reference lock', async () => {
    const id = await resort();
    let release!: () => void, locked!: () => void;
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const removing = prisma.$transaction(
      async (tx) => {
        await tx.skiResort.update({
          where: { ResortId: id },
          data: { DeletedAt: new Date() },
        });
        locked();
        await gate;
      },
      { timeout: 15000 },
    );
    await ready;
    const writing = put(id).then((response) => response);
    try {
      const deadline = Date.now() + 8000;
      let waiting = 0;
      while (Date.now() < deadline) {
        const rows = await prisma.$queryRaw<{ count: number }[]>`
          SELECT count(*)::int AS count FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
            AND query LIKE '%SkiResort%' AND query LIKE '%FOR SHARE%'
        `;
        waiting = rows[0].count;
        if (waiting > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(waiting).toBeGreaterThan(0);
    } finally {
      release();
      await removing;
    }
    expect((await writing).status).toBe(409);
    expect(
      await prisma.resortRevenueRecord.count({ where: { ResortId: id } }),
    ).toBe(0);
    expect(await logs(id)).toHaveLength(0);
  });
});
