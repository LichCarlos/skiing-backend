import { Inject, Injectable } from '@nestjs/common';
import { normalizeAccount } from '../domain/registration-rules.js';
import {
  AUTHENTICATION_REPOSITORY,
  type AuthenticationRepository,
} from './ports/authentication-repository.js';
import {
  AUTH_SESSION_REPOSITORY,
  type AuthSessionRepository,
} from './ports/auth-session-repository.js';
import {
  AUTH_TOKEN_SERVICE,
  type AuthTokenService,
} from './ports/auth-token-service.js';
import {
  PASSWORD_HASHER,
  type PasswordHasher,
} from './ports/password-hasher.js';
import { GetCurrentUser, type CurrentUserVO } from './get-current-user.js';
import { ResolveAuthorizationPrincipal } from './resolve-authorization-principal.js';
import { CheckLoginAttempt } from './check-login-attempt.js';

const DUMMY_PASSWORD_HASH =
  '$2b$12$MLGFL5IAaJG9USpGVYbMjunnsr1IH6z5xvvLCTWwyS8iMUgAMRZM.';

export interface AuthSessionVO {
  accessToken?: string;
  refreshToken?: string;
  accessTokenExpiresAt: string;
  sessionExpiresAt: string;
  currentUser: CurrentUserVO;
}

export class AuthenticationRejectedError extends Error {
  constructor() {
    super('Invalid account or password');
    this.name = 'AuthenticationRejectedError';
  }
}

@Injectable()
export class LoginUser {
  constructor(
    @Inject(AUTHENTICATION_REPOSITORY)
    private readonly identities: AuthenticationRepository,
    @Inject(AUTH_SESSION_REPOSITORY)
    private readonly sessions: AuthSessionRepository,
    @Inject(AUTH_TOKEN_SERVICE)
    private readonly tokens: AuthTokenService,
    @Inject(PASSWORD_HASHER)
    private readonly passwordHasher: PasswordHasher,
    private readonly principals: ResolveAuthorizationPrincipal,
    private readonly currentUser: GetCurrentUser,
    private readonly loginAttempts: CheckLoginAttempt,
  ) {}

  async execute(
    input: {
      account: string;
      password: string;
    },
    clientIp: string,
  ): Promise<AuthSessionVO> {
    await this.loginAttempts.execute(input.account, clientIp);
    const identity = await this.identities.findByAccount(
      normalizeAccount(input.account),
    );
    const passwordMatches = await this.passwordHasher.verify(
      input.password,
      identity?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );
    if (
      !identity ||
      !identity.passwordHash ||
      !passwordMatches ||
      identity.status !== 'active'
    ) {
      throw new AuthenticationRejectedError();
    }

    const principal = await this.principals.execute(identity.userId);
    if (!principal?.active) throw new AuthenticationRejectedError();
    const currentUser = await this.currentUser.execute(identity.userId);

    const now = new Date();
    const sessionId = this.tokens.createSessionId();
    const refreshToken = this.tokens.createRefreshToken();
    const refreshExpiresAt = this.tokens.refreshExpiresAt(now);
    const accessToken = this.tokens.issueAccessToken(
      identity.userId,
      sessionId,
      now,
    );

    const created = await this.sessions.create({
      sessionId,
      userId: identity.userId,
      expectedPasswordHash: identity.passwordHash,
      refreshTokenHash: this.tokens.hashRefreshToken(refreshToken),
      expiresAt: refreshExpiresAt,
      now,
    });
    if (!created) throw new AuthenticationRejectedError();

    return {
      accessToken: accessToken.token,
      refreshToken,
      accessTokenExpiresAt: accessToken.expiresAt.toISOString(),
      sessionExpiresAt: refreshExpiresAt.toISOString(),
      currentUser,
    };
  }
}
