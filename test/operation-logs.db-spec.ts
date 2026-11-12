import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { IdentityAccessModule } from '../src/modules/identity-access/identity-access.module.js';
import { PlatformAdministrationModule } from '../src/modules/platform-administration/platform-administration.module.js';
import { BcryptPasswordHasher } from '../src/modules/identity-access/infrastructure/bcrypt-password-hasher.js';
import { configureHttp } from '../src/shared/http/configure-http.js';
import { PrismaService } from '../src/shared/persistence/prisma.service.js';

describe('Read-only operation log HTTP / real PostgreSQL', () => {
  const prefix = `log-${randomUUID().slice(0, 8)}`;
  const password = 'operation-log-validation-password';
  const users: number[] = [];
  const roles: number[] = [];
  let app: INestApplication<App>;
  let http: App;
  let prisma: PrismaService;
  let administrator: { id: number; token: string };
  let custom: typeof administrator;
  let member: typeof administrator;
  let firstId: string;
  let secondId: string;
  const timestamp = new Date('2026-10-29T00:00:00Z');

  beforeAll(async () => {
    if (!process.env.DATABASE_URL)
      throw new Error('Dedicated migrated DATABASE_URL required');
    vi.stubEnv(
      'JWT_ACCESS_SECRET',
      'operation-log-http-validation-secret-at-least-32-chars',
    );
    const module = await Test.createTestingModule({
      imports: [IdentityAccessModule, PlatformAdministrationModule],
    }).compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.init();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);
    const adminRole = await prisma.role.findUniqueOrThrow({
      where: { SystemRoleCode: 'system_admin' },
    });
    const userRole = await prisma.role.findUniqueOrThrow({
      where: { SystemRoleCode: 'registered_user' },
    });
    administrator = await account(adminRole.RoleId);
    member = await account(userRole.RoleId);
    const grants = await prisma.permission.findMany({
      where: {
        PermissionKey: {
          in: ['management:portal:enter', 'system:operation-log:list'],
        },
      },
    });
    expect(grants).toHaveLength(2);
    const customRole = await prisma.role.create({
      data: {
        RoleKey: prefix,
        RoleName: 'Log reader validation',
        DataScope: 'all',
        RolePermissions: {
          create: grants.map(({ PermissionId }) => ({ PermissionId })),
        },
      },
    });
    roles.push(customRole.RoleId);
    custom = await account(customRole.RoleId);
    firstId = (await log({ TargetId: 'first' })).OperationLogId.toString();
    secondId = (await log({ TargetId: 'second' })).OperationLogId.toString();
    await log({
      TargetId: 'failure',
      Result: 'failure',
      ActionKey: `${prefix}:failure`,
      CreateTime: new Date('2026-10-29T00:00:01Z'),
    });
  });
  afterAll(async () => {
    try {
      if (prisma) {
        await prisma.operationLog.deleteMany({
          where: {
            OR: [{ ActorUserId: { in: users } }, { ResourceKey: prefix }],
          },
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
    const user = await prisma.user.create({
      data: {
        Account: `${prefix}-${users.length}`,
        Nickname: 'Logs validator',
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
  function log(patch: {
    TargetId: string;
    Result?: string;
    ActionKey?: string;
    CreateTime?: Date;
    ActorUserId?: number | null;
    OperationLogId?: bigint;
  }) {
    return prisma.operationLog.create({
      data: {
        ActorUserId: member.id,
        ActorAccountSnapshot: `${prefix}-snapshot`,
        ActionKey: `${prefix}:read`,
        ResourceKey: prefix,
        TargetType: 'validation',
        Result: 'success',
        TraceId: `${prefix}-trace`,
        CreateTime: timestamp,
        Reason: 'sensitive-reason',
        Metadata: {
          password: 'sensitive-password',
          message: 'sensitive-message',
        },
        ClientIp: '192.0.2.9',
        UserAgent: 'sensitive-agent',
        ...patch,
      },
    });
  }
  function list(query: Record<string, unknown> = {}) {
    return request(http)
      .get('/api/v1/admin/operation-logs')
      .query({ resourceKey: prefix, ...query })
      .auth(administrator.token, { type: 'bearer' });
  }
  it('denies anonymous, ordinary members and a custom role holding both required action grants', async () => {
    await request(http).get('/api/v1/admin/operation-logs').expect(401);
    for (const actor of [member, custom])
      await request(http)
        .get('/api/v1/admin/operation-logs')
        .auth(actor.token, { type: 'bearer' })
        .expect(403);
  });
  it('requires the log grant and portal grant even for an existing system administrator token', async () => {
    const role = await prisma.role.findUniqueOrThrow({
      where: { SystemRoleCode: 'system_admin' },
    });
    for (const PermissionKey of [
      'system:operation-log:list',
      'management:portal:enter',
    ]) {
      const permission = await prisma.permission.findUniqueOrThrow({
        where: { PermissionKey },
      });
      const where = {
        RoleId_PermissionId: {
          RoleId: role.RoleId,
          PermissionId: permission.PermissionId,
        },
      };
      await prisma.rolePermission.delete({ where });
      try {
        await list().expect(403);
      } finally {
        await prisma.rolePermission.create({ data: where.RoleId_PermissionId });
      }
      await list().expect(200);
    }
  });

  it('orders equal timestamps by BigInt ID and shares all filters between rows and count', async () => {
    const query = {
      actorUserId: member.id,
      actionKey: `${prefix}:read`,
      result: 'success',
      traceId: `${prefix}-trace`,
      fromTime: timestamp.toISOString(),
      toTime: '2026-10-29T08:00:00+08:00',
      pageSize: 1,
    };
    const first = await list(query).expect(200);
    expect(first.body.data).toMatchObject({
      total: 2,
      page: 1,
      pageSize: 1,
      hasNext: true,
    });
    expect(first.body.data.items[0].operationLogId).toBe(secondId);
    const next = await list({ ...query, page: 2 }).expect(200);
    expect(next.body.data).toMatchObject({ total: 2, hasNext: false });
    expect(next.body.data.items[0].operationLogId).toBe(firstId);
    const failure = await list({ result: 'failure' }).expect(200);
    expect(failure.body.data).toMatchObject({
      total: 1,
      items: [{ targetId: 'failure' }],
    });
  });
  it('returns exact-match empty results without interpreting text as SQL', async () => {
    for (const query of [
      { actionKey: prefix },
      { traceId: "' OR 1=1 --" },
      { actorUserId: custom.id },
      { resourceKey: `${prefix}-missing` },
      { fromTime: '2026-10-29T00:00:02Z' },
    ]) {
      const response = await list(query).expect(200);
      expect(response.body.data).toMatchObject({
        items: [],
        total: 0,
        hasNext: false,
      });
    }
  });
  it('projects only approved metadata, including nullable actor and an ID beyond JS integer precision', async () => {
    const big = 9007199254740993n;
    await log({ TargetId: 'removed', ActorUserId: null, OperationLogId: big });
    const response = await list({ actionKey: `${prefix}:read` }).expect(200);
    const row = response.body.data.items[0];
    expect(row).toEqual({
      operationLogId: big.toString(),
      actorUserId: null,
      actorAccountSnapshot: `${prefix}-snapshot`,
      actionKey: `${prefix}:read`,
      resourceKey: prefix,
      targetType: 'validation',
      targetId: 'removed',
      result: 'success',
      traceId: `${prefix}-trace`,
      createdAt: timestamp.toISOString(),
    });
    for (const hidden of [
      'sensitive-',
      '192.0.2.9',
      'Metadata',
      'metadata',
      'reason',
      'clientIp',
      'userAgent',
    ])
      expect(response.text).not.toContain(hidden);
  });
  it.each([
    { page: 0 },
    { pageSize: 101 },
    { page: Number.MAX_SAFE_INTEGER, pageSize: 100 },
    { actorUserId: 2147483648 },
    { actorUserId: '1.5' },
    { result: 'pending' },
    { fromTime: '2026-02-30T00:00:00Z' },
    { toTime: '2026-10-29T00:00:00' },
    { fromTime: '2026-10-29T00:00:01Z', toTime: '2026-10-29T00:00:00Z' },
    { actionKey: 'x'.repeat(151) },
    { metadata: 'forged' },
  ])('rejects invalid HTTP filters %j', async (query) => {
    await list(query).expect(400);
  });
  it('exposes no create/edit/delete/export/detail route and does not change log count when reading', async () => {
    const before = await prisma.operationLog.count();
    await list().expect(200);
    for (const method of ['post', 'patch', 'delete'] as const)
      await request(http)
        [method]('/api/v1/admin/operation-logs')
        .auth(administrator.token, { type: 'bearer' })
        .expect(404);
    for (const suffix of ['export', firstId])
      await request(http)
        .get(`/api/v1/admin/operation-logs/${suffix}`)
        .auth(administrator.token, { type: 'bearer' })
        .expect(404);
    expect(await prisma.operationLog.count()).toBe(before);
  });
});
