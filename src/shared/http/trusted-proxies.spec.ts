import type { Request } from 'express';
import { loginClientIp, trustedProxyAllowlist } from './trusted-proxies.js';

describe('explicit trusted proxy configuration', () => {
  it.each(['0.0.0.0/0', '::/0'])('rejects blanket proxy trust %s', (value) =>
    expect(() => trustedProxyAllowlist(value)).toThrow(),
  );
  it('defaults to no proxy trust and accepts explicit IPv4/IPv6 networks', () => {
    expect(trustedProxyAllowlist('')).toBe(false);
    expect(trustedProxyAllowlist('127.0.0.1, ::1/128,10.0.0.0/8')).toEqual([
      '127.0.0.1',
      '::1/128',
      '10.0.0.0/8',
    ]);
  });
  it.each([
    'true',
    '1',
    'loopback',
    'uniquelocal',
    '192.0.2.1/33',
    '::1/129',
    '::1/-1',
    '127.0.0.1/',
    '::1,',
    '*',
    '1.2.3.4/24/1',
  ])('rejects non-allowlist configuration %s', (value) =>
    expect(() => trustedProxyAllowlist(value)).toThrow(),
  );
  it.each([
    ['::ffff:192.0.2.1', '192.0.2.1'],
    ['::ffff:c000:201', '192.0.2.1'],
    ['2001:0DB8:0000:0000:0000:0000:0000:0001', '2001:db8::1'],
    ['192.0.2.1', '192.0.2.1'],
  ])('canonicalizes equivalent IP %s', (input, expected) => {
    expect(loginClientIp({ ip: input } as Request)).toBe(expected);
  });
  it('fails closed without a valid client address', () => {
    expect(() =>
      loginClientIp({ ip: 'spoofed', socket: {} } as Request),
    ).toThrow();
  });
});
