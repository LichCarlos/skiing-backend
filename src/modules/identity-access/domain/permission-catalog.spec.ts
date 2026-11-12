import { describe, expect, it } from 'vitest';
import {
  buildPermissionCatalog,
  permissionSource,
} from './permission-catalog.js';
import type { PermissionCatalogRow } from './permission-catalog.js';

const row = (
  permissionId: number,
  parentId: number | null,
  permissionKey: string,
  permissionType = 'menu',
): PermissionCatalogRow => ({
  permissionId,
  parentId,
  permissionKey,
  permissionName: permissionKey,
  permissionType,
  route: null,
  icon: null,
  sortOrder: permissionId,
  visible: true,
  status: 'active',
});

describe('permission catalog tree', () => {
  it('builds a sorted tree and derives source from the code registry', () => {
    const tree = buildPermissionCatalog([
      row(3, 2, 'custom:button.save', 'button'),
      row(2, 1, 'menu:system:users'),
      row(1, null, 'menu:system', 'directory'),
    ]);

    expect(tree[0]).toMatchObject({
      permissionKey: 'menu:system',
      source: 'code',
      children: [
        {
          permissionKey: 'menu:system:users',
          source: 'code',
          children: [{ permissionKey: 'custom:button.save', source: 'custom' }],
        },
      ],
    });
    expect(permissionSource('system:permission:create')).toBe('code');
    expect(permissionSource('custom:button.save')).toBe('custom');
  });

  it('rejects dangling parents and cyclic records', () => {
    expect(() => buildPermissionCatalog([row(1, 99, 'custom:menu.x')])).toThrow(
      'Missing permission parent',
    );
    expect(() =>
      buildPermissionCatalog([
        row(1, 2, 'custom:menu.x'),
        row(2, 1, 'custom:menu.y'),
      ]),
    ).toThrow('Permission tree contains a cycle');
  });
});
