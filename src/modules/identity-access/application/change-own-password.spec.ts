import { describe, expect, it, vi } from 'vitest';
import { ChangeOwnPassword } from './change-own-password.js';
import type { SelfPasswordChangeRepository } from './ports/self-password-change-repository.js';
import type { PasswordHasher } from './ports/password-hasher.js';

function setup() {
  const updatePassword = vi.fn(async () => true);
  const repository: SelfPasswordChangeRepository = {
    findPasswordHash: vi.fn(async () => 'old-hash'),
    updatePassword,
  };
  const passwords: PasswordHasher = {
    hash: vi.fn(async () => 'new-hash'),
    verify: vi.fn(async (password) => password === 'old-password'),
  };
  return {
    useCase: new ChangeOwnPassword(repository, passwords),
    updatePassword,
    passwords,
  };
}

describe('ChangeOwnPassword', () => {
  it('updates the hash only after verifying the current password', async () => {
    const { useCase, updatePassword } = setup();
    await useCase.execute({
      userId: 7,
      currentPassword: 'old-password',
      newPassword: 'new-password',
      traceId: 'trace-1',
      clientIp: null,
      userAgent: null,
    });
    expect(updatePassword).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        expectedPasswordHash: 'old-hash',
        passwordHash: 'new-hash',
        traceId: 'trace-1',
      }),
    );
  });

  it('rejects an incorrect current password without changing credentials', async () => {
    const { useCase, updatePassword } = setup();
    await expect(
      useCase.execute({
        userId: 7,
        currentPassword: 'incorrect',
        newPassword: 'new-password',
        traceId: 'trace-1',
        clientIp: null,
        userAgent: null,
      }),
    ).rejects.toMatchObject({ status: 401 });
    expect(updatePassword).not.toHaveBeenCalled();
  });
});
