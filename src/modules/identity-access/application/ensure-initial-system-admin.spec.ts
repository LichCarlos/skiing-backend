import { describe, expect, it, vi } from 'vitest';
import {
  ensureInitialSystemAdmin,
  type InitialAdminBootstrapRepository,
} from './ensure-initial-system-admin.js';
import type { InitialAdminCredentials } from './initial-admin-credentials.js';
import type { PasswordHasher } from './ports/password-hasher.js';

const credentials: InitialAdminCredentials = {
  account: 'bootstrap-admin',
  password: 'secret password',
};

function createDependencies(
  existing: Awaited<
    ReturnType<InitialAdminBootstrapRepository['findByAccount']>
  > = null,
) {
  const findByAccount = vi.fn().mockResolvedValue(existing);
  const createSystemAdmin = vi.fn().mockResolvedValue(undefined);
  const repository: InitialAdminBootstrapRepository = {
    findByAccount,
    createSystemAdmin,
  };
  const hash = vi.fn().mockResolvedValue('bcrypt-hash');
  const passwordHasher: PasswordHasher = {
    hash,
    verify: vi.fn(),
  };
  return { repository, passwordHasher, findByAccount, createSystemAdmin, hash };
}

describe('ensureInitialSystemAdmin', () => {
  it('creates a system admin with a hash, never the plaintext password', async () => {
    const { repository, passwordHasher, createSystemAdmin, hash } =
      createDependencies();

    await expect(
      ensureInitialSystemAdmin(credentials, 3, repository, passwordHasher),
    ).resolves.toBe('created');
    expect(hash).toHaveBeenCalledWith(credentials.password);
    expect(createSystemAdmin).toHaveBeenCalledWith({
      account: credentials.account,
      passwordHash: 'bcrypt-hash',
      nickname: 'System Administrator',
      systemAdminRoleId: 3,
    });
  });

  it('is idempotent for an existing exclusive active system admin', async () => {
    const { repository, passwordHasher, createSystemAdmin, hash } =
      createDependencies({
        status: 'active',
        roles: [{ roleKey: 'system_admin', status: 'active' }],
      });

    await expect(
      ensureInitialSystemAdmin(credentials, 3, repository, passwordHasher),
    ).resolves.toBe('already-configured');
    expect(hash).not.toHaveBeenCalled();
    expect(createSystemAdmin).not.toHaveBeenCalled();
  });

  it.each([
    { status: 'active', roles: [] },
    { status: 'active', roles: [{ roleKey: 'user', status: 'active' }] },
    {
      status: 'active',
      roles: [{ roleKey: 'system_admin', status: 'disabled' }],
    },
    {
      status: 'disabled',
      roles: [{ roleKey: 'system_admin', status: 'active' }],
    },
    {
      status: 'active',
      roles: [
        { roleKey: 'system_admin', status: 'active' },
        { roleKey: 'user', status: 'active' },
      ],
    },
  ])(
    'refuses to promote or repair an existing account implicitly',
    async (existing) => {
      const { repository, passwordHasher, createSystemAdmin, hash } =
        createDependencies(existing);

      await expect(
        ensureInitialSystemAdmin(credentials, 3, repository, passwordHasher),
      ).rejects.toThrow('refusing implicit promotion');
      expect(hash).not.toHaveBeenCalled();
      expect(createSystemAdmin).not.toHaveBeenCalled();
    },
  );

  it('rejects an invalid system admin role ID', async () => {
    const { repository, passwordHasher, findByAccount } = createDependencies();

    await expect(
      ensureInitialSystemAdmin(credentials, 0, repository, passwordHasher),
    ).rejects.toThrow('Invalid system_admin role ID');
    expect(findByAccount).not.toHaveBeenCalled();
  });
});
