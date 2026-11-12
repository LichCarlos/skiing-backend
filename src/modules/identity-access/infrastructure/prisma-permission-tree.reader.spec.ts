import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';
import { PrismaPermissionTreeReader } from './prisma-permission-tree.reader.js';

describe('PrismaPermissionTreeReader', () => {
  it('reads active permission fields in stable order without exposing persistence models', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        PermissionId: 3,
        ParentId: null,
        PermissionKey: 'menu:system',
        PermissionName: '系统管理',
        PermissionType: 'directory',
        Route: null,
        Icon: null,
        SortOrder: 10,
      },
    ]);
    const prisma = { permission: { findMany } } as unknown as PrismaService;
    const reader = new PrismaPermissionTreeReader(prisma);

    await expect(reader.findActivePermissions()).resolves.toEqual([
      {
        permissionId: 3,
        parentId: null,
        permissionKey: 'menu:system',
        permissionName: '系统管理',
        permissionType: 'directory',
        route: null,
        icon: null,
        sortOrder: 10,
      },
    ]);
    expect(findMany).toHaveBeenCalledWith({
      where: { Status: 'active' },
      orderBy: [
        { ParentId: 'asc' },
        { SortOrder: 'asc' },
        { PermissionId: 'asc' },
      ],
      select: {
        PermissionId: true,
        ParentId: true,
        PermissionKey: true,
        PermissionName: true,
        PermissionType: true,
        Route: true,
        Icon: true,
        SortOrder: true,
      },
    });
  });
});
