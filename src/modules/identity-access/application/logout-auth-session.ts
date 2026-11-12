import { Inject, Injectable } from '@nestjs/common';
import {
  AUTH_SESSION_REPOSITORY,
  type AuthSessionRepository,
} from './ports/auth-session-repository.js';
import {
  AUTH_TOKEN_SERVICE,
  type AuthTokenService,
} from './ports/auth-token-service.js';

@Injectable()
export class LogoutAuthSession {
  constructor(
    @Inject(AUTH_SESSION_REPOSITORY)
    private readonly sessions: AuthSessionRepository,
    @Inject(AUTH_TOKEN_SERVICE)
    private readonly tokens: AuthTokenService,
  ) {}

  async execute(refreshToken?: string): Promise<void> {
    if (!refreshToken || refreshToken.length > 256) return;
    await this.sessions.revokeByRefreshTokenHash(
      this.tokens.hashRefreshToken(refreshToken),
      new Date(),
    );
  }
}
