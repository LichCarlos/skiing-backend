export const AUTH_SESSION_REPOSITORY = Symbol('AUTH_SESSION_REPOSITORY');

export interface CreateAuthSessionRecord {
  sessionId: string;
  userId: number;
  expectedPasswordHash: string;
  refreshTokenHash: string;
  expiresAt: Date;
  now: Date;
}

export type RefreshRotationResult =
  | {
      status: 'rotated';
      sessionId: string;
      userId: number;
      expiresAt: Date;
    }
  | { status: 'invalid' | 'reused' };

export interface AuthSessionRepository {
  create(input: CreateAuthSessionRecord): Promise<boolean>;
  isActive(input: {
    sessionId: string;
    userId: number;
    now: Date;
  }): Promise<boolean>;
  rotateRefreshToken(input: {
    currentTokenHash: string;
    replacementTokenHash: string;
    now: Date;
  }): Promise<RefreshRotationResult>;
  revokeByRefreshTokenHash(tokenHash: string, now: Date): Promise<void>;
  revokeSession(sessionId: string, now: Date): Promise<void>;
}
