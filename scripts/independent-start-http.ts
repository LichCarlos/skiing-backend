import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { compare } from 'bcryptjs';

const database = new URL(process.env.DATABASE_URL ?? '');
const api = new URL(process.env.ISOLATED_API_BASE_URL ?? '');
const origin = new URL(process.env.ISOLATED_ADMIN_ORIGIN ?? '');
const account = process.env.ISOLATED_ADMIN_ACCOUNT;
const password = process.env.ISOLATED_ADMIN_PASSWORD;
if (
  ![database, api, origin].every((url) =>
    ['localhost', '127.0.0.1'].includes(url.hostname),
  ) ||
  !['postgres:', 'postgresql:'].includes(database.protocol) ||
  ![api, origin].every(
    (url) =>
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash,
  ) ||
  database.pathname !== '/linji_isolated_validation' ||
  process.env.ISOLATED_DATABASE_NAME !== 'linji_isolated_validation' ||
  !account?.startsWith('isolated_') ||
  !password
)
  throw new Error(
    'Explicit disposable loopback database/services and synthetic credentials required',
  );

const prisma = new PrismaClient();
const endpoint = (path: string) => `${api.href.replace(/\/$/, '')}${path}`;
async function request(path: string, init?: RequestInit) {
  return fetch(endpoint(path), {
    ...init,
    signal: AbortSignal.timeout(15_000),
    redirect: 'error',
  });
}
function post(body: unknown, headers?: Record<string, string>): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  };
}
interface Session {
  accessToken: string;
  refreshToken: string;
}
async function nativeLogin(username: string, secret: string): Promise<Session> {
  const response = await request(
    '/auth/login',
    post({ account: username, password: secret }),
  );
  assert.equal(response.status, 200);
  const session = (await response.json()).data as Session;
  assert.ok(session.accessToken && session.refreshToken);
  return session;
}

