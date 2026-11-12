import { loginLimitDecision } from './login-limit.js';

describe('login attempt fixed windows', () => {
  const now = new Date('2026-11-03T00:00:00Z');
  const bucket = (attempts: number, ms: number) => ({
    attempts,
    expiresAt: new Date(now.getTime() + ms),
  });
  it('allows absent, below-limit and exactly expired windows', () => {
    expect(loginLimitDecision(now, undefined, undefined)).toEqual({
      allowed: true,
    });
    expect(
      loginLimitDecision(now, bucket(4, 60000), bucket(29, 60000)),
    ).toEqual({ allowed: true });
    expect(loginLimitDecision(now, bucket(5, 0), bucket(30, -1))).toEqual({
      allowed: true,
    });
  });
  it('rounds up, uses the longest exhausted dimension and ignores unexhausted windows', () => {
    expect(loginLimitDecision(now, bucket(5, 1), bucket(29, 60000))).toEqual({
      allowed: false,
      retryAfterSeconds: 1,
    });
    expect(loginLimitDecision(now, bucket(5, 1001), bucket(30, 24001))).toEqual(
      { allowed: false, retryAfterSeconds: 25 },
    );
    expect(loginLimitDecision(now, undefined, bucket(30, 2001))).toEqual({
      allowed: false,
      retryAfterSeconds: 3,
    });
  });
});
