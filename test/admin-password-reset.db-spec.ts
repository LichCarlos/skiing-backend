import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { Prisma } from '@prisma/client';
import { IdentityAccessModule } from '../src/modules/identity-access/identity-access.module.js';
import { ResetManagedPassword } from '../src/modules/identity-access/application/reset-managed-password.js';
import { PrismaAdminPasswordResetRepository } from '../src/modules/identity-access/infrastructure/prisma-admin-password-reset.repository.js';
import { PrismaAuthenticationRepository } from '../src/modules/identity-access/infrastructure/prisma-authentication.repository.js';
import { BcryptPasswordHasher } from '../src/modules/identity-access/infrastructure/bcrypt-password-hasher.js';
import { PrismaService } from '../src/shared/persistence/prisma.service.js';
import { configureHttp } from '../src/shared/http/configure-http.js';

describe('Managed password reset with real HTTP and PostgreSQL', () => {
  const prefix = `reset_${randomUUID().slice(0, 8)}`,
    password = 'old-validation-password',
    replacement = 'new-validation-password';
  let app: INestApplication<App>,
    http: App,
    prisma: PrismaService,
    adminRole: number,
    userRole: number,
    hash: string,
    sequence = 0;
  const ids: number[] = [],
    roles: number[] = [];
  const hasher = new BcryptPasswordHasher();
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? '');
    const disposableCi =
      process.env.GITHUB_ACTIONS === 'true' &&
      process.env.LINJI_DATABASE_TEST_DISPOSABLE === 'true' &&
      url.pathname === '/linji_validation';
    const disposableClosure =
      process.env.LINJI_DATABASE_TEST_DISPOSABLE === 'true' &&
      process.env.BUSINESS_CLOSURE_CONFIRM ===
        'linji_asset_storage_validation' &&
      url.pathname === '/linji_asset_storage_validation';
    if (
      !['127.0.0.1', 'localhost'].includes(url.hostname) ||
      (url.pathname !== '/linji_password_validation' &&
        !disposableCi &&
        !disposableClosure)
    )
      throw new Error(
        'Only the dedicated password reset validation database is permitted',
      );
    vi.stubEnv(
      'JWT_ACCESS_SECRET',
      'password-reset-validation-secret-at-least-32-chars',
    );
    const module = await Test.createTestingModule({
      imports: [IdentityAccessModule],
    }).compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.init();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);
    adminRole = (
      await prisma.role.findUniqueOrThrow({
        where: { SystemRoleCode: 'system_admin' },
      })
    ).RoleId;
    userRole = (
      await prisma.role.findUniqueOrThrow({
        where: { SystemRoleCode: 'registered_user' },
      })
    ).RoleId;
    hash = await hasher.hash(password);
  });
  afterAll(async () => {
    if (prisma) {
      await prisma.operationLog.deleteMany({
        where: { ActorUserId: { in: ids } },
      });
      await prisma.user.deleteMany({ where: { UserId: { in: ids } } });
      await prisma.role.deleteMany({ where: { RoleId: { in: roles } } });
    }
    await app?.close();
    vi.unstubAllEnvs();
  });
  async function account(roleId = userRole, status = 'active') {
    const value = await prisma.user.create({
      data: {
        Account: `${prefix}_${++sequence}`,
        Nickname: 'synthetic reset test',
        PasswordHash: hash,
        Status: status,
        UserRoles: { create: { RoleId: roleId } },
      },
    });
    ids.push(value.UserId);
    return value;
  }
  async function login(accountName: string, secret = password) {
    const result = await request(http)
      .post('/api/v1/auth/login')
      .send({ account: accountName, password: secret })
      .expect(200);
    return result.body.data as { accessToken: string; refreshToken: string };
  }
  const reset = (
    token: string,
    id: number,
    body: object = {
      newPassword: replacement,
      reason: 'validated support request',
    },
  ) =>
    request(http)
      .patch(`/api/v1/admin/users/${id}/password`)
      .auth(token, { type: 'bearer' })
      .send(body);
  const audit = (actorUserId: number, traceId = `${prefix}_${++sequence}`) => ({
    actorUserId,
    traceId,
    clientIp: null,
    userAgent: null,
  });
  const execute = (
    actorUserId: number,
    userId: number,
    traceId?: string,
    repo = new PrismaAdminPasswordResetRepository(prisma),
  ) =>
    new ResetManagedPassword(repo, hasher).execute({
      userId,
      newPassword: replacement,
      reason: 'support',
      audit: audit(actorUserId, traceId),
    });

  it('resets another account, rejects old login and revokes access and refresh for every session', async () => {
    const admin = await account(adminRole),
      target = await account();
    const operator = await login(admin.Account);
    const first = await login(target.Account),
      second = await login(target.Account);
    await reset(operator.accessToken, target.UserId).expect(204);
    for (const session of [first, second]) {
      await request(http)
        .get('/api/v1/auth/me')
        .auth(session.accessToken, { type: 'bearer' })
        .expect(401);
      await request(http)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: session.refreshToken })
        .expect(401);
    }
    await request(http)
      .post('/api/v1/auth/login')
      .send({ account: target.Account, password })
      .expect(401);
    await login(target.Account, replacement);
    const log = await prisma.operationLog.findFirstOrThrow({
      where: {
        ActorUserId: admin.UserId,
        TargetId: String(target.UserId),
        ActionKey: 'system:user:reset-password',
      },
    });
    expect(log.Reason).toBe('validated support request');
    expect(log.Metadata).toEqual({ revokedSessionCount: 2 });
    const serialized = JSON.stringify(log, (_key, value: unknown) =>
      typeof value === 'bigint' ? String(value) : value,
    );
    expect(serialized).not.toContain(replacement);
    expect(serialized).not.toContain(hash);
  });
  it('allows self reset and immediately invalidates the operator session', async () => {
    const admin = await account(adminRole),
      session = await login(admin.Account);
    await reset(session.accessToken, admin.UserId).expect(204);
    await request(http)
      .get('/api/v1/auth/me')
      .auth(session.accessToken, { type: 'bearer' })
      .expect(401);
    await login(admin.Account, replacement);
  });
  it('resets disabled accounts without enabling them or changing roles', async () => {
    const admin = await account(adminRole),
      target = await account(userRole, 'disabled');
    const session = await login(admin.Account);
    await reset(session.accessToken, target.UserId).expect(204);
    const value = await prisma.user.findUniqueOrThrow({
      where: { UserId: target.UserId },
      include: { UserRoles: true },
    });
    expect(value.Status).toBe('disabled');
    expect(value.UserRoles.map((x) => x.RoleId)).toEqual([userRole]);
    expect(await hasher.verify(replacement, value.PasswordHash)).toBe(true);
  });
  it.each([
    { newPassword: 'short', reason: 'support' },
    { newPassword: replacement, reason: ' ' },
    { newPassword: replacement, reason: 'support', roleId: 1 },
  ])('rejects invalid DTO %j without mutation', async (body) => {
    const admin = await account(adminRole),
      target = await account(),
      session = await login(admin.Account);
    await reset(session.accessToken, target.UserId, body).expect(400);
    expect(
      (
        await prisma.user.findUniqueOrThrow({
          where: { UserId: target.UserId },
        })
      ).PasswordHash,
    ).toBe(hash);
  });
  it('requires the protected system role even when a custom role has every action grant', async () => {
    const grants = await prisma.permission.findMany({
      where: {
        PermissionKey: {
          in: ['management:portal:enter', 'system:user:reset-password'],
        },
      },
    });
    const role = await prisma.role.create({
      data: {
        RoleKey: `${prefix}_custom`,
        RoleName: 'custom',
        DataScope: 'all',
        RolePermissions: {
          create: grants.map((x) => ({ PermissionId: x.PermissionId })),
        },
      },
    });
    roles.push(role.RoleId);
    const user = await account(role.RoleId),
      target = await account(),
      session = await login(user.Account);
    await reset(session.accessToken, target.UserId).expect(403);
    await expect(execute(user.UserId, target.UserId)).rejects.toMatchObject({
      status: 403,
    });
  });
  it('reauthorizes after the actor was disabled or lost its protected role', async () => {
    const target = await account();
    for (const changed of ['disabled', 'unbound']) {
      const admin = await account(adminRole);
      if (changed === 'disabled')
        await prisma.user.update({
          where: { UserId: admin.UserId },
          data: { Status: 'disabled' },
        });
      else
        await prisma.userRole.deleteMany({ where: { UserId: admin.UserId } });
      await expect(execute(admin.UserId, target.UserId)).rejects.toMatchObject({
        status: 403,
      });
    }
    expect(
      (
        await prisma.user.findUniqueOrThrow({
          where: { UserId: target.UserId },
        })
      ).PasswordHash,
    ).toBe(hash);
  });

  it('rejects an effective multi-role user-scope conflict inside the write transaction', async () => {
    const permission = await prisma.permission.findUniqueOrThrow({
      where: { PermissionKey: 'system:user:reset-password' },
    });
    const role = await prisma.role.create({
      data: {
        RoleKey: `${prefix}_conflict`,
        RoleName: 'scope conflict',
        DataScope: 'self',
        RolePermissions: { create: { PermissionId: permission.PermissionId } },
      },
    });
    roles.push(role.RoleId);
    const admin = await account(adminRole),
      target = await account();
    await prisma.userRole.create({
      data: { UserId: admin.UserId, RoleId: role.RoleId },
    });
    await expect(execute(admin.UserId, target.UserId)).rejects.toMatchObject({
      status: 403,
    });
  });

  it('returns 404 for a missing target and 400 for an out-of-range target', async () => {
    const admin = await account(adminRole),
      session = await login(admin.Account);
    await reset(session.accessToken, 2147483647).expect(404);
    await reset(session.accessToken, 2147483648).expect(400);
  });
  it('rolls back password and session revocation when the audit insert actually fails', async () => {
    const admin = await account(adminRole),
      target = await account(),
      session = await login(target.Account);
    await expect(
      execute(admin.UserId, target.UserId, 'x'.repeat(101)),
    ).rejects.toThrow();
    expect(
      (
        await prisma.user.findUniqueOrThrow({
          where: { UserId: target.UserId },
        })
      ).PasswordHash,
    ).toBe(hash);
    await request(http)
      .get('/api/v1/auth/me')
      .auth(session.accessToken, { type: 'bearer' })
      .expect(200);
  });
  it('rejects stale credentials at session creation after a committed reset', async () => {
    const admin = await account(adminRole),
      target = await account();
    await execute(admin.UserId, target.UserId);
    const repo = new PrismaAuthenticationRepository(prisma, {
      put: vi.fn(),
      remove: vi.fn(),
      createReadUrl: vi.fn(),
    });
    expect(
      await repo.create({
        sessionId: randomUUID(),
        userId: target.UserId,
        expectedPasswordHash: hash,
        refreshTokenHash: randomUUID(),
        now: new Date(),
        expiresAt: new Date(Date.now() + 60000),
      }),
    ).toBe(false);
    expect(
      await prisma.authSession.count({
        where: { UserId: target.UserId, RevokedAt: null },
      }),
    ).toBe(0);
  });
  it('makes an older reset snapshot conflict with a login, then a fresh explicit reset revokes that login', async () => {
    const admin = await account(adminRole),
      target = await account();
    let release!: () => void, started!: () => void;
    const gate = new Promise<void>((yes) => {
        release = yes;
      }),
      entered = new Promise<void>((yes) => {
        started = yes;
      });
    const wrapped = new Proxy(prisma, {
      get(object, key) {
        if (key === '$transaction')
          return (
            work: (tx: Prisma.TransactionClient) => Promise<void>,
            options: object,
          ) =>
            prisma.$transaction(async (tx) => {
              const proxy = new Proxy(tx, {
                get(inner, method) {
                  if (method === '$queryRaw')
                    return async (
                      strings: TemplateStringsArray,
                      ...values: unknown[]
                    ) => {
                      started();
                      await gate;
                      return tx.$queryRaw(strings, ...values);
                    };
                  return Reflect.get(inner, method);
                },
              });
              return work(proxy);
            }, options);
        return Reflect.get(object, key);
      },
    });
    const pending = execute(
      admin.UserId,
      target.UserId,
      undefined,
      new PrismaAdminPasswordResetRepository(wrapped),
    );
    const rejection = expect(pending).rejects.toMatchObject({ status: 409 });
    await entered;
    const session = await login(target.Account);
    release();
    await rejection;
    expect(
      (
        await prisma.user.findUniqueOrThrow({
          where: { UserId: target.UserId },
        })
      ).PasswordHash,
    ).toBe(hash);
    await execute(admin.UserId, target.UserId);
    await request(http)
      .get('/api/v1/auth/me')
      .auth(session.accessToken, { type: 'bearer' })
      .expect(401);
  });
});
