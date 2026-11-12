import { describe, expect, it, vi } from 'vitest';
import type { AuthenticationIdentityRecord } from './ports/authentication-repository.js';
import type { AuthenticationRepository } from './ports/authentication-repository.js';
import type { AuthSessionRepository } from './ports/auth-session-repository.js';
import type { AuthTokenService } from './ports/auth-token-service.js';
import type { PasswordHasher } from './ports/password-hasher.js';
import type { ResolveAuthorizationPrincipal } from './resolve-authorization-principal.js';
import type { GetCurrentUser } from './get-current-user.js';
import { AuthenticationRejectedError, LoginUser } from './login-user.js';
import { RefreshAuthSession } from './refresh-auth-session.js';
import { LogoutAuthSession } from './logout-auth-session.js';
import {
  CheckLoginAttempt,
  LoginRateLimitExceededError,
  LoginLimitUnavailableError,
} from './check-login-attempt.js';

const identity: AuthenticationIdentityRecord = {
  userId: 12,
  account: 'rider',
  nickname: 'Rider',
  avatarUrl: null,
  status: 'active',
  passwordHash: 'bcrypt-hash',
  merchant: null,
  roles: [],
};

const currentUser = {
  userId: 12,
  account: 'rider',
  nickname: 'Rider',
  avatarUrl: null,
  roles: [],
  permissionKeys: [],
  menuTree: [],
  merchant: null,
};

function setup() {
  const findByAccount = vi.fn().mockResolvedValue(identity);
  const findByUserId = vi.fn().mockResolvedValue(identity);
  const authentication: AuthenticationRepository = {
    findByAccount,
    findByUserId,
  };
  const createSession = vi.fn().mockResolvedValue(true);
  const rotateRefreshToken = vi.fn().mockResolvedValue({
    status: 'rotated',
    sessionId: '11111111-1111-4111-8111-111111111111',
    userId: 12,
    expiresAt: new Date('2026-11-26T00:00:00.000Z'),
  });
  const revokeByRefreshTokenHash = vi.fn().mockResolvedValue(undefined);
  const revokeSession = vi.fn().mockResolvedValue(undefined);
  const sessions: AuthSessionRepository = {
    create: createSession,
    isActive: vi.fn().mockResolvedValue(true),
    rotateRefreshToken,
    revokeByRefreshTokenHash,
    revokeSession,
  };
  const createRefreshToken = vi
    .fn()
    .mockReturnValueOnce('refresh-one')
    .mockReturnValue('refresh-two');
  const tokens: AuthTokenService = {
    createSessionId: vi
      .fn()
      .mockReturnValue('11111111-1111-4111-8111-111111111111'),
    createRefreshToken,
    hashRefreshToken: vi.fn((token) => `hash:${token}`),
    refreshExpiresAt: vi.fn((now) => new Date(now.getTime() + 1000)),
    issueAccessToken: vi.fn(() => ({
      token: 'access-token',
      expiresAt: new Date('2026-10-27T00:15:00.000Z'),
    })),
    verifyAccessToken: vi.fn().mockReturnValue(null),
  };
  const verifyPassword = vi.fn().mockResolvedValue(true);
  const passwordHasher: PasswordHasher = {
    hash: vi.fn().mockResolvedValue('hash'),
    verify: verifyPassword,
  };
  const principals = {
    execute: vi.fn().mockResolvedValue({ userId: 12, active: true }),
  } as unknown as ResolveAuthorizationPrincipal;
  const readCurrentUser = vi.fn().mockResolvedValue(currentUser);
  const getCurrentUser = {
    execute: readCurrentUser,
  } as unknown as GetCurrentUser;
  const consume = vi.fn().mockResolvedValue({ allowed: true });
  return {
    authentication,
    findByAccount,
    sessions,
    createSession,
    rotateRefreshToken,
    revokeByRefreshTokenHash,
    revokeSession,
    tokens,
    createRefreshToken,
    passwordHasher,
    verifyPassword,
    principals,
    getCurrentUser,
    readCurrentUser,
    consume,
    login: new LoginUser(
      authentication,
      sessions,
      tokens,
      passwordHasher,
      principals,
      getCurrentUser,
      new CheckLoginAttempt({ consume }),
    ),
    refresh: new RefreshAuthSession(sessions, tokens, getCurrentUser),
    logout: new LogoutAuthSession(sessions, tokens),
  };
}

