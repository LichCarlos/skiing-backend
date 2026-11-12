import { describe, expect, it } from 'vitest';
import { HmacAuthTokenService } from './hmac-auth-token.service.js';

const service = new HmacAuthTokenService('test-secret-with-at-least-32-bytes');

describe('HmacAuthTokenService', () => {
  it('issues short-lived access JWTs and verifies their identity claims', () => {
    const now = new Date('2026-10-27T00:00:00.000Z');
    const sessionId = service.createSessionId();
    const issued = service.issueAccessToken(42, sessionId, now);

    expect(issued.expiresAt.toISOString()).toBe('2026-10-27T00:15:00.000Z');
    expect(service.verifyAccessToken(issued.token, now)).toEqual({
      userId: 42,
      sessionId,
    });
    expect(
      service.verifyAccessToken(issued.token, new Date(issued.expiresAt)),
    ).toBeNull();
  });

  it('rejects tampered, malformed, and wrong-secret JWTs', () => {
    const now = new Date('2026-10-27T00:00:00.000Z');
    const issued = service.issueAccessToken(42, service.createSessionId(), now);
    const other = new HmacAuthTokenService('another-secret-with-32-bytes-min');
    const lastCharacter = issued.token.at(-1);
    const tamperedToken = `${issued.token.slice(0, -1)}${
      lastCharacter === 'A' ? 'B' : 'A'
    }`;

    expect(service.verifyAccessToken('not-a-jwt', now)).toBeNull();
    expect(service.verifyAccessToken(tamperedToken, now)).toBeNull();
    expect(other.verifyAccessToken(issued.token, now)).toBeNull();
  });

  it('stores refresh credentials only as one-way hashes and issues opaque randomness', () => {
    const first = service.createRefreshToken();
    const second = service.createRefreshToken();

    expect(first).not.toBe(second);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(service.hashRefreshToken(first)).toMatch(/^[a-f0-9]{64}$/);
    expect(service.hashRefreshToken(first)).not.toBe(first);
    expect(service.refreshExpiresAt(new Date(0)).getTime()).toBe(
      30 * 24 * 60 * 60 * 1000,
    );
  });

  it('rejects weak secrets and access TTLs longer than fifteen minutes', () => {
    expect(() => new HmacAuthTokenService('weak')).toThrow(/32 bytes/);
    expect(
      () =>
        new HmacAuthTokenService('valid-secret-with-at-least-32-bytes', 901),
    ).toThrow(/900 seconds/);
  });
});
