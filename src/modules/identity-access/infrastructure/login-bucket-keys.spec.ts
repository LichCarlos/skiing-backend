import {
  LoginBucketKeys,
  createLoginBucketKeysFromEnvironment,
} from './login-bucket-keys.js';

describe('login bucket pseudonyms', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('requires a separate deployment secret at startup', () => {
    vi.stubEnv('LOGIN_RATE_LIMIT_SECRET', '');
    expect(createLoginBucketKeysFromEnvironment).toThrow(
      'LOGIN_RATE_LIMIT_SECRET',
    );
    expect(() => new LoginBucketKeys('short')).toThrow();
  });
  it('normalizes accounts, separates dimensions and shares only with matching keys', () => {
    const a = new LoginBucketKeys('a'.repeat(32)),
      b = new LoginBucketKeys('a'.repeat(32)),
      c = new LoginBucketKeys('c'.repeat(32));
    expect(a.account(' Rider ')).toBe(b.account('rider'));
    expect(a.account('rider')).toMatch(/^[a-f0-9]{64}$/);
    expect(a.account('rider')).not.toBe(a.ip('rider'));
    expect(a.account('rider')).not.toBe(c.account('rider'));
  });
});