describe('authentication session use cases', () => {
  it('rejects credentials changed or disabled before session creation commits', async () => {
    const context = setup();
    context.createSession.mockResolvedValueOnce(false);
    await expect(
      context.login.execute(
        { account: 'rider', password: 'valid-pass' },
        '192.0.2.1',
      ),
    ).rejects.toBeInstanceOf(AuthenticationRejectedError);
    expect(context.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ expectedPasswordHash: 'bcrypt-hash' }),
    );
  });
  it('normalizes login accounts and creates a hashed-refresh session', async () => {
    const context = setup();

    await expect(
      context.login.execute(
        { account: ' Rider ', password: 'valid-pass' },
        '192.0.2.1',
      ),
    ).resolves.toMatchObject({
      accessToken: 'access-token',
      refreshToken: 'refresh-one',
      currentUser,
    });
    expect(context.findByAccount).toHaveBeenCalledWith('rider');
    expect(context.consume).toHaveBeenCalledWith('rider', '192.0.2.1');
    expect(context.consume.mock.invocationCallOrder[0]).toBeLessThan(
      context.findByAccount.mock.invocationCallOrder[0]!,
    );
    expect(context.verifyPassword).toHaveBeenCalledWith(
      'valid-pass',
      'bcrypt-hash',
    );
    expect(context.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 12,
        sessionId: '11111111-1111-4111-8111-111111111111',
        refreshTokenHash: 'hash:refresh-one',
      }),
    );
  });

  it('uses the same rejection for missing users and incorrect passwords', async () => {
    const context = setup();
    context.findByAccount.mockResolvedValue(null);

    await expect(
      context.login.execute(
        { account: 'unknown', password: 'valid-pass' },
        '192.0.2.1',
      ),
    ).rejects.toMatchObject({ name: 'AuthenticationRejectedError' });
    expect(context.verifyPassword).toHaveBeenCalledOnce();
    expect(context.createSession).not.toHaveBeenCalled();

    context.findByAccount.mockResolvedValue(identity);
    context.verifyPassword.mockResolvedValue(false);
    await expect(
      context.login.execute(
        { account: 'rider', password: 'wrong-pass' },
        '192.0.2.1',
      ),
    ).rejects.toMatchObject({ name: 'AuthenticationRejectedError' });
    expect(context.createSession).not.toHaveBeenCalled();
  });

  it.each(['limit', 'storage'] as const)(
    'rejects %s before identity, bcrypt or session work',
    async (mode) => {
      const context = setup();
      if (mode === 'limit')
        context.consume.mockResolvedValue({
          allowed: false,
          retryAfterSeconds: 32,
        });
      else
        context.consume.mockRejectedValue(
          new Error('private database details'),
        );
      await expect(
        context.login.execute(
          { account: ' Rider ', password: 'secret' },
          '192.0.2.1',
        ),
      ).rejects.toBeInstanceOf(
        mode === 'limit'
          ? LoginRateLimitExceededError
          : LoginLimitUnavailableError,
      );
      expect(context.findByAccount).not.toHaveBeenCalled();
      expect(context.verifyPassword).not.toHaveBeenCalled();
      expect(context.createSession).not.toHaveBeenCalled();
    },
  );

  it('rotates a valid refresh token and revokes a session when its user is no longer active', async () => {
    const context = setup();
    context.createRefreshToken.mockReset().mockReturnValue('refresh-two');

    await expect(context.refresh.execute('refresh-one')).resolves.toMatchObject(
      {
        accessToken: 'access-token',
        refreshToken: 'refresh-two',
        currentUser,
      },
    );
    expect(context.rotateRefreshToken).toHaveBeenCalledWith({
      currentTokenHash: 'hash:refresh-one',
      replacementTokenHash: 'hash:refresh-two',
      now: expect.any(Date),
    });

    context.readCurrentUser.mockRejectedValueOnce(new Error('inactive'));
    await expect(context.refresh.execute('refresh-one')).rejects.toMatchObject({
      name: 'RefreshSessionRejectedError',
    });
    expect(context.revokeSession).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      expect.any(Date),
    );
  });

  it('rejects a replayed token and treats logout without a token as idempotent', async () => {
    const context = setup();
    context.rotateRefreshToken.mockResolvedValue({
      status: 'reused',
    });

    await expect(context.refresh.execute('old-token')).rejects.toMatchObject({
      name: 'RefreshSessionRejectedError',
    });
    await expect(context.logout.execute()).resolves.toBeUndefined();
    expect(context.revokeByRefreshTokenHash).not.toHaveBeenCalled();
  });
});
