import { describe, expect, it } from 'vitest';
import {
  diagnosticTraceId,
  failureDiagnostic,
  UpstreamHttpError,
} from './failure-diagnostic.js';

const none = { kind: 'unexpected', upstreamStatus: null, code: null };
describe('safe failure diagnostics', () => {
  it('records a typed upstream status without exposing its body, message or stack', () => {
    const error = new UpstreamHttpError(
      429,
      'secret bearer, prompt and provider body',
    );
    expect(failureDiagnostic(error)).toEqual({
      kind: 'upstream_http',
      upstreamStatus: 429,
      code: null,
    });
    expect(JSON.stringify(failureDiagnostic(error))).not.toContain('secret');
  });
  it.each([0, 99, 600, 401.5, NaN])(
    'rejects invalid upstream status %s',
    (status) => {
      expect(() => new UpstreamHttpError(status)).toThrow(
        'Invalid upstream HTTP status',
      );
    },
  );
  it('does not infer upstream status from arbitrary error text', () => {
    expect(
      failureDiagnostic(new Error('Model provider returned HTTP 503')),
    ).toEqual(none);
  });
  it.each([
    'ECONNRESET',
    'ECONNREFUSED',
    'ENOTFOUND',
    'UND_ERR_SOCKET',
    'ERR_TLS_CERT_ALTNAME_INVALID',
  ])('allows known socket code %s through a fetch cause', (code) => {
    const cause = Object.assign(new Error('secret host or credential'), {
      code,
    });
    expect(
      failureDiagnostic(new TypeError('fetch failed: private URL', { cause })),
    ).toEqual({ kind: 'network', upstreamStatus: null, code });
  });
  it.each([
    'ETIMEDOUT',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_HEADERS_TIMEOUT',
    'UND_ERR_BODY_TIMEOUT',
  ])('classifies known deadline %s', (code) => {
    expect(
      failureDiagnostic(Object.assign(new Error('secret'), { code })),
    ).toEqual({ kind: 'timeout', upstreamStatus: null, code });
  });
  it('preserves deadline classification behind an embedding JSON wrapper', () => {
    const cause = new DOMException('secret timeout', 'TimeoutError');
    expect(failureDiagnostic(new Error('invalid JSON', { cause }))).toEqual({
      kind: 'timeout',
      upstreamStatus: null,
      code: null,
    });
  });
  it('distinguishes cancellation from timeout without copying its reason', () => {
    expect(failureDiagnostic(new DOMException('secret', 'AbortError'))).toEqual(
      { kind: 'aborted', upstreamStatus: null, code: null },
    );
  });
  it('allows only known Prisma names and codes, omitting query metadata', () => {
    const error = Object.assign(new Error('postgresql://secret'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2024',
      meta: { query: 'private' },
    });
    expect(failureDiagnostic(error)).toEqual({
      kind: 'database',
      upstreamStatus: null,
      code: 'P2024',
    });
    error.code = 'secret';
    expect(failureDiagnostic(error)).toEqual({
      kind: 'database',
      upstreamStatus: null,
      code: null,
    });
    error.name = 'secret';
    expect(failureDiagnostic(error)).toEqual(none);
  });
  it.each([
    null,
    undefined,
    'secret',
    { message: 'secret', code: 'ECONNRESET' },
    new Error('secret'),
  ])('withholds arbitrary thrown values', (value) => {
    expect(failureDiagnostic(value)).toEqual(none);
  });
  it('bounds cyclic and long cause chains', () => {
    const cycle = new Error('secret');
    cycle.cause = cycle;
    expect(failureDiagnostic(cycle)).toEqual(none);
    let deep: Error = new UpstreamHttpError(503);
    for (let i = 0; i < 4; i++) deep = new Error('secret', { cause: deep });
    expect(failureDiagnostic(deep)).toEqual(none);
  });
  it('ignores unknown code/name and throwing diagnostic getters', () => {
    const error = new Error('secret');
    for (const key of ['name', 'code', 'cause'])
      Object.defineProperty(error, key, {
        get() {
          throw new Error('secret');
        },
      });
    expect(failureDiagnostic(error)).toEqual(none);
  });
  it('only accepts trace UUIDs instead of logging caller strings', () => {
    expect(diagnosticTraceId('2e24f7fe-36e3-4a9a-9293-f6c3ecad7027')).toBe(
      '2e24f7fe-36e3-4a9a-9293-f6c3ecad7027',
    );
    for (const value of [
      'trace-secret\nforged',
      '',
      null,
      'secret'.repeat(100),
    ])
      expect(diagnosticTraceId(value)).toBeNull();
  });
});
