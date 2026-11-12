import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request, { type Response, type Test as HttpTest } from 'supertest';
import type { App } from 'supertest/types.js';
import { IdentityAccessModule } from '../src/modules/identity-access/identity-access.module.js';
import { BcryptPasswordHasher } from '../src/modules/identity-access/infrastructure/bcrypt-password-hasher.js';
import { PrismaService } from '../src/shared/persistence/prisma.service.js';
import { configureHttp } from '../src/shared/http/configure-http.js';

interface Session {
  accessToken: string;
  refreshToken: string;
  sessionExpiresAt: string;
  currentUser: { userId: number; account: string; permissionKeys: string[] };
}

describe('Identity HTTP with real PostgreSQL and production adapters', () => {
  const prefix = `http-${randomUUID().slice(0, 8)}`;
  const password = 'validation-only-password';
  const origin = 'https://admin.validation.example';
  const roles: number[] = [];
  let app: INestApplication<App>;
  let http: App;
  let prisma: PrismaService;
  let passwordHash: string;
  let registeredRoleId: number;
  let administratorRoleId: number;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL)
      throw new Error(
        'DATABASE_URL must identify a dedicated migrated test database',
      );
    vi.stubEnv(
      'JWT_ACCESS_SECRET',
      'identity-http-validation-secret-at-least-32-chars',
    );
    vi.stubEnv('JWT_ACCESS_TTL', '15m');
    vi.stubEnv('REFRESH_TOKEN_TTL_SECONDS', '3600');
    vi.stubEnv('WEB_ORIGINS', origin);
    const module = await Test.createTestingModule({
      imports: [IdentityAccessModule],
    }).compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.init();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);
    await prisma.$connect();
    registeredRoleId = (
      await prisma.role.findUniqueOrThrow({
        where: { SystemRoleCode: 'registered_user' },
      })
    ).RoleId;
    administratorRoleId = (
      await prisma.role.findUniqueOrThrow({
        where: { SystemRoleCode: 'system_admin' },
      })
    ).RoleId;
    passwordHash = await new BcryptPasswordHasher().hash(password);
  });

  afterAll(async () => {
    try {
      if (prisma) {
        const records = await prisma.user.findMany({
          where: { Account: { startsWith: prefix } },
          select: { UserId: true },
        });
        const ids = records.map((user) => user.UserId);
        await prisma.operationLog.deleteMany({
          where: { ActorUserId: { in: ids } },
        });
        await prisma.user.deleteMany({ where: { UserId: { in: ids } } });
        await prisma.role.deleteMany({ where: { RoleId: { in: roles } } });
      }
    } finally {
      if (app) await app.close();
      vi.unstubAllEnvs();
    }
  });

  async function account(roleIds = [registeredRoleId]) {
    const user = await prisma.user.create({
      data: {
        Account: `${prefix}-${randomUUID().slice(0, 8)}`,
        Nickname: 'Identity database validation',
        PasswordHash: passwordHash,
        UserRoles: { create: roleIds.map((RoleId) => ({ RoleId })) },
      },
    });
    return user;
  }

  async function login(name: string): Promise<Session> {
    const response = await request(http)
      .post('/api/v1/auth/login')
      .send({ account: name, password })
      .expect(200);
    const session = (response.body as { data: Session }).data;
    expect(session.accessToken).toEqual(expect.any(String));
    expect(session.refreshToken).toEqual(expect.any(String));
    return session;
  }

  function me(session: Session) {
    return request(http)
      .get('/api/v1/auth/me')
      .auth(session.accessToken, { type: 'bearer' });
  }

  function refresh(token: string) {
    return request(http)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: token });
  }

  function hash(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  it('normalizes registration, binds the registered role and does not log in or expose credentials', async () => {
    const name = `${prefix}-register`;
    const result = await request(http)
      .post('/api/v1/auth/register')
      .send({
        account: ` ${name.toUpperCase()} `,
        password,
        nickname: '  Snow  ',
      })
      .expect(201);
    expect(result.body).toMatchObject({
      data: { account: name, nickname: 'Snow' },
    });
    expect(result.headers['set-cookie']).toBeUndefined();
    expect(JSON.stringify(result.body)).not.toContain(password);
    const user = await prisma.user.findUniqueOrThrow({
      where: { Account: name },
      include: { UserRoles: true, AuthSessions: true },
    });
    expect(user.PasswordHash).not.toBe(password);
    expect(
      await new BcryptPasswordHasher().verify(password, user.PasswordHash),
    ).toBe(true);
    expect(user.UserRoles.map((role) => role.RoleId)).toEqual([
      registeredRoleId,
    ]);
    expect(user.AuthSessions).toHaveLength(0);
    await request(http)
      .post('/api/v1/auth/register')
      .send({ account: name.toUpperCase(), password, nickname: 'Other' })
      .expect(409);
    await request(http).get('/api/v1/auth/me').expect(401);
    expect((await login(name.toUpperCase())).currentUser.account).toBe(name);
  });

  it('rejects unknown, wrong-password and disabled logins without creating a session', async () => {
    const user = await account();
    const wrong = await request(http)
      .post('/api/v1/auth/login')
      .send({ account: user.Account, password: 'wrong-password' })
      .expect(401);
    const missing = await request(http)
      .post('/api/v1/auth/login')
      .send({ account: `${prefix}-absent`, password })
      .expect(401);
    await prisma.user.update({
      where: { UserId: user.UserId },
      data: { Status: 'disabled' },
    });
    const disabled = await request(http)
      .post('/api/v1/auth/login')
      .send({ account: user.Account, password })
      .expect(401);
    expect(wrong.body.msg).toBe(missing.body.msg);
    expect(disabled.body.msg).toBe(missing.body.msg);
    expect(
      await prisma.authSession.count({ where: { UserId: user.UserId } }),
    ).toBe(0);
  });

  it('stores only refresh hashes, rotates with fixed expiry and revokes the family on reuse', async () => {
    const user = await account();
    const initial = await login(user.Account);
    await me(initial).expect(200);
    const stored = await prisma.authRefreshToken.findUniqueOrThrow({
      where: { TokenHash: hash(initial.refreshToken) },
    });
    expect(stored.TokenHash).not.toBe(initial.refreshToken);
    const response = await refresh(initial.refreshToken).expect(200);
    const next = (response.body as { data: Session }).data;
    expect(next.refreshToken).not.toBe(initial.refreshToken);
    expect(next.sessionExpiresAt).toBe(initial.sessionExpiresAt);
    expect(
      (
        await prisma.authRefreshToken.findUniqueOrThrow({
          where: { TokenHash: stored.TokenHash },
        })
      ).ConsumedAt,
    ).not.toBeNull();
    await me(next).expect(200);
    await refresh(initial.refreshToken).expect(401);
    expect(
      (
        await prisma.authSession.findUniqueOrThrow({
          where: { SessionId: stored.SessionId },
        })
      ).RevokedAt,
    ).not.toBeNull();
    await me(initial).expect(401);
    await me(next).expect(401);
    await refresh(next.refreshToken).expect(401);
    expect(
      await prisma.authRefreshToken.count({
        where: { SessionId: stored.SessionId },
      }),
    ).toBe(2);
  });

  it('allows one concurrent refresh only and revokes even the winning access token after reuse detection', async () => {
    const initial = await login((await account()).Account);
    const responses = await Promise.all([
      refresh(initial.refreshToken),
      refresh(initial.refreshToken),
    ]);
    expect(
      responses.map((response) => response.status).sort((a, b) => a - b),
    ).toEqual([200, 401]);
    const winner = (
      responses.find((response) => response.status === 200)!.body as {
        data: Session;
      }
    ).data;
    await me(winner).expect(401);
    await refresh(winner.refreshToken).expect(401);
    expect(
      await prisma.authRefreshToken.count({
        where: { Session: { UserId: initial.currentUser.userId } },
      }),
    ).toBe(2);
  });

  it('rejects expired sessions despite a valid JWT and keeps logout idempotent', async () => {
    const initial = await login((await account()).Account);
    await prisma.authSession.updateMany({
      where: { UserId: initial.currentUser.userId },
      data: { ExpiresAt: new Date(Date.now() - 1000) },
    });
    await me(initial).expect(401);
    await refresh(initial.refreshToken).expect(401);
    for (let attempt = 0; attempt < 2; attempt++)
      await request(http)
        .post('/api/v1/auth/logout')
        .send({ refreshToken: initial.refreshToken })
        .expect(200);
    expect(
      await prisma.authSession.count({
        where: { UserId: initial.currentUser.userId, RevokedAt: null },
      }),
    ).toBe(0);
  });

  it('logs out a live session and prevents both access and refresh reuse', async () => {
    const initial = await login((await account()).Account);
    await request(http)
      .post('/api/v1/auth/logout')
      .send({ refreshToken: initial.refreshToken })
      .expect(200);
    await me(initial).expect(401);
    await refresh(initial.refreshToken).expect(401);
    await request(http)
      .post('/api/v1/auth/logout')
      .send({ refreshToken: initial.refreshToken })
      .expect(200);
  });

  it('rechecks active roles, permission grants and account status for existing JWTs', async () => {
    const permission = await prisma.permission.findUniqueOrThrow({
      where: { PermissionKey: 'account:profile:read' },
    });
    const role = await prisma.role.create({
      data: {
        RoleKey: `${prefix}-profile`,
        RoleName: 'Profile validation',
        DataScope: 'self',
        RolePermissions: { create: { PermissionId: permission.PermissionId } },
      },
    });
    roles.push(role.RoleId);
    const user = await account([role.RoleId]);
    const session = await login(user.Account);
    await me(session).expect(200);
    await prisma.rolePermission.deleteMany({ where: { RoleId: role.RoleId } });
    await me(session).expect(403);
    await prisma.rolePermission.create({
      data: { RoleId: role.RoleId, PermissionId: permission.PermissionId },
    });
    await prisma.role.update({
      where: { RoleId: role.RoleId },
      data: { Status: 'disabled' },
    });
    await me(session).expect(403);
    await prisma.role.update({
      where: { RoleId: role.RoleId },
      data: { Status: 'active' },
    });
    await me(session).expect(200);
    await prisma.user.update({
      where: { UserId: user.UserId },
      data: { Status: 'disabled' },
    });
    await me(session).expect(403);
    await refresh(session.refreshToken).expect(401);
    expect(
      await prisma.authSession.count({
        where: { UserId: user.UserId, RevokedAt: null },
      }),
    ).toBe(0);
  });

  it('uses Secure HttpOnly browser cookies, enforces Origin/CSRF and clears cookies after replay', async () => {
    const user = await account();
    const csrf = await request(http)
      .get('/api/v1/auth/csrf')
      .set('Origin', origin)
      .expect(200);
    const csrfToken = (csrf.body as { data: { csrfToken: string } }).data
      .csrfToken;
    const csrfCookie = cookiePairs(csrf)[0]!;
    await request(http)
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .send({ account: user.Account, password })
      .expect(403);
    await request(http)
      .post('/api/v1/auth/login')
      .set('Origin', 'https://untrusted.example')
      .send({ account: user.Account, password })
      .expect(403);
    expect(
      await prisma.authSession.count({ where: { UserId: user.UserId } }),
    ).toBe(0);
    const loggedIn = await request(http)
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .set('Cookie', csrfCookie)
      .set('x-csrf-token', csrfToken)
      .send({ account: user.Account, password })
      .expect(200);
    expect((loggedIn.body as { data: Session }).data).not.toHaveProperty(
      'accessToken',
    );
    expect((loggedIn.body as { data: Session }).data).not.toHaveProperty(
      'refreshToken',
    );
    const rawCookies = cookies(loggedIn);
    expect(rawCookies).toHaveLength(2);
    for (const value of rawCookies) {
      expect(value).toContain('HttpOnly');
      expect(value).toContain('Secure');
      expect(value).toContain('SameSite=Lax');
    }
    expect(
      rawCookies.find((value) => value.startsWith('linji_refresh=')),
    ).toContain('Path=/api/v1/auth');
    const oldCookies = [...cookiePairs(loggedIn), csrfCookie];
    // Cookie-authenticated writes must not fall back to the native flow when Origin is omitted.
    await request(http)
      .patch('/api/v1/account/password')
      .set('Cookie', oldCookies)
      .send({
        currentPassword: password,
        newPassword: 'csrf-validation-password',
      })
      .expect(403);
    await request(http)
      .get('/api/v1/auth/me')
      .set('Origin', origin)
      .set('Cookie', oldCookies)
      .expect(200);
    await request(http)
      .post('/api/v1/auth/refresh')
      .set('Origin', origin)
      .set('Cookie', oldCookies)
      .set('x-csrf-token', 'wrong')
      .send({})
      .expect(403);
    const rotated = await request(http)
      .post('/api/v1/auth/refresh')
      .set('Origin', origin)
      .set('Cookie', oldCookies)
      .set('x-csrf-token', csrfToken)
      .send({})
      .expect(200);
    const replay = await request(http)
      .post('/api/v1/auth/refresh')
      .set('Origin', origin)
      .set('Cookie', oldCookies)
      .set('x-csrf-token', csrfToken)
      .send({})
      .expect(401);
    for (const name of ['linji_access', 'linji_refresh', 'linji_csrf'])
      expect(
        cookies(replay).find((value) => value.startsWith(`${name}=`)),
      ).toContain('Expires=Thu, 01 Jan 1970');
    await request(http)
      .get('/api/v1/auth/me')
      .set('Origin', origin)
      .set('Cookie', cookiePairs(rotated))
      .expect(401);
  });

  it('lets an administrator-created account change its password and revokes all its sessions with a redacted audit', async () => {
    const admin = await login((await account([administratorRoleId])).Account);
    const name = `${prefix}-created`;
    const created = await request(http)
      .post('/api/v1/admin/users')
      .auth(admin.accessToken, { type: 'bearer' })
      .send({
        account: name,
        nickname: 'Created account',
        password,
        roleIds: [registeredRoleId],
      })
      .expect(201);
    const userId = (created.body as { data: { userId: number } }).data.userId;
    expect(JSON.stringify(created.body)).not.toContain(password);
    const first = await login(name);
    const second = await login(name);
    const nextPassword = 'changed-validation-password';
    await request(http)
      .patch('/api/v1/account/password')
      .auth(first.accessToken, { type: 'bearer' })
      .send({ currentPassword: 'wrong-password', newPassword: nextPassword })
      .expect(401);
    await me(second).expect(200);
    await request(http)
      .patch('/api/v1/account/password')
      .auth(first.accessToken, { type: 'bearer' })
      .send({ currentPassword: password, newPassword: nextPassword })
      .expect(204);
    await me(first).expect(401);
    await me(second).expect(401);
    await refresh(second.refreshToken).expect(401);
    await request(http)
      .post('/api/v1/auth/login')
      .send({ account: name, password })
      .expect(401);
    await request(http)
      .post('/api/v1/auth/login')
      .send({ account: name, password: nextPassword })
      .expect(200);
    const audit = await prisma.operationLog.findMany({
      where: { ActorUserId: userId, ActionKey: 'account:password:change' },
    });
    expect(audit).toHaveLength(1);
    const serialized = JSON.stringify(audit, (_key, value: unknown) =>
      typeof value === 'bigint' ? value.toString() : value,
    );
    for (const secret of [
      password,
      nextPassword,
      first.refreshToken,
      second.accessToken,
      passwordHash,
    ])
      expect(serialized).not.toContain(secret);
    expect(audit[0]!.Metadata).toEqual({ refreshSessionsRevoked: true });
  });

  it.each(['status', 'roles', 'mixed'] as const)(
    'protects the last administrator during two real HTTP %s commands contending on the same role lock',
    async (mode) => {
      const pair = await Promise.all([
        account([administratorRoleId]),
        account([administratorRoleId]),
      ]);
      const pairIds = pair.map((user) => user.UserId);
      const sessions = await Promise.all(
        pair.map((user) => login(user.Account)),
      );
      const originalAdministrators = await prisma.user.findMany({
        where: {
          UserId: { notIn: pairIds },
          Status: 'active',
          UserRoles: {
            some: {
              Role: { SystemRoleCode: 'system_admin', Status: 'active' },
            },
          },
        },
        select: { UserId: true },
      });
      const originalIds = originalAdministrators.map((user) => user.UserId);
      try {
        // This file only runs against a dedicated test database, without file parallelism.
        await prisma.user.updateMany({
          where: { UserId: { in: originalIds } },
          data: { Status: 'disabled' },
        });
        const commands = pair.map((user, index) => {
          const command =
            mode === 'roles' || (mode === 'mixed' && index === 1)
              ? request(http)
                  .put(`/api/v1/admin/users/${user.UserId}/roles`)
                  .send({ roleIds: [registeredRoleId] })
              : request(http)
                  .patch(`/api/v1/admin/users/${user.UserId}/status`)
                  .send({ status: 'disabled' });
          return command.auth(sessions[index]!.accessToken, { type: 'bearer' });
        });
        const responses = await contendOnAdministratorLock(commands);
        expect(
          responses.map((response) => response.status).sort((a, b) => a - b),
        ).toEqual([200, 409]);
        const remaining = await prisma.user.findMany({
          where: {
            Status: 'active',
            UserRoles: {
              some: {
                Role: { SystemRoleCode: 'system_admin', Status: 'active' },
              },
            },
          },
        });
        expect(remaining).toHaveLength(1);
        expect(pairIds).toContain(remaining[0]!.UserId);
        const logs = await prisma.operationLog.findMany({
          where: { ActorUserId: { in: pairIds } },
        });
        expect(logs).toHaveLength(1);
        const winnerIndex = responses.findIndex(
          (response) => response.status === 200,
        );
        expect(logs[0]!.TargetId).toBe(String(pairIds[winnerIndex]));
        const survivorIndex = pairIds.indexOf(remaining[0]!.UserId);
        await request(http)
          .get('/api/v1/admin/users')
          .auth(sessions[survivorIndex]!.accessToken, { type: 'bearer' })
          .expect(200);
      } finally {
        await prisma.$transaction([
          prisma.user.updateMany({
            where: { UserId: { in: originalIds } },
            data: { Status: 'active' },
          }),
          prisma.user.updateMany({
            where: { UserId: { in: pairIds } },
            data: { Status: 'disabled' },
          }),
        ]);
      }
    },
  );

  async function contendOnAdministratorLock(
    commands: HttpTest[],
  ): Promise<Response[]> {
    let release!: () => void;
    let acquired!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const blocker = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "RoleId" FROM "Role" WHERE "SystemRoleCode" = 'system_admin' FOR UPDATE`;
        acquired();
        await gate;
      },
      { timeout: 10_000 },
    );
    await Promise.race([
      ready,
      blocker.then(() => {
        throw new Error('Role lock was not acquired');
      }),
    ]);
    const pending = Promise.all(
      commands.map((command) => Promise.resolve(command)),
    );
    try {
      const deadline = Date.now() + 2500;
      let waiting = 0;
      do {
        const rows = await prisma.$queryRaw<Array<{ count: number }>>`
          SELECT count(*)::int AS count FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
            AND query LIKE '%SELECT "RoleId" FROM "Role"%'
        `;
        waiting = rows[0]!.count;
        if (waiting >= 2) break;
        await delay(20);
      } while (Date.now() < deadline);
      expect(waiting).toBeGreaterThanOrEqual(2);
    } finally {
      release();
      await blocker;
      await pending;
    }
    return pending;
  }
});

function cookies(response: Response): string[] {
  const values: unknown = response.headers['set-cookie'];
  if (
    !Array.isArray(values) ||
    !values.every((value) => typeof value === 'string')
  )
    return [];
  return values as string[];
}

function cookiePairs(response: Response): string[] {
  return cookies(response).map((cookie) => cookie.split(';')[0]!);
}
