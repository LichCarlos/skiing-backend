import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';
import {
  AccountAlreadyRegisteredError,
  ActiveUserRoleUnavailableError,
} from '../application/register-user.js';
import { PrismaUserRegistrationRepository } from './prisma-user-registration.repository.js';

describe('PrismaUserRegistrationRepository', () => {
  it('creates a user and binds only the active built-in user role in one transaction', async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValue({ RoleId: 7, Status: 'active' });
    const create = vi
      .fn()
      .mockResolvedValue({ UserId: 12, Account: 'rider', Nickname: 'Rider' });
    const transaction = { role: { findUnique }, user: { create } };
    const runTransaction = vi.fn(
      (work: (tx: typeof transaction) => Promise<unknown>) => work(transaction),
    );
    const prisma = { $transaction: runTransaction } as unknown as PrismaService;
    const repository = new PrismaUserRegistrationRepository(prisma);

    await expect(
      repository.register({
        account: 'rider',
        nickname: 'Rider',
        passwordHash: 'bcrypt-hash',
      }),
    ).resolves.toEqual({ userId: 12, account: 'rider', nickname: 'Rider' });
    expect(runTransaction).toHaveBeenCalledOnce();
    expect(findUnique).toHaveBeenCalledWith({
      where: { SystemRoleCode: 'registered_user' },
      select: { RoleId: true, Status: true },
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        Account: 'rider',
        PasswordHash: 'bcrypt-hash',
        Nickname: 'Rider',
        UserRoles: {
          create: { Role: { connect: { RoleId: 7 } } },
        },
      },
      select: { UserId: true, Account: true, Nickname: true },
    });
  });

  it.each([null, { RoleId: 7, Status: 'disabled' }])(
    'refuses registration when the built-in user role is unavailable',
    async (role) => {
      const findUnique = vi.fn().mockResolvedValue(role);
      const create = vi.fn();
      const transaction = { role: { findUnique }, user: { create } };
      const prisma = {
        $transaction: (work: (tx: typeof transaction) => Promise<unknown>) =>
          work(transaction),
      } as unknown as PrismaService;
      const repository = new PrismaUserRegistrationRepository(prisma);

      await expect(
        repository.register({
          account: 'rider',
          nickname: 'Rider',
          passwordHash: 'hash',
        }),
      ).rejects.toBeInstanceOf(ActiveUserRoleUnavailableError);
      expect(create).not.toHaveBeenCalled();
    },
  );

  it('maps the database account uniqueness constraint to a stable application error', async () => {
    const transaction = {
      role: {
        findUnique: vi.fn().mockResolvedValue({ RoleId: 7, Status: 'active' }),
      },
      user: {
        create: vi.fn().mockRejectedValue({
          code: 'P2002',
          meta: { target: ['Account'] },
        }),
      },
    };
    const prisma = {
      $transaction: (work: (tx: typeof transaction) => Promise<unknown>) =>
        work(transaction),
    } as unknown as PrismaService;
    const repository = new PrismaUserRegistrationRepository(prisma);

    await expect(
      repository.register({
        account: 'rider',
        nickname: 'Rider',
        passwordHash: 'hash',
      }),
    ).rejects.toBeInstanceOf(AccountAlreadyRegisteredError);
  });

  it('does not mislabel other uniqueness failures as duplicate accounts', async () => {
    const underlyingError = {
      code: 'P2002',
      meta: { target: ['Nickname'] },
    };
    const transaction = {
      role: {
        findUnique: vi.fn().mockResolvedValue({ RoleId: 7, Status: 'active' }),
      },
      user: { create: vi.fn().mockRejectedValue(underlyingError) },
    };
    const prisma = {
      $transaction: (work: (tx: typeof transaction) => Promise<unknown>) =>
        work(transaction),
    } as unknown as PrismaService;
    const repository = new PrismaUserRegistrationRepository(prisma);

    await expect(
      repository.register({
        account: 'rider',
        nickname: 'Rider',
        passwordHash: 'hash',
      }),
    ).rejects.toBe(underlyingError);
  });
});
