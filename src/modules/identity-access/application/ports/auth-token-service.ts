export const AUTH_TOKEN_SERVICE = Symbol('AUTH_TOKEN_SERVICE');

export interface AccessTokenClaims {
  userId: number;
  sessionId: string;
}

export interface IssuedAccessToken {
  token: string;
  expiresAt: Date;
}

export interface AuthTokenService {
  createSessionId(): string;
  createRefreshToken(): string;
  hashRefreshToken(token: string): string;
  refreshExpiresAt(now: Date): Date;
  issueAccessToken(
    userId: number,
    sessionId: string,
    now?: Date,
  ): IssuedAccessToken;
  verifyAccessToken(token: string, now?: Date): AccessTokenClaims | null;
}
