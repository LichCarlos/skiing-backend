import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import type {
  AccessTokenClaims,
  AuthTokenService,
  IssuedAccessToken,
} from '../application/ports/auth-token-service.js';

const ISSUER = 'linji-api';
const AUDIENCE = 'linji-clients';
const DEFAULT_ACCESS_TTL_SECONDS = 15 * 60;
const DEFAULT_REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class HmacAuthTokenService implements AuthTokenService {
  constructor(
    private readonly secret: string,
    private readonly accessTtlSeconds = DEFAULT_ACCESS_TTL_SECONDS,
    private readonly refreshTtlSeconds = DEFAULT_REFRESH_TTL_SECONDS,
  ) {
    if (Buffer.byteLength(secret, 'utf8') < 32) {
      throw new Error('JWT_ACCESS_SECRET must contain at least 32 bytes');
    }
    if (
      !Number.isSafeInteger(accessTtlSeconds) ||
      accessTtlSeconds < 1 ||
      accessTtlSeconds > DEFAULT_ACCESS_TTL_SECONDS
    ) {
      throw new Error('JWT_ACCESS_TTL must be between 1 and 900 seconds');
    }
    if (!Number.isSafeInteger(refreshTtlSeconds) || refreshTtlSeconds < 60) {
      throw new Error('REFRESH_TOKEN_TTL_SECONDS must be at least 60');
    }
  }

  createSessionId(): string {
    return randomUUID();
  }

  createRefreshToken(): string {
    return randomBytes(32).toString('base64url');
  }

  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }

  refreshExpiresAt(now: Date): Date {
    return new Date(now.getTime() + this.refreshTtlSeconds * 1000);
  }

  issueAccessToken(
    userId: number,
    sessionId: string,
    now = new Date(),
  ): IssuedAccessToken {
    if (
      !Number.isSafeInteger(userId) ||
      userId < 1 ||
      !UUID_PATTERN.test(sessionId)
    ) {
      throw new TypeError('Invalid access token subject');
    }

    const issuedAt = Math.floor(now.getTime() / 1000);
    const expiresAt = new Date((issuedAt + this.accessTtlSeconds) * 1000);
    const header = encodeJson({ alg: 'HS256', typ: 'JWT' });
    const payload = encodeJson({
      iss: ISSUER,
      aud: AUDIENCE,
      sub: String(userId),
      sid: sessionId,
      jti: randomUUID(),
      iat: issuedAt,
      exp: Math.floor(expiresAt.getTime() / 1000),
    });
    const unsignedToken = `${header}.${payload}`;
    const signature = this.sign(unsignedToken).toString('base64url');

    return { token: `${unsignedToken}.${signature}`, expiresAt };
  }

  verifyAccessToken(token: string, now = new Date()): AccessTokenClaims | null {
    if (token.length > 4096) return null;
    const parts = token.split('.');
    if (parts.length !== 3 || parts.some((part) => part.length === 0))
      return null;

    try {
      const header = decodeJson(parts[0]);
      const payload = decodeJson(parts[1]);
      if (
        !isRecord(header) ||
        header.alg !== 'HS256' ||
        header.typ !== 'JWT' ||
        !isRecord(payload)
      ) {
        return null;
      }

      const receivedSignature = decodeBase64Url(parts[2]);
      if (!receivedSignature) return null;
      const expectedSignature = this.sign(`${parts[0]}.${parts[1]}`);
      if (
        receivedSignature.length !== expectedSignature.length ||
        !timingSafeEqual(receivedSignature, expectedSignature)
      ) {
        return null;
      }

      const nowSeconds = Math.floor(now.getTime() / 1000);
      const userId = Number(payload.sub);
      const issuedAt = payload.iat;
      const expiresAt = payload.exp;
      if (
        payload.iss !== ISSUER ||
        payload.aud !== AUDIENCE ||
        !Number.isSafeInteger(userId) ||
        userId < 1 ||
        typeof payload.sid !== 'string' ||
        !UUID_PATTERN.test(payload.sid) ||
        typeof payload.jti !== 'string' ||
        !UUID_PATTERN.test(payload.jti) ||
        typeof issuedAt !== 'number' ||
        !Number.isSafeInteger(issuedAt) ||
        typeof expiresAt !== 'number' ||
        !Number.isSafeInteger(expiresAt) ||
        issuedAt > nowSeconds + 60 ||
        expiresAt <= nowSeconds ||
        expiresAt - issuedAt > this.accessTtlSeconds
      ) {
        return null;
      }

      return { userId, sessionId: payload.sid };
    } catch {
      return null;
    }
  }

  private sign(value: string): Buffer {
    return createHmac('sha256', this.secret).update(value).digest();
  }
}

export function createAuthTokenServiceFromEnvironment(): HmacAuthTokenService {
  const secret = process.env.JWT_ACCESS_SECRET ?? '';
  const accessTtlSeconds = parseDuration(
    process.env.JWT_ACCESS_TTL ?? '15m',
    'JWT_ACCESS_TTL',
  );
  const refreshTtlSeconds = Number(
    process.env.REFRESH_TOKEN_TTL_SECONDS ?? DEFAULT_REFRESH_TTL_SECONDS,
  );
  return new HmacAuthTokenService(secret, accessTtlSeconds, refreshTtlSeconds);
}

function parseDuration(value: string, name: string): number {
  const match = /^(\d+)(s|m)$/.exec(value);
  if (!match) throw new Error(`${name} must use seconds or minutes`);
  const amount = Number(match[1]);
  return amount * (match[2] === 'm' ? 60 : 1);
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function decodeJson(value: string): unknown {
  const bytes = decodeBase64Url(value);
  if (!bytes) throw new TypeError('Invalid base64url segment');
  return JSON.parse(bytes.toString('utf8')) as unknown;
}

function decodeBase64Url(value: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const bytes = Buffer.from(value, 'base64url');
  return bytes.toString('base64url') === value ? bytes : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
