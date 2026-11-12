import { describe, expect, it } from 'vitest';
import {
  buildPermissionTree,
  type PermissionTreeRecord,
} from './permission-tree.js';

const records: PermissionTreeRecord[] = [
  {
    permissionId: 3,
    parentId: 1,
    permissionKey: 'system:user:list',
    permissionName: '查询用户',
    permissionType: 'api',
    route: null,
    icon: null,
    sortOrder: 20,
  },
  {
    permissionId: 2,
    parentId: null,
    permissionKey: 'menu:system:roles',
    permissionName: '角色权限',
    permissionType: 'menu',
    route: '/admin/system/roles',
    icon: 'key',
    sortOrder: 20,
  },
  {
    permissionId: 1,
    parentId: null,
    permissionKey: 'menu:system',
    permissionName: '系统管理',
    permissionType: 'directory',
    route: null,
    icon: null,
    sortOrder: 10,
  },
  {
    permissionId: 4,
    parentId: 1,
    permissionKey: 'system:user:update',
    permissionName: '更新用户',
    permissionType: 'api',
    route: null,
    icon: null,
    sortOrder: 10,
  },
];

describe('buildPermissionTree', () => {
  it('builds a stable, nested tree ordered by sort order and ID', () => {
    expect(buildPermissionTree(records)).toEqual([
      {
        permissionId: 1,
        parentId: null,
        permissionKey: 'menu:system',
        permissionName: '系统管理',
        permissionType: 'directory',
        route: null,
        icon: null,
        children: [
          {
            permissionId: 4,
            parentId: 1,
            permissionKey: 'system:user:update',
            permissionName: '更新用户',
            permissionType: 'api',
            route: null,
            icon: null,
            children: [],
          },
          {
            permissionId: 3,
            parentId: 1,
            permissionKey: 'system:user:list',
            permissionName: '查询用户',
            permissionType: 'api',
            route: null,
            icon: null,
            children: [],
          },
        ],
      },
      {
        permissionId: 2,
        parentId: null,
        permissionKey: 'menu:system:roles',
        permissionName: '角色权限',
        permissionType: 'menu',
        route: '/admin/system/roles',
        icon: 'key',
        children: [],
      },
    ]);
  });

  it('fails closed for orphaned, cyclic, duplicate, or unsupported records', () => {
    expect(() =>
      buildPermissionTree([{ ...records[0]!, permissionId: 5, parentId: 999 }]),
    ).toThrow('Missing permission parent');
    expect(() =>
      buildPermissionTree([
        { ...records[0]!, permissionId: 5, parentId: 6 },
        { ...records[0]!, permissionId: 6, parentId: 5 },
      ]),
    ).toThrow('cycle without a root');
    expect(() => buildPermissionTree([records[0]!, records[0]!])).toThrow(
      'Duplicate permission ID',
    );
    expect(() =>
      buildPermissionTree([{ ...records[0]!, permissionType: 'unknown' }]),
    ).toThrow('Unsupported permission type');
  });
});
