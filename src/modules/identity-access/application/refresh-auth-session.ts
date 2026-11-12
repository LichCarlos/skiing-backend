import { Inject, Injectable } from '@nestjs/common';
import {
  AUTH_SESSION_REPOSITORY,
  type AuthSessionRepository,
} from './ports/auth-session-repository.js';
import {
  AUTH_TOKEN_SERVICE,
  type AuthTokenService,
} from './ports/auth-token-service.js';
import { GetCurrentUser } from './get-current-user.js';
import type { AuthSessionVO } from './login-user.js';

export class RefreshSessionRejectedError extends Error {
  constructor() {
    super('Refresh session is invalid');
    this.name = 'RefreshSessionRejectedError';
  }
}

@Injectable()
export class RefreshAuthSession {
  constructor(
    @Inject(AUTH_SESSION_REPOSITORY)
    private readonly sessions: AuthSessionRepository,
    @Inject(AUTH_TOKEN_SERVICE)
    private readonly tokens: AuthTokenService,
    private readonly currentUser: GetCurrentUser,
  ) {}

  async execute(refreshToken: string): Promise<AuthSessionVO> {
    if (refreshToken.length === 0 || refreshToken.length > 256) {
      throw new RefreshSessionRejectedError();
    }

    const now = new Date();
    const replacementToken = this.tokens.createRefreshToken();
    const rotation = await this.sessions.rotateRefreshToken({
      currentTokenHash: this.tokens.hashRefreshToken(refreshToken),
      replacementTokenHash: this.tokens.hashRefreshToken(replacementToken),
      now,
    });
    if (rotation.status !== 'rotated') {
      throw new RefreshSessionRejectedError();
    }

    try {
      const currentUser = await this.currentUser.execute(rotation.userId);
      const accessToken = this.tokens.issueAccessToken(
        rotation.userId,
        rotation.sessionId,
        now,
      );
      return {
        accessToken: accessToken.token,
        refreshToken: replacementToken,
        accessTokenExpiresAt: accessToken.expiresAt.toISOString(),
        sessionExpiresAt: rotation.expiresAt.toISOString(),
        currentUser,
      };
    } catch {
      await this.sessions.revokeSession(rotation.sessionId, now);
      throw new RefreshSessionRejectedError();
    }
  }
}
