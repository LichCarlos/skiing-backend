import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';
import { PrismaAdminPasswordResetRepository } from './prisma-admin-password-reset.repository.js';
import { PrismaAuthenticationRepository } from './prisma-authentication.repository.js';
import { authorizeUserWrite } from './user-write-authorization.js';
import { ManagementWriteAuthorizationError } from '../domain/management-write-authorization.js';
import { PasswordResetConflictError } from '../domain/password-reset.js';
vi.mock('./user-write-authorization.js', () => ({
  authorizeUserWrite: vi.fn(),
}));
afterEach(() => vi.resetAllMocks());
const input = {
  userId: 7,
  passwordHash: 'hash',
  reason: 'support',
  audit: { actorUserId: 1, traceId: 'test', clientIp: null, userAgent: null },
  now: new Date(),
};
describe('password reset transaction failure boundaries', () => {
  it.each([
    { code: 'P2034' },
    { code: '40001' },
    { code: '40P01' },
    { code: 'P2010', meta: { code: '40001' } },
    { code: 'P2010', meta: { code: '40P01' } },
  ])('maps serializable/lock conflict %j', async (error) => {
    const repo = new PrismaAdminPasswordResetRepository({
      $transaction: vi.fn().mockRejectedValue(error),
    } as unknown as PrismaService);
    await expect(repo.reset(input)).rejects.toBeInstanceOf(
      PasswordResetConflictError,
    );
  });
  it.each([
    { scope: { kind: 'all' as const }, account: 'admin', isSystemAdmin: false },
    {
      scope: { kind: 'self' as const, userId: 1 },
      account: 'admin',
      isSystemAdmin: true,
    },
  ])(
    'does not touch the target without protected global authority %j',
    async (actor) => {
      vi.mocked(authorizeUserWrite).mockResolvedValue(actor);
      const query = vi.fn();
      const transaction = { $queryRaw: query };
      const repo = new PrismaAdminPasswordResetRepository({
        $transaction: vi.fn(async (work: (value: unknown) => Promise<void>) =>
          work(transaction),
        ),
      } as unknown as PrismaService);
      await expect(repo.reset(input)).rejects.toBeInstanceOf(
        ManagementWriteAuthorizationError,
      );
      expect(query).not.toHaveBeenCalled();
    },
  );
});
describe('session creation credential fencing', () => {
  it.each([0, 1])(
    'only creates a refresh session after the conditional user write succeeds, count=%s',
    async (count) => {
      const updateMany = vi.fn().mockResolvedValue({ count }),
        create = vi.fn();
      const repo = new PrismaAuthenticationRepository(
        {
          $transaction: vi.fn(
            async (work: (value: unknown) => Promise<boolean>) =>
              work({ user: { updateMany }, authSession: { create } }),
          ),
        } as unknown as PrismaService,
        { put: vi.fn(), remove: vi.fn(), createReadUrl: vi.fn() },
      );
      expect(
        await repo.create({
          userId: 7,
          expectedPasswordHash: 'verified',
          sessionId: 'session',
          refreshTokenHash: 'refresh-hash',
          now: input.now,
          expiresAt: input.now,
        }),
      ).toBe(count === 1);
      expect(updateMany).toHaveBeenCalledExactlyOnceWith({
        where: { UserId: 7, Status: 'active', PasswordHash: 'verified' },
        data: { PasswordHash: 'verified' },
      });
      expect(create).toHaveBeenCalledTimes(count);
    },
  );
});