void describe(
  'Independent compiled Nest service / disposable PostgreSQL',
  { concurrency: false },
  () => {
    let admin: Session, target: Session, targetId: number;
    const ordinary = `isolated_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
    before(async () => {
      const rows = await prisma.$queryRaw<
        Array<{ name: string }>
      >`SELECT current_database() AS name`;
      assert.equal(rows[0]?.name, 'linji_isolated_validation');
      const seeded = await prisma.user.findUniqueOrThrow({
        where: { Account: account! },
      });
      admin = await nativeLogin(account!, password!);
      const me = await request('/auth/me', {
        headers: { Authorization: `Bearer ${admin.accessToken}` },
      });
      assert.equal(me.status, 200);
      assert.equal((await me.json()).data.userId, seeded.UserId);
    });
    after(async () => {
      await prisma.$disconnect();
    });

    void it('serves public empty projections and requires authentication for private data', async () => {
      for (const path of [
        '/resorts?page=1&pageSize=20',
        '/articles?page=1&pageSize=20',
        '/dynamics?limit=20',
      ]) {
        const response = await request(path);
        assert.equal(response.status, 200);
        assert.deepEqual((await response.json()).data.items, []);
      }
      assert.equal((await request('/public/config')).status, 200);
      assert.equal((await request('/auth/me')).status, 401);
      assert.equal(
        (await request('/admin/users?page=1&pageSize=20')).status,
        401,
      );
    });

    void it('issues Secure HttpOnly browser cookies, strips JSON tokens and rejects missing CSRF', async () => {
      const csrf = await request('/auth/csrf', {
        headers: { Origin: origin.origin },
      });
      assert.equal(csrf.status, 200);
      const csrfToken = (await csrf.json()).data.csrfToken as string;
      assert.ok(csrfToken);
      const csrfCookie = csrf.headers
        .getSetCookie()
        .find((cookie) => cookie.startsWith('linji_csrf='));
      assert.ok(csrfCookie);
      const login = await request(
        '/auth/login',
        post(
          { account, password },
          {
            Origin: origin.origin,
            Cookie: csrfCookie.split(';')[0]!,
            'X-CSRF-Token': csrfToken,
          },
        ),
      );
      assert.equal(login.status, 200);
      const session = (await login.json()).data;
      assert.equal(session.accessToken, undefined);
      assert.equal(session.refreshToken, undefined);
      const cookies = login.headers.getSetCookie();
      for (const name of ['linji_access', 'linji_refresh']) {
        const cookie = cookies.find((value) => value.startsWith(`${name}=`));
        assert.ok(
          cookie &&
            /; HttpOnly/i.test(cookie) &&
            /; Secure/i.test(cookie) &&
            /; SameSite=Lax/i.test(cookie),
        );
      }
      const cookieHeader = cookies
        .map((cookie) => cookie.split(';')[0])
        .join('; ');
      assert.equal(
        (
          await request(
            '/auth/logout',
            post({}, { Origin: origin.origin, Cookie: cookieHeader }),
          )
        ).status,
        403,
      );
      assert.equal(
        (await request('/auth/me', { headers: { Cookie: cookieHeader } }))
          .status,
        200,
      );
      const logout = await request(
        '/auth/logout',
        post(
          {},
          {
            Origin: origin.origin,
            Cookie: `${cookieHeader}; ${csrfCookie.split(';')[0]}`,
            'X-CSRF-Token': csrfToken,
          },
        ),
      );
      assert.equal(logout.status, 200);
      assert.equal(
        (await request('/auth/me', { headers: { Cookie: cookieHeader } }))
          .status,
        401,
      );
    });

    void it('registers without auto-login, assigns ordinary grants and denies management access', async () => {
      const registered = await request(
        '/auth/register',
        post({
          account: ordinary,
          password,
          nickname: 'Synthetic isolated member',
        }),
      );
      assert.equal(registered.status, 201);
      assert.equal(registered.headers.getSetCookie().length, 0);
      targetId = (await registered.json()).data.userId as number;
      const persisted = await prisma.user.findUniqueOrThrow({
        where: { Account: ordinary },
      });
      assert.equal(
        persisted.UserId,
        targetId,
        'Compiled service must write to the explicitly guarded database',
      );
      target = await nativeLogin(ordinary, password!);
      const headers = { Authorization: `Bearer ${target.accessToken}` };
      assert.equal((await request('/auth/me', { headers })).status, 200);
      assert.equal(
        (await request('/admin/users?page=1&pageSize=20', { headers })).status,
        403,
      );
      const adminHeaders = { Authorization: `Bearer ${admin.accessToken}` };
      const summary = await request('/admin/dashboard/summary', {
        headers: adminHeaders,
      });
      assert.equal(summary.status, 200);
      assert.ok((await summary.json()).data.users.total >= 2);
    });

    void it('resets the password through compiled HTTP, revokes sessions and persists a secret-free audit', async () => {
      const nextPassword = `Isolated-${randomUUID()}`;
      const reason = `isolated-start-${randomUUID()}`;
      const response = await request(`/admin/users/${targetId}/password`, {
        ...post(
          { newPassword: nextPassword, reason },
          { Authorization: `Bearer ${admin.accessToken}` },
        ),
        method: 'PATCH',
      });
      assert.equal(response.status, 204);
      assert.equal(await response.text(), '');
      assert.equal(
        (
          await request('/auth/me', {
            headers: { Authorization: `Bearer ${target.accessToken}` },
          })
        ).status,
        401,
      );
      assert.equal(
        (
          await request(
            '/auth/refresh',
            post({ refreshToken: target.refreshToken }),
          )
        ).status,
        401,
      );
      assert.equal(
        (await request('/auth/login', post({ account: ordinary, password })))
          .status,
        401,
      );
      const persisted = await prisma.user.findUniqueOrThrow({
        where: { UserId: targetId },
      });
      assert.ok(await compare(nextPassword, persisted.PasswordHash));
      const revoked = await prisma.authSession.findMany({
        where: { UserId: targetId },
      });
      assert.ok(
        revoked.length > 0 &&
          revoked.every((session) => session.RevokedAt !== null),
      );
      const logs = await prisma.operationLog.findMany({
        where: { Reason: reason },
      });
      assert.equal(logs.length, 1);
      assert.equal(logs[0]!.ActionKey, 'system:user:reset-password');
      assert.equal(logs[0]!.TargetId, String(targetId));
      const audit = JSON.stringify(logs[0]!.Metadata);
      for (const secret of [nextPassword, password!, persisted.PasswordHash])
        assert.ok(!audit.includes(secret));
      const replacement = await nativeLogin(ordinary, nextPassword);
      assert.equal(
        (
          await request('/auth/me', {
            headers: { Authorization: `Bearer ${replacement.accessToken}` },
          })
        ).status,
        200,
      );
    });
  },
);
