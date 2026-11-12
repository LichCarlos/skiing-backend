import { normalizeAccount } from '../domain/registration-rules.js';

export interface InitialAdminCredentials {
  account: string;
  password: string;
}

export function parseInitialAdminCredentials(
  account: string | undefined,
  password: string | undefined,
): InitialAdminCredentials | null {
  const normalizedAccount = account ? normalizeAccount(account) : '';
  const hasAccount = normalizedAccount.length > 0;
  const hasPassword = typeof password === 'string' && password.length > 0;

  if (!hasAccount && !hasPassword) return null;
  if (!hasAccount || !hasPassword || password?.trim().length === 0) {
    throw new Error(
      'INITIAL_ADMIN_ACCOUNT and INITIAL_ADMIN_PASSWORD must be configured together',
    );
  }
  if (Array.from(normalizedAccount).length > 50) {
    throw new Error('INITIAL_ADMIN_ACCOUNT must be at most 50 characters');
  }

  return { account: normalizedAccount, password };
}
