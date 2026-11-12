import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { WebCsrfGuard } from './web-csrf.guard.js';

describe('WebCsrfGuard request authentication boundary', () => {
  beforeEach(() =>
    vi.stubEnv('WEB_ORIGINS', 'https://admin.validation.example'),
  );
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    { method: 'POST', headers: {}, allowed: true },
    {
      method: 'PATCH',
      headers: { authorization: 'Bearer native-access' },
      allowed: true,
    },
    {
      method: 'GET',
      headers: { cookie: 'linji_access=browser-access' },
      allowed: true,
    },
    {
      method: 'PATCH',
      headers: { cookie: 'linji_access=browser-access' },
      allowed: false,
    },
    {
      method: 'POST',
      headers: { cookie: 'linji_refresh=browser-refresh' },
      allowed: false,
    },
    {
      method: 'POST',
      headers: { origin: 'https://attacker.example' },
      allowed: false,
    },
    {
      method: 'POST',
      headers: { origin: 'https://admin.validation.example' },
      allowed: false,
    },
    {
      method: 'POST',
      headers: {
        origin: 'https://admin.validation.example',
        cookie: 'linji_csrf=value',
        'x-csrf-token': 'different',
      },
      allowed: false,
    },
    {
      method: 'POST',
      headers: {
        origin: 'https://admin.validation.example',
        cookie: 'linji_csrf=value',
        'x-csrf-token': 'value',
      },
      allowed: true,
    },
  ])(
    'enforces $method $headers (allowed=$allowed)',
    ({ method, headers, allowed }) => {
      const context = {
        switchToHttp: () => ({ getRequest: () => ({ method, headers }) }),
      } as unknown as ExecutionContext;
      const invoke = () => new WebCsrfGuard().canActivate(context);
      if (allowed) expect(invoke()).toBe(true);
      else expect(invoke).toThrow(ForbiddenException);
    },
  );
});
