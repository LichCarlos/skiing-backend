import { describe, expect, it } from 'vitest';
import { parseInitialAdminCredentials } from './initial-admin-credentials.js';

describe('parseInitialAdminCredentials', () => {
  it('skips bootstrap when both values are unset or empty', () => {
    expect(parseInitialAdminCredentials(undefined, undefined)).toBeNull();
    expect(parseInitialAdminCredentials('', '')).toBeNull();
  });

  it('requires both account and password when bootstrap is requested', () => {
    expect(() => parseInitialAdminCredentials('admin', undefined)).toThrow(
      'INITIAL_ADMIN_ACCOUNT and INITIAL_ADMIN_PASSWORD must be configured together',
    );
    expect(() => parseInitialAdminCredentials(undefined, 'secret')).toThrow(
      'INITIAL_ADMIN_ACCOUNT and INITIAL_ADMIN_PASSWORD must be configured together',
    );
  });

  it('rejects blank passwords and oversized account names', () => {
    expect(() => parseInitialAdminCredentials('admin', '   ')).toThrow();
    expect(() =>
      parseInitialAdminCredentials('a'.repeat(51), 'secret'),
    ).toThrow('INITIAL_ADMIN_ACCOUNT must be at most 50 characters');
  });

  it('trims the account but preserves the exact password', () => {
    expect(parseInitialAdminCredentials(' Admin ', ' Pass word ')).toEqual({
      account: 'admin',
      password: ' Pass word ',
    });
  });
});
