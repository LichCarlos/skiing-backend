import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { IdentityAccessModule } from '../src/modules/identity-access/identity-access.module.js';
import { LOGIN_ATTEMPT_STORE } from '../src/modules/identity-access/application/ports/login-attempt-store.js';
import { AUTHENTICATION_REPOSITORY } from '../src/modules/identity-access/application/ports/authentication-repository.js';
import { PASSWORD_HASHER } from '../src/modules/identity-access/application/ports/password-hasher.js';
import { AUTH_SESSION_REPOSITORY } from '../src/modules/identity-access/application/ports/auth-session-repository.js';
import { configureHttp } from '../src/shared/http/configure-http.js';

describe('login limit HTTP protocol and trusted proxy chain', () => {
  const origin = 'https://admin.limit.example';
  const consume = vi.fn(),
    findByAccount = vi.fn(),
    verify = vi.fn(),
    create = vi.fn();
  let app: INestApplication<App>;
  async function setup(proxies = '') {
    vi.stubEnv(
      'JWT_ACCESS_SECRET',
      'http-limit-synthetic-secret-at-least-32-bytes',
    );
    vi.stubEnv('WEB_ORIGINS', origin);
    vi.stubEnv('TRUSTED_PROXY_CIDRS', proxies);
    const module = await Test.createTestingModule({
      imports: [IdentityAccessModule],
    })
      .overrideProvider(LOGIN_ATTEMPT_STORE)
      .useValue({ consume })
      .overrideProvider(AUTHENTICATION_REPOSITORY)
      .useValue({ findByAccount })
      .overrideProvider(PASSWORD_HASHER)
      .useValue({ verify })
      .overrideProvider(AUTH_SESSION_REPOSITORY)
      .useValue({ create })
      .compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.init();
  }
  const login = () => request(app.getHttpServer()).post('/api/v1/auth/login');
  const input = { account: ' Rider ', password: 'password' };
  beforeEach(() => {
    vi.clearAllMocks();
    consume.mockResolvedValue({ allowed: false, retryAfterSeconds: 17 });
  });
  afterEach(async () => {
    if (app) await app.close();
    vi.unstubAllEnvs();
  });
  it('fails real module construction without the independent deployment secret', async () => {
    vi.stubEnv(
      'JWT_ACCESS_SECRET',
      'http-limit-synthetic-secret-at-least-32-bytes',
    );
    vi.stubEnv('LOGIN_RATE_LIMIT_SECRET', '');
    await expect(
      Test.createTestingModule({ imports: [IdentityAccessModule] }).compile(),
    ).rejects.toThrow('LOGIN_RATE_LIMIT_SECRET');
  });
  it('returns a generic 429, a numeric Retry-After and no cookie/session or password work', async () => {
    await setup();
    const result = await login().send(input).expect(429);
    expect(result.body).toEqual({
      code: 429,
      msg: 'Login rate limit exceeded',
      data: null,
      traceId: expect.any(String),
    });
    expect(result.headers['retry-after']).toBe('17');
    expect(result.headers['set-cookie']).toBeUndefined();
    expect(findByAccount).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
  it('preserves browser cookies on rejection after valid Origin/CSRF validation', async () => {
    await setup();
    const csrf = await request(app.getHttpServer())
      .get('/api/v1/auth/csrf')
      .set('Origin', origin)
      .expect(200);
    const token = csrf.body.data.csrfToken as string;
    const result = await login()
      .set('Origin', origin)
      .set(
        'Cookie',
        `linji_csrf=${token}; linji_access=existing; linji_refresh=existing`,
      )
      .set('X-CSRF-Token', token)
      .send(input)
      .expect(429);
    expect(result.headers['set-cookie']).toBeUndefined();
    expect(consume).toHaveBeenCalledOnce();
  });
  it('does not consume either bucket for DTO or Origin/CSRF refusals', async () => {
    await setup();
    await login().send({ account: '', password: '' }).expect(400);
    await login().set('Origin', origin).send(input).expect(403);
    await login().set('Origin', 'https://evil.example').send(input).expect(403);
    expect(consume).not.toHaveBeenCalled();
  });
  it('fails closed on storage errors without leaking errors or issuing cookies', async () => {
    await setup();
    consume.mockRejectedValue(new Error('private-account-or-database'));
    const result = await login().send(input).expect(503);
    expect(result.body).toMatchObject({
      code: 503,
      msg: 'Internal server error',
      data: null,
    });
    expect(JSON.stringify(result.body)).not.toContain('private');
    expect(result.headers['retry-after']).toBeUndefined();
    expect(result.headers['set-cookie']).toBeUndefined();
    expect(findByAccount).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
  it('ignores caller XFF by default', async () => {
    await setup();
    await login().set('X-Forwarded-For', '192.0.2.100').send(input).expect(429);
    expect(consume).toHaveBeenCalledWith('rider', '127.0.0.1');
  });
  it('uses the nearest untrusted hop of an explicitly trusted Express chain', async () => {
    await setup('127.0.0.1/32,::1/128,10.0.0.0/8');
    await login()
      .set('X-Forwarded-For', '198.51.100.99, 192.0.2.10, 10.1.1.1')
      .send(input)
      .expect(429);
    expect(consume).toHaveBeenCalledWith('rider', '192.0.2.10');
  });
  it('does not trust XFF through an unlisted connecting proxy', async () => {
    await setup('10.0.0.0/8');
    await login().set('X-Forwarded-For', '192.0.2.100').send(input).expect(429);
    expect(consume).toHaveBeenCalledWith('rider', '127.0.0.1');
  });
});
