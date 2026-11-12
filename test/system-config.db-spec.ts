import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { IdentityAccessModule } from '../src/modules/identity-access/identity-access.module.js';
import { BcryptPasswordHasher } from '../src/modules/identity-access/infrastructure/bcrypt-password-hasher.js';
import { PlatformAdministrationModule } from '../src/modules/platform-administration/platform-administration.module.js';
import { PrismaSystemConfigRepository } from '../src/modules/platform-administration/infrastructure/prisma-system-config.repository.js';
import { SYSTEM_CONFIG_CATALOG } from '../src/modules/platform-administration/domain/system-config.js';
import { PrismaService } from '../src/shared/persistence/prisma.service.js';
import { configureHttp } from '../src/shared/http/configure-http.js';

describe('System configuration real HTTP / PostgreSQL / atomic audit', () => {
  const prefix = `config-${randomUUID().slice(0, 8)}`,
    password = 'config-validation-password';
  const users: number[] = [],
    roles: number[] = [];
  type Actor = { id: number; token: string };
  let app: INestApplication<App>,
    http: App,
    prisma: PrismaService,
    repository: PrismaSystemConfigRepository;
  let admin: Actor, member: Actor, custom: Actor, adminRoleId: number;
  const base = '/api/v1/admin/config';
  const keys = SYSTEM_CONFIG_CATALOG.map((d) => d.configKey);
  beforeAll(async () => {
    if (!process.env.DATABASE_URL)
      throw new Error('Dedicated migrated database required');
    vi.stubEnv(
      'JWT_ACCESS_SECRET',
      'config-validation-secret-at-least-32-characters',
    );
    const module = await Test.createTestingModule({
      imports: [IdentityAccessModule, PlatformAdministrationModule],
    }).compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.listen(0, '127.0.0.1');
    http = app.getHttpServer();
    prisma = app.get(PrismaService);
    repository = app.get(PrismaSystemConfigRepository);
    // Fixed production keys cannot be randomized: require an unused dedicated
    // catalog rather than deleting or overwriting preexisting configuration.
    expect(
      await prisma.systemConfig.count({ where: { ConfigKey: { in: keys } } }),
    ).toBe(0);
    adminRoleId = (
      await prisma.role.findUniqueOrThrow({
        where: { SystemRoleCode: 'system_admin' },
      })
    ).RoleId;
    admin = await account(adminRoleId);
    member = await account(
      (
        await prisma.role.findUniqueOrThrow({
          where: { SystemRoleCode: 'registered_user' },
        })
      ).RoleId,
    );
    const permissions = await prisma.permission.findMany({
      where: {
        PermissionKey: {
          in: [
            'management:portal:enter',
            'system:config:list',
            'system:config:update',
          ],
        },
      },
    });
    expect(permissions).toHaveLength(3);
    const role = await prisma.role.create({
      data: {
        RoleKey: prefix,
        RoleName: prefix,
        DataScope: 'all',
        RolePermissions: {
          create: permissions.map((p) => ({ PermissionId: p.PermissionId })),
        },
      },
    });
    roles.push(role.RoleId);
    custom = await account(role.RoleId);
  });
  afterAll(async () => {
    try {
      if (prisma) {
        await prisma.systemConfig.deleteMany({
          where: { UpdatedByUserId: { in: users } },
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
      vi.restoreAllMocks();
    }
  });
  async function account(roleId: number): Promise<Actor> {
    const row = await prisma.user.create({
      data: {
        Account: `${prefix}-${users.length}`,
        Nickname: prefix,
        PasswordHash: await new BcryptPasswordHasher().hash(password),
        UserRoles: { create: { RoleId: roleId } },
      },
    });
    users.push(row.UserId);
    const result = await request(http)
      .post('/api/v1/auth/login')
      .send({ account: row.Account, password })
      .expect(200);
    return { id: row.UserId, token: result.body.data.accessToken as string };
  }
  const get = (query = '', actor = admin) =>
    request(http).get(`${base}${query}`).auth(actor.token, { type: 'bearer' });
  const patch = (key: string, body: unknown, actor = admin) =>
    request(http)
      .patch(`${base}/${key}`)
      .auth(actor.token, { type: 'bearer' })
      .send(body as object);
  const publicConfig = () => request(http).get('/api/v1/public/config');
  const audit = (traceId = prefix) => ({
    actorUserId: admin.id,
    traceId,
    clientIp: null,
    userAgent: null,
  });
  const version = async (key: string) =>
    (await prisma.systemConfig.findUnique({ where: { ConfigKey: key } }))
      ?.Version ?? 0;

  it('returns default directory rows, deterministic public revision and no-store', async () => {
    const page = await get().expect(200),
      first = await publicConfig().expect(200),
      second = await publicConfig().expect(200);
    expect(page.body.data).toMatchObject({
      total: 6,
      page: 1,
      pageSize: 20,
      hasNext: false,
    });
    expect(
      page.body.data.items.map((i: { configKey: string }) => i.configKey),
    ).toEqual(keys);
    for (const row of page.body.data.items)
      expect(row).toMatchObject({
        version: 0,
        updatedAt: null,
        updatedByUserId: null,
      });
    expect(first.body.data).toEqual(second.body.data);
    expect(first.body.data).toMatchObject({
      siteName: '凛迹雪客',
      about: null,
      contactEmail: null,
      privacyPolicy: null,
      termsOfService: null,
    });
    expect(first.headers['cache-control']).toBe('no-store');
  });
  it('requires login, current grants, portal and built-in administrator identity', async () => {
    await request(http).get(base).expect(401);
    for (const actor of [member, custom]) {
      await get('', actor).expect(403);
      await patch(
        'site.name',
        { value: 'unauthorized', expectedVersion: 0 },
        actor,
      ).expect(403);
    }
    expect(await version('site.name')).toBe(0);
  });
  it.each([
    { value: null, expectedVersion: 0 },
    { value: {}, expectedVersion: 0 },
    { value: '', expectedVersion: 0 },
    { value: '  ', expectedVersion: 0 },
    { value: 'x'.repeat(51), expectedVersion: 0 },
    { value: 'x', expectedVersion: -1 },
    { value: 'x', expectedVersion: '0' },
    { value: 'x', expectedVersion: 0, secret: true },
    { value: 'x' },
  ])('rejects malformed update %j', async (body) => {
    await patch('site.name', body).expect(400);
  });
  it('rejects unknown keys, invalid emails and unsafe query pagination', async () => {
    await patch('JWT_SECRET', { value: 'secret', expectedVersion: 0 }).expect(
      404,
    );
    await patch('site.contactEmail', {
      value: 'x@-bad.com',
      expectedVersion: 0,
    }).expect(400);
    for (const query of [
      '?page=0',
      '?pageSize=101',
      '?page=2147483647&pageSize=100',
      `?keyword=${'x'.repeat(101)}`,
      '?unknown=1',
    ])
      await get(query).expect(400);
  });
  it('saves plain text, increments versions, redacts audit values, and rejects stale versions', async () => {
    const beforeRevision = (await publicConfig().expect(200)).body.data
      .revision;
    const result = await patch('site.name', {
      value: ' 雪客 <script>literal</script> ',
      expectedVersion: 0,
    }).expect(200);
    expect(result.body.data).toMatchObject({
      value: '雪客 <script>literal</script>',
      version: 1,
      updatedByUserId: admin.id,
    });
    await patch('site.name', { value: 'overwrite', expectedVersion: 0 }).expect(
      409,
    );
    const logs = await prisma.operationLog.findMany({
      where: { ActorUserId: admin.id, TargetId: 'site.name' },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]!.Metadata).toEqual({
      configKey: 'site.name',
      beforeVersion: 0,
      afterVersion: 1,
    });
    expect(
      JSON.stringify(logs, (_key, value: unknown) =>
        typeof value === 'bigint' ? value.toString() : value,
      ),
    ).not.toContain('<script>');
    const current = (await publicConfig().expect(200)).body.data;
    expect(current.siteName).toBe('雪客 <script>literal</script>');
    expect(current.revision).not.toBe(beforeRevision);
    expect(Object.keys(current).sort()).toEqual(
      [
        'about',
        'contactEmail',
        'privacyPolicy',
        'revision',
        'siteName',
        'tagline',
        'termsOfService',
      ].sort(),
    );
  });
  it.each(['site.about', 'site.name'])(
    'allows only one simultaneous writer for %s',
    async (key) => {
      const expectedVersion = await version(key);
      const results = await Promise.all(
        ['first', 'second'].map((value) =>
          patch(key, { value, expectedVersion }).then((r) => r),
        ),
      );
      expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([
        200, 409,
      ]);
      expect(await version(key)).toBe(expectedVersion + 1);
      expect(
        await prisma.operationLog.count({
          where: {
            ActorUserId: admin.id,
            TargetId: key,
            Metadata: { path: ['afterVersion'], equals: expectedVersion + 1 },
          },
        }),
      ).toBe(1);
    },
  );
  it.each(['site.privacyPolicy', 'site.name'])(
    'rolls back config and audit on an actual audit INSERT failure for %s',
    async (key) => {
      const before = await prisma.systemConfig.findUnique({
          where: { ConfigKey: key },
        }),
        count = await prisma.operationLog.count({
          where: { ActorUserId: admin.id },
        });
      await expect(
        repository.update(
          key as 'site.name',
          'rollback-text',
          before?.Version ?? 0,
          audit('x'.repeat(101)),
        ),
      ).rejects.toThrow();
      expect(
        await prisma.systemConfig.findUnique({ where: { ConfigKey: key } }),
      ).toEqual(before);
      expect(
        await prisma.operationLog.count({ where: { ActorUserId: admin.id } }),
      ).toBe(count);
    },
  );
  it('rechecks authorization inside the write transaction after HTTP Guard succeeds', async () => {
    const original = repository.update.bind(repository);
    const spy = vi
      .spyOn(repository, 'update')
      .mockImplementationOnce(async (...args) => {
        await prisma.userRole.deleteMany({ where: { UserId: admin.id } });
        return original(...args);
      });
    const before = await version('site.name');
    try {
      await patch('site.name', {
        value: 'revoked',
        expectedVersion: before,
      }).expect(403);
    } finally {
      spy.mockRestore();
      await prisma.userRole.create({
        data: { UserId: admin.id, RoleId: adminRoleId },
      });
    }
    expect(await version('site.name')).toBe(before);
  });
  it('searches only key/label, paginates the catalog and hides legacy secret rows', async () => {
    await prisma.systemConfig.create({
      data: {
        ConfigKey: prefix,
        Value: 'secret-provider-value',
        UpdatedByUserId: admin.id,
      },
    });
    expect(
      (await get('?page=1&pageSize=2').expect(200)).body.data,
    ).toMatchObject({ total: 6, hasNext: true });
    expect((await get('?keyword=site.name').expect(200)).body.data.total).toBe(
      1,
    );
    expect(
      (await get('?keyword=rollback-text').expect(200)).body.data.total,
    ).toBe(0);
    expect((await publicConfig().expect(200)).text).not.toContain(
      'secret-provider-value',
    );
  });
  it('uses defaults for invalid legacy JSON and permits a versioned repair of inactive text', async () => {
    await prisma.systemConfig.create({
      data: {
        ConfigKey: 'site.termsOfService',
        Value: { internal: 'not public' },
        Status: 'disabled',
        UpdatedByUserId: admin.id,
      },
    });
    expect(
      (await publicConfig().expect(200)).body.data.termsOfService,
    ).toBeNull();
    await patch('site.termsOfService', {
      value: '第一段\n第二段',
      expectedVersion: 1,
    }).expect(200);
    expect((await publicConfig().expect(200)).body.data.termsOfService).toBe(
      '第一段\n第二段',
    );
  });
  it('accepts 30,000 Unicode policy characters above the default JSON transport limit', async () => {
    const content = '😀'.repeat(30000);
    await patch('site.privacyPolicy', {
      value: content,
      expectedVersion: 0,
    }).expect(200);
    expect((await publicConfig().expect(200)).body.data.privacyPolicy).toBe(
      content,
    );
    await patch('site.privacyPolicy', {
      value: content + 'x',
      expectedVersion: 1,
    }).expect(400);
  });
});
