import { describe, expect, it, vi } from 'vitest';
import type { PermissionTreeReader } from './ports/permission-tree-reader.js';
import { GetPermissionTree } from './get-permission-tree.js';

describe('GetPermissionTree', () => {
  it('loads persisted permissions and returns the domain tree', async () => {
    const findActivePermissions = vi.fn().mockResolvedValue([
      {
        permissionId: 2,
        parentId: 1,
        permissionKey: 'system:user:list',
        permissionName: '查询用户',
        permissionType: 'api',
        route: null,
        icon: null,
        sortOrder: 10,
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
    ]);
    const reader = { findActivePermissions } satisfies PermissionTreeReader;
    const useCase = new GetPermissionTree(reader);

    await expect(useCase.execute()).resolves.toMatchObject([
      {
        permissionId: 1,
        children: [{ permissionId: 2, permissionKey: 'system:user:list' }],
      },
    ]);
    expect(findActivePermissions).toHaveBeenCalledOnce();
  });
});
