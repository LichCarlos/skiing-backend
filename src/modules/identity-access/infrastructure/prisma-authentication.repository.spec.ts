import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';
import { PrismaAuthenticationRepository } from './prisma-authentication.repository.js';

function setup(transaction: object) {
  const runTransaction = vi.fn((work: (tx: object) => Promise<unknown>) =>
    work(transaction),
  );
  const prisma = { $transaction: runTransaction } as unknown as PrismaService;
  return {
    repository: new PrismaAuthenticationRepository(prisma, {
      put: vi.fn(),
      remove: vi.fn(),
      createReadUrl: vi.fn(),
    }),
    runTransaction,
  };
}

describe('PrismaAuthenticationRepository refresh rotation', () => {
  it('requires an active database session for each access-token request', async () => {
    const now = new Date('2026-10-27T00:00:00.000Z');
    const findFirst = vi.fn().mockResolvedValue({ SessionId: 'session-id' });
    const prisma = {
      authSession: { findFirst },
    } as unknown as PrismaService;
    const repository = new PrismaAuthenticationRepository(prisma, {
      put: vi.fn(),
      remove: vi.fn(),
      createReadUrl: vi.fn(),
    });

    await expect(
      repository.isActive({
        sessionId: '11111111-1111-4111-8111-111111111111',
        userId: 42,
        now,
      }),
    ).resolves.toBe(true);
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        SessionId: '11111111-1111-4111-8111-111111111111',
        UserId: 42,
        RevokedAt: null,
        ExpiresAt: { gt: now },
      },
      select: { SessionId: true },
    });
  });

  it('consumes the current token and stores the replacement until the absolute session expiry', async () => {
    const sessionExpiry = new Date('2026-11-01T00:00:00.000Z');
    const now = new Date('2026-10-27T00:00:00.000Z');
    const findUnique = vi.fn().mockResolvedValue({
      RefreshTokenId: 9n,
      ConsumedAt: null,
      ExpiresAt: sessionExpiry,
      SessionId: '11111111-1111-4111-8111-111111111111',
      Session: { UserId: 42, ExpiresAt: sessionExpiry, RevokedAt: null },
    });
    const sessionUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const tokenUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const create = vi.fn().mockResolvedValue({});
    const { repository, runTransaction } = setup({
      authRefreshToken: { findUnique, updateMany: tokenUpdateMany, create },
      authSession: { updateMany: sessionUpdateMany },
    });

    await expect(
      repository.rotateRefreshToken({
        currentTokenHash: 'a'.repeat(64),
        replacementTokenHash: 'b'.repeat(64),
        now,
      }),
    ).resolves.toEqual({
      status: 'rotated',
      sessionId: '11111111-1111-4111-8111-111111111111',
      userId: 42,
      expiresAt: sessionExpiry,
    });
    expect(runTransaction).toHaveBeenCalledOnce();
    expect(tokenUpdateMany).toHaveBeenCalledWith({
      where: {
        RefreshTokenId: 9n,
        ConsumedAt: null,
        ExpiresAt: { gt: now },
      },
      data: { ConsumedAt: now },
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        SessionId: '11111111-1111-4111-8111-111111111111',
        TokenHash: 'b'.repeat(64),
        ExpiresAt: sessionExpiry,
        CreateTime: now,
      },
    });
  });

  it('revokes the owning session when a consumed refresh token is replayed', async () => {
    const now = new Date('2026-10-27T00:00:00.000Z');
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const create = vi.fn();
    const { repository } = setup({
      authRefreshToken: {
        findUnique: vi.fn().mockResolvedValue({
          RefreshTokenId: 4n,
          ConsumedAt: new Date('2026-10-26T00:00:00.000Z'),
          ExpiresAt: new Date('2026-11-26T00:00:00.000Z'),
          SessionId: '11111111-1111-4111-8111-111111111111',
          Session: {
            UserId: 42,
            ExpiresAt: new Date('2026-11-26T00:00:00.000Z'),
            RevokedAt: null,
          },
        }),
        updateMany: vi.fn(),
        create,
      },
      authSession: { updateMany },
    });

    await expect(
      repository.rotateRefreshToken({
        currentTokenHash: 'a'.repeat(64),
        replacementTokenHash: 'b'.repeat(64),
        now,
      }),
    ).resolves.toEqual({ status: 'reused' });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        SessionId: '11111111-1111-4111-8111-111111111111',
        RevokedAt: null,
      },
      data: { RevokedAt: now },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('treats a lost compare-and-set race as token reuse and revokes the session', async () => {
    const now = new Date('2026-10-27T00:00:00.000Z');
    const updateMany = vi.fn().mockResolvedValueOnce({ count: 1 });
    const tokenUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
    const { repository } = setup({
      authRefreshToken: {
        findUnique: vi.fn().mockResolvedValue({
          RefreshTokenId: 5n,
          ConsumedAt: null,
          ExpiresAt: new Date('2026-11-26T00:00:00.000Z'),
          SessionId: '11111111-1111-4111-8111-111111111111',
          Session: {
            UserId: 42,
            ExpiresAt: new Date('2026-11-26T00:00:00.000Z'),
            RevokedAt: null,
          },
        }),
        updateMany: tokenUpdateMany,
        create: vi.fn(),
      },
      authSession: { updateMany },
    });

    await expect(
      repository.rotateRefreshToken({
        currentTokenHash: 'a'.repeat(64),
        replacementTokenHash: 'b'.repeat(64),
        now,
      }),
    ).resolves.toEqual({ status: 'reused' });
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(updateMany.mock.calls[1]?.[0]).toMatchObject({
      data: { RevokedAt: now },
    });
  });
});
