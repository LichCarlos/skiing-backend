import type { InitialAdminCredentials } from './initial-admin-credentials.js';
import type { PasswordHasher } from './ports/password-hasher.js';

export interface InitialAdminRoleBinding {
  roleKey: string;
  status: string;
}

export interface ExistingAdminAccount {
  status: string;
  roles: readonly InitialAdminRoleBinding[];
}

export interface InitialAdminCreation {
  account: string;
  passwordHash: string;
  nickname: string;
  systemAdminRoleId: number;
}

export interface InitialAdminBootstrapRepository {
  findByAccount(account: string): Promise<ExistingAdminAccount | null>;
  createSystemAdmin(input: InitialAdminCreation): Promise<void>;
}

export async function ensureInitialSystemAdmin(
  credentials: InitialAdminCredentials,
  systemAdminRoleId: number,
  repository: InitialAdminBootstrapRepository,
  passwordHasher: PasswordHasher,
): Promise<'created' | 'already-configured'> {
  if (!Number.isSafeInteger(systemAdminRoleId) || systemAdminRoleId < 1) {
    throw new Error('Invalid system_admin role ID');
  }

  const existing = await repository.findByAccount(credentials.account);
  if (existing) {
    const hasExclusiveActiveSystemAdminRole =
      existing.status === 'active' &&
      existing.roles.length === 1 &&
      existing.roles[0]?.roleKey === 'system_admin' &&
      existing.roles[0].status === 'active';
    if (!hasExclusiveActiveSystemAdminRole) {
      throw new Error(
        'Configured initial administrator already exists without an exclusive active system_admin role; refusing implicit promotion',
      );
    }
    return 'already-configured';
  }

  const passwordHash = await passwordHasher.hash(credentials.password);
  await repository.createSystemAdmin({
    account: credentials.account,
    passwordHash,
    nickname: 'System Administrator',
    systemAdminRoleId,
  });
  return 'created';
}
