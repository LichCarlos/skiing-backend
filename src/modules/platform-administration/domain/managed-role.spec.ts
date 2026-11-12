import { describe, expect, it } from 'vitest';
import {
  validateCreateManagedRole,
  validateUpdateManagedRole,
} from './managed-role.js';

describe('managed role rules', () => {
  it('accepts normalized role metadata and a supported data scope', () => {
    expect(
      validateCreateManagedRole({
        roleKey: 'resort_operator',
        roleName: '雪场运营',
        description: null,
        dataScope: 'merchant',
      }),
    ).toEqual([]);
  });

  it('rejects invalid keys, reserved system role keys, and empty patches', () => {
    expect(
      validateCreateManagedRole({
        roleKey: 'system_admin',
        roleName: '管理员',
        description: null,
        dataScope: 'all',
      }),
    ).toContain('reserved_role_key');
    expect(validateUpdateManagedRole({ roleKey: 'UpperCase' })).toContain(
      'invalid_role_key',
    );
    expect(validateUpdateManagedRole({})).toContain('empty_role_patch');
    expect(
      validateUpdateManagedRole({
        roleKey: undefined,
        roleName: undefined,
        description: undefined,
        dataScope: undefined,
        status: undefined,
      }),
    ).toContain('empty_role_patch');
  });
});
