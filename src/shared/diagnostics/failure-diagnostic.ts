/** Safe metadata only: never serialize an Error, its message/stack or causes. */
export class UpstreamHttpError extends Error {
  constructor(
    readonly upstreamStatus: number,
    message = 'Upstream HTTP request failed',
  ) {
    super(message);
    this.name = 'UpstreamHttpError';
    if (
      !Number.isInteger(upstreamStatus) ||
      upstreamStatus < 100 ||
      upstreamStatus > 599
    )
      throw new TypeError('Invalid upstream HTTP status');
  }
}

const NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
]);
const DATABASE_CODES = new Set([
  'P1000',
  'P1001',
  'P1002',
  'P1008',
  'P1010',
  'P1011',
  'P1017',
  'P2000',
  'P2002',
  'P2003',
  'P2024',
  'P2025',
  'P2028',
  'P2034',
]);
const DATABASE_ERRORS = new Set([
  'PrismaClientKnownRequestError',
  'PrismaClientUnknownRequestError',
  'PrismaClientInitializationError',
  'PrismaClientRustPanicError',
  'PrismaClientValidationError',
]);

export interface FailureDiagnostic {
  kind:
    | 'upstream_http'
    | 'timeout'
    | 'aborted'
    | 'network'
    | 'database'
    | 'unexpected';
  upstreamStatus: number | null;
  code: string | null;
}

export function failureDiagnostic(error: unknown): FailureDiagnostic {
  const seen = new Set<Error>();
  let current = error;
  for (
    let depth = 0;
    depth < 4 && current instanceof Error && !seen.has(current);
    depth++
  ) {
    seen.add(current);
    if (
      current instanceof UpstreamHttpError &&
      Number.isInteger(current.upstreamStatus) &&
      current.upstreamStatus >= 100 &&
      current.upstreamStatus <= 599
    )
      return {
        kind: 'upstream_http',
        upstreamStatus: current.upstreamStatus,
        code: null,
      };
    const name = property(current, 'name');
    if (name === 'TimeoutError')
      return { kind: 'timeout', upstreamStatus: null, code: null };
    const code = property(current, 'code');
    if (typeof code === 'string' && NETWORK_CODES.has(code))
      return {
        kind:
          code.includes('TIMEOUT') || code === 'ETIMEDOUT'
            ? 'timeout'
            : 'network',
        upstreamStatus: null,
        code,
      };
    if (typeof name === 'string' && DATABASE_ERRORS.has(name))
      return {
        kind: 'database',
        upstreamStatus: null,
        code:
          typeof code === 'string' && DATABASE_CODES.has(code) ? code : null,
      };
    // Fetch may wrap a socket error in TypeError; inspect only a bounded cause chain.
    // A reader AbortError may also have a more informative timeout as its cause.
    const cause = property(current, 'cause');
    if (name === 'AbortError' && !(cause instanceof Error))
      return { kind: 'aborted', upstreamStatus: null, code: null };
    current = cause;
  }
  return { kind: 'unexpected', upstreamStatus: null, code: null };
}

export function diagnosticTraceId(value: unknown): string | null {
  return typeof value === 'string' &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(
      value,
    )
    ? value
    : null;
}

function property(error: Error, key: string): unknown {
  try {
    return Reflect.get(error, key) as unknown;
  } catch {
    return undefined;
  }
}
