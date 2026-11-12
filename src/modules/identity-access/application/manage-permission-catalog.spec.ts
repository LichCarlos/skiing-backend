import { describe, expect, it, vi } from 'vitest';
import { ManagePermissionCatalog } from './manage-permission-catalog.js';
import type { PermissionCatalogRepository } from './ports/permission-catalog-repository.js';

const audit = {
  actorUserId: 7,
  traceId: 'trace-permission-catalog',
  clientIp: null,
  userAgent: null,
};

describe('ManagePermissionCatalog', () => {
  it('only creates custom directory, menu, or button entries', async () => {
    const create = vi.fn(
      async ({ permission }: { permission: unknown }) => permission,
    );
    const repository = {
      findTree: vi.fn(async () => []),
      create,
      update: vi.fn(),
      disable: vi.fn(),
      sync: vi.fn(),
    } as unknown as PermissionCatalogRepository;
    const service = new ManagePermissionCatalog(repository);

    await expect(
      service.create({
        body: {
          permissionKey: 'content:article:publish',
          permissionName: '手工伪造 API grant',
          permissionType: 'api',
        },
        audit,
      }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      service.create({
        body: {
          permissionKey: 'menu:custom:news',
          permissionName: '自定义菜单',
          permissionType: 'menu',
        },
        audit,
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(create).not.toHaveBeenCalled();
  });

  it('normalizes a custom menu key and validates optional values', async () => {
    const create = vi.fn(
      async ({ permission }: { permission: unknown }) => permission,
    );
    const repository = {
      findTree: vi.fn(async () => []),
      create,
      update: vi.fn(),
      disable: vi.fn(),
      sync: vi.fn(),
    } as unknown as PermissionCatalogRepository;
    const service = new ManagePermissionCatalog(repository);

    await service.create({
      body: {
        permissionKey: 'custom:menu.news',
        permissionName: '  内容菜单  ',
        permissionType: 'directory',
      },
      audit,
    });

    expect(create).toHaveBeenCalledWith({
      permission: expect.objectContaining({
        permissionKey: 'custom:menu.news',
        permissionName: '内容菜单',
        permissionType: 'directory',
        parentId: null,
        route: null,
        sortOrder: 0,
        visible: true,
      }),
      audit,
    });
  });
});
