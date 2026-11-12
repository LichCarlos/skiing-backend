import { describe, expect, it } from 'vitest';
import {
  INITIAL_ROLE_PERMISSION_TEMPLATES,
  SYSTEM_PERMISSION_DEFINITIONS,
  SYSTEM_ADMIN_ROLE_PERMISSION_KEYS,
} from './permissions.js';

describe('permission catalog', () => {
  it('has unique keys and valid tree parents', () => {
    const keys = new Set(SYSTEM_PERMISSION_DEFINITIONS.map(({ key }) => key));

    expect(keys.size).toBe(SYSTEM_PERMISSION_DEFINITIONS.length);
    const seeded = new Set<string>();
    for (const permission of SYSTEM_PERMISSION_DEFINITIONS) {
      if (permission.parentKey) {
        expect(keys.has(permission.parentKey), permission.key).toBe(true);
        expect(
          seeded.has(permission.parentKey),
          `seed order: ${permission.key}`,
        ).toBe(true);
      }
      seeded.add(permission.key);
    }
  });

  it('exposes editable field and permission catalog capabilities', () => {
    const definitions = new Map(
      SYSTEM_PERMISSION_DEFINITIONS.map((permission) => [
        permission.key,
        permission,
      ]),
    );

    expect(definitions.get('menu:system:fields')?.route).toBe(
      '/admin/system/fields',
    );
    expect(definitions.get('menu:system:permissions')?.route).toBe(
      '/admin/system/permissions',
    );
    for (const key of [
      'system:field:list',
      'system:field:create',
      'system:field:update',
      'system:field:delete',
      'system:field-group:list',
      'system:field-group:create',
      'system:field-group:update',
      'system:field-group:delete',
      'system:permission:list',
      'system:permission:create',
      'system:permission:update',
      'system:permission:delete',
      'system:config:list',
    ]) {
      expect(definitions.has(key), key).toBe(true);
    }
    expect(SYSTEM_ADMIN_ROLE_PERMISSION_KEYS).toContain('system:field:create');
  });

  it('keeps merchant defaults away from platform administration and revenue writes', () => {
    expect(INITIAL_ROLE_PERMISSION_TEMPLATES.merchant).toContain(
      'merchant:dashboard:read',
    );
    expect(SYSTEM_PERMISSION_DEFINITIONS).toContainEqual(
      expect.objectContaining({
        key: 'menu:merchant:dashboard',
        route: '/admin/merchant',
        parentKey: 'menu:merchant',
      }),
    );
    expect(SYSTEM_ADMIN_ROLE_PERMISSION_KEYS).toContain(
      'merchant:dashboard:read',
    );
    expect(INITIAL_ROLE_PERMISSION_TEMPLATES.merchant).not.toContain(
      'revenue:system:upsert',
    );
    expect(
      INITIAL_ROLE_PERMISSION_TEMPLATES.merchant.some((key) =>
        key.startsWith('system:'),
      ),
    ).toBe(false);
  });
});
