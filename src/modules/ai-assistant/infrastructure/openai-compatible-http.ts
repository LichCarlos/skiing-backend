import { UpstreamHttpError } from '../../../shared/diagnostics/failure-diagnostic.js';

export function createCompatibleEndpoint(
  baseUrl: string | undefined,
  path: '/chat/completions' | '/embeddings',
): string {
  if (!baseUrl?.trim()) throw new Error('Model provider base URL is required');

  const base = new URL(baseUrl);
  if (
    (base.protocol !== 'https:' && base.protocol !== 'http:') ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  ) {
    throw new Error(
      'Model provider base URL must be HTTP(S) without credentials, query, or fragment',
    );
  }

  base.pathname = `${base.pathname.replace(/\/+$/, '')}${path}`;
  return base.toString();
}

export function createModelRequestSignal(
  configValue: string | undefined,
  configKey: string,
  fallbackMilliseconds: number,
  callerSignal?: AbortSignal,
): AbortSignal {
  const timeout =
    configValue === undefined ? fallbackMilliseconds : Number(configValue);
  if (!Number.isSafeInteger(timeout) || timeout < 1) {
    throw new Error(`${configKey} must be a positive integer`);
  }

  const timeoutSignal = AbortSignal.timeout(timeout);
  return callerSignal
    ? AbortSignal.any([callerSignal, timeoutSignal])
    : timeoutSignal;
}

export function modelAuthorizationHeader(
  apiKey: string | undefined,
): { authorization: string } | Record<string, never> {
  const normalizedKey = apiKey?.trim();
  return normalizedKey ? { authorization: `Bearer ${normalizedKey}` } : {};
}

export async function assertSuccessfulResponse(
  response: Response,
): Promise<void> {
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new UpstreamHttpError(
      response.status,
      `Model provider returned HTTP ${response.status}`,
    );
  }
}
