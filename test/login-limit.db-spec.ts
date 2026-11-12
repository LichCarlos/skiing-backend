import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/shared/persistence/prisma.service.js';
import { LoginBucketKeys } from '../src/modules/identity-access/infrastructure/login-bucket-keys.js';
import { PrismaLoginAttemptStore } from '../src/modules/identity-access/infrastructure/prisma-login-attempt.store.js';
import { IdentityAccessModule } from '../src/modules/identity-access/identity-access.module.js';
import { BcryptPasswordHasher } from '../src/modules/identity-access/infrastructure/bcrypt-password-hasher.js';
import { configureHttp } from '../src/shared/http/configure-http.js';

describe('login two-bucket protocol with real PostgreSQL', () => {
  const secret = randomBytes(32).toString('hex'),
    keys = new LoginBucketKeys(secret);
  const tracked = new Set<string>();
  let a: PrismaService,
    b: PrismaService,
    first: PrismaLoginAttemptStore,
    second: PrismaLoginAttemptStore;
  const accountKey = (v: string) => {
    const key = keys.account(v);
    tracked.add(key);
    return key;
  };
  const ipKey = (v: string) => {
    const key = keys.ip(v);
    tracked.add(key);
    return key;
  };
  const consume = (account: string, ip: string, store = first) => {
    accountKey(account);
    ipKey(ip);
    return store.consume(account, ip);
  };
  beforeAll(async () => {
    if (!process.env.DATABASE_URL)
      throw new Error('Dedicated migrated test database required');
    a = new PrismaService();
    b = new PrismaService();
    await Promise.all([a.$connect(), b.$connect()]);
    first = new PrismaLoginAttemptStore(a, keys);
    second = new PrismaLoginAttemptStore(b, new LoginBucketKeys(secret));
  });
  afterEach(async () => {
    await a.loginAttemptBucket.deleteMany({
      where: { BucketKey: { in: [...tracked] } },
    });
    tracked.clear();
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    await Promise.all([a?.$disconnect(), b?.$disconnect()]);
  });

  it('allows exactly five of twenty concurrent attempts across two independent connection pools', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        consume(' Rider ', '192.0.2.1', i % 2 ? first : second),
      ),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
    expect(results.filter((r) => !r.allowed)).toHaveLength(15);
    const rows = await a.loginAttemptBucket.findMany({
      where: { BucketKey: { in: [accountKey('rider'), ipKey('192.0.2.1')] } },
    });
    expect(rows.map((r) => r.Attempts)).toEqual([5, 5]);
    const before = rows;
    expect(await consume('RIDER', '192.0.2.1')).toMatchObject({
      allowed: false,
    });
    expect(
      await a.loginAttemptBucket.findMany({
        where: { BucketKey: { in: before.map((r) => r.BucketKey) } },
      }),
    ).toEqual(before);
  });
  it('limits rotating accounts to thirty per IP and creates neither bucket for a rejected new account', async () => {
    const results = await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        consume(`rotation-${i}`, '192.0.2.2', i % 2 ? first : second),
      ),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(30);
    expect(
      (
        await a.loginAttemptBucket.findUniqueOrThrow({
          where: { BucketKey: ipKey('192.0.2.2') },
        })
      ).Attempts,
    ).toBe(30);
    expect(await consume('new-rejected', '192.0.2.2')).toMatchObject({
      allowed: false,
    });
    expect(
      await a.loginAttemptBucket.findUnique({
        where: { BucketKey: accountKey('new-rejected') },
      }),
    ).toBeNull();
  });
  it('does not create or consume a new IP bucket when the account is exhausted', async () => {
    for (let i = 0; i < 5; i++)
      expect((await consume('fixed', '192.0.2.3')).allowed).toBe(true);
    const before = await a.loginAttemptBucket.findUniqueOrThrow({
      where: { BucketKey: accountKey('fixed') },
    });
    expect(await consume(' FIXED ', '192.0.2.4')).toMatchObject({
      allowed: false,
    });
    expect(
      await a.loginAttemptBucket.findUnique({
        where: { BucketKey: ipKey('192.0.2.4') },
      }),
    ).toBeNull();
    expect(
      await a.loginAttemptBucket.findUniqueOrThrow({
        where: { BucketKey: accountKey('fixed') },
      }),
    ).toEqual(before);
  });
  it('keeps independent fixed windows, uses the longest exhausted remaining duration and DB time', async () => {
    const account = accountKey('clock'),
      ip = ipKey('192.0.2.5');
    await a.$executeRaw`INSERT INTO "LoginAttemptBucket" VALUES (${account},5,clock_timestamp()+interval '10.2 seconds'),(${ip},30,clock_timestamp()+interval '40.2 seconds')`;
    const result = await consume('clock', '192.0.2.5');
    expect(result.allowed).toBe(false);
    if (!result.allowed)
      expect(result.retryAfterSeconds).toBeGreaterThanOrEqual(40);
    const [clock] = await a.$queryRaw<
      Array<{ now: Date }>
    >`SELECT clock_timestamp() AS now`;
    await a.loginAttemptBucket.update({
      where: { BucketKey: account },
      data: { ExpiresAt: new Date(clock!.now.getTime() - 1) },
    });
    await a.loginAttemptBucket.update({
      where: { BucketKey: ip },
      data: { ExpiresAt: new Date(clock!.now.getTime() - 1) },
    });
    // The application wall clock is deliberately unrelated to the database clock.
    const spy = vi.spyOn(Date, 'now').mockReturnValue(0);
    try {
      expect(await consume('clock', '192.0.2.5')).toEqual({ allowed: true });
    } finally {
      spy.mockRestore();
    }
    const rows = await a.loginAttemptBucket.findMany({
      where: { BucketKey: { in: [account, ip] } },
    });
    expect(rows.map((r) => r.Attempts)).toEqual([1, 1]);
    for (const row of rows)
      expect(row.ExpiresAt.getTime()).toBeGreaterThan(
        clock!.now.getTime() + 59000,
      );
    const before = rows;
    await consume('clock', '192.0.2.5');
    expect(
      (
        await a.loginAttemptBucket.findMany({
          where: { BucketKey: { in: [account, ip] } },
        })
      ).map((r) => r.ExpiresAt),
    ).toEqual(before.map((r) => r.ExpiresAt));
  });
  it('retains counts after disconnect and a new application adapter/connection', async () => {
    for (let i = 0; i < 5; i++) await consume('restart', '192.0.2.6');
    await b.$disconnect();
    const restarted = new PrismaService();
    try {
      const store = new PrismaLoginAttemptStore(
        restarted,
        new LoginBucketKeys(secret),
      );
      expect(await consume('RESTART', '192.0.2.6', store)).toMatchObject({
        allowed: false,
      });
    } finally {
      await restarted.$disconnect();
    }
  });
  it('persists windows across actual Node process exit and restart', async () => {
    accountKey('process-restart-fixture');
    ipKey('192.0.2.9');
    const run = promisify(execFile),
      env = {
        ...process.env,
        LOGIN_RATE_LIMIT_SECRET: secret,
        LINJI_DATABASE_TEST_DISPOSABLE: 'true',
      };
    const cli = path.resolve('node_modules/tsx/dist/cli.mjs');
    const initial = await run(
      process.execPath,
      [cli, 'scripts/login-limit-process-probe.ts', '5'],
      { env, windowsHide: true, timeout: 15000 },
    );
    expect(JSON.parse(initial.stdout)).toEqual(
      Array.from({ length: 5 }, () => ({ allowed: true })),
    );
    const restarted = await run(
      process.execPath,
      [cli, 'scripts/login-limit-process-probe.ts', '1'],
      { env, windowsHide: true, timeout: 15000 },
    );
    expect(JSON.parse(restarted.stdout)).toEqual([
      { allowed: false, retryAfterSeconds: expect.any(Number) },
    ]);
  });
  it('counts successful native/browser logins and treats nonexistent accounts identically at the limit', async () => {
    vi.stubEnv('JWT_ACCESS_SECRET', randomBytes(32).toString('hex'));
    vi.stubEnv('LOGIN_RATE_LIMIT_SECRET', secret);
    vi.stubEnv('TRUSTED_PROXY_CIDRS', '');
    vi.stubEnv('WEB_ORIGINS', 'https://limit.example');
    const name = `limit-${randomBytes(5).toString('hex')}`,
      missing = `missing-${randomBytes(5).toString('hex')}`,
      password = 'synthetic-password';
    const role = await a.role.findUniqueOrThrow({
      where: { SystemRoleCode: 'registered_user' },
    });
    const user = await a.user.create({
      data: {
        Account: name,
        Nickname: 'Rate limit fixture',
        PasswordHash: await new BcryptPasswordHasher().hash(password),
        UserRoles: { create: { RoleId: role.RoleId } },
      },
    });
    const module = await Test.createTestingModule({
      imports: [IdentityAccessModule],
    }).compile();
    const app: INestApplication<App> = module.createNestApplication();
    configureHttp(app);
    await app.init();
    accountKey(name);
    accountKey(missing);
    ipKey('127.0.0.1');
    try {
      const csrf = await request(app.getHttpServer())
        .get('/api/v1/auth/csrf')
        .set('Origin', 'https://limit.example');
      const token = csrf.body.data.csrfToken as string;
      for (let i = 0; i < 5; i++) {
        const req = request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ account: ` ${name.toUpperCase()} `, password });
        if (i === 0)
          req
            .set('Origin', 'https://limit.example')
            .set('Cookie', `linji_csrf=${token}`)
            .set('X-CSRF-Token', token);
        await req.expect(200);
      }
      for (let i = 0; i < 5; i++)
        await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ account: missing, password })
          .expect(401);
      const results = [];
      for (const account of [name, missing])
        results.push(
          await request(app.getHttpServer())
            .post('/api/v1/auth/login')
            .send({ account, password })
            .expect(429),
        );
      for (const result of results) {
        expect(result.body).toMatchObject({
          code: 429,
          msg: 'Login rate limit exceeded',
          data: null,
        });
        expect(result.headers['set-cookie']).toBeUndefined();
        expect(Number(result.headers['retry-after'])).toBeGreaterThan(0);
      }
      expect(
        await a.authSession.count({ where: { UserId: user.UserId } }),
      ).toBe(5);
      const rows = await a.loginAttemptBucket.findMany({
        where: {
          BucketKey: {
            in: [accountKey(name), accountKey(missing), ipKey('127.0.0.1')],
          },
        },
      });
      expect(rows.map((r) => r.Attempts).sort((x, y) => x - y)).toEqual([
        5, 5, 10,
      ]);
      expect(JSON.stringify(rows)).not.toContain(name);
      expect(JSON.stringify(rows)).not.toContain('127.0.0.1');
    } finally {
      await app.close();
      await a.user.delete({ where: { UserId: user.UserId } });
    }
  });
  it('rolls back the first increment if the second bucket write fails', async () => {
    const account = accountKey('rollback'),
      ip = ipKey('192.0.2.7');
    const sorted = [account, ip].sort();
    // Temporary constraint affects only this suite's key, removed even on assertion failure.
    await a.$executeRawUnsafe(
      `ALTER TABLE "LoginAttemptBucket" ADD CONSTRAINT "LoginLimitFixtureRollback" CHECK ("BucketKey" <> '${sorted[1]}')`,
    );
    try {
      await expect(consume('rollback', '192.0.2.7')).rejects.toThrow();
    } finally {
      await a.$executeRawUnsafe(
        'ALTER TABLE "LoginAttemptBucket" DROP CONSTRAINT "LoginLimitFixtureRollback"',
      );
    }
    expect(
      await a.loginAttemptBucket.count({
        where: { BucketKey: { in: [account, ip] } },
      }),
    ).toBe(0);
  });
  it('cleans at most 1000 expired rows per sweep and preserves live rows', async () => {
    // Other suites use separate namespaces but may have naturally expired by now.
    for (let i = 0; i < 20; i++) if ((await first.purgeExpired()) === 0) break;
    const records = Array.from({ length: 1005 }, (_, i) => ({
      BucketKey: accountKey(`expired-${i}`),
      Attempts: 1,
      ExpiresAt: new Date('2000-01-01Z'),
    }));
    await a.loginAttemptBucket.createMany({ data: records });
    await consume('live', '192.0.2.8');
    expect(await first.purgeExpired()).toBe(1000);
    expect(await first.purgeExpired()).toBe(5);
    expect(
      await a.loginAttemptBucket.count({
        where: { BucketKey: { in: [accountKey('live'), ipKey('192.0.2.8')] } },
      }),
    ).toBe(2);
  });
});
