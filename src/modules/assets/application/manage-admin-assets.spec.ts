import { describe, expect, it, vi } from 'vitest';
import {
  ForbiddenException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type {
  AdminAssetRecord,
  AdminAssetRepository,
} from './ports/admin-asset-repository.js';
import type { AssetStorage } from './ports/asset-storage.js';
import { ManageAdminAssets } from './manage-admin-assets.js';

const asset: AdminAssetRecord = {
  assetId: '42',
  ownerUserId: 9,
  ownerAccount: 'uploader',
  storageKey: 'assets/9/42.webp',
  originalName: 'slope.webp',
  mimeType: 'image/webp',
  sizeBytes: '2048',
  status: 'ready',
  createdAt: new Date('2026-10-27T00:00:00.000Z'),
  references: {
    coverResorts: 0,
    resortImages: 0,
    articleCovers: 0,
    dynamicImages: 0,
    userAvatars: 0,
  },
};

function setup(references = asset.references) {
  const findPage = vi
    .fn()
    .mockResolvedValue({ items: [{ ...asset, references }], total: 1 });
  const findById = vi.fn().mockResolvedValue({ ...asset, references });
  const deleteIfUnreferencedAdmin = vi.fn().mockResolvedValue('deleted');
  const verifyReadAccess = vi.fn().mockResolvedValue(undefined);
  const repository = {
    verifyReadAccess,
    findPage,
    findById,
    deleteIfUnreferencedAdmin,
  } as unknown as AdminAssetRepository;
  const createReadUrl = vi.fn().mockResolvedValue('https://assets.test/signed');
  const remove = vi.fn().mockResolvedValue(undefined);
  const storage = { createReadUrl, remove } as unknown as AssetStorage;
  return {
    service: new ManageAdminAssets(repository, storage),
    verifyReadAccess,
    findPage,
    findById,
    deleteIfUnreferencedAdmin,
    createReadUrl,
    remove,
  };
}

describe('ManageAdminAssets', () => {
  for (const operation of ['list', 'get'] as const) {
    const read = (s: ReturnType<typeof setup>) =>
      operation === 'list'
        ? s.service.list({}, access, 3)
        : s.service.get('42', access, 3);
    it(`${operation} checks current access before reads and after signing`, async () => {
      const s = setup();
      await read(s);
      expect(s.verifyReadAccess).toHaveBeenNthCalledWith(1, {
        actorUserId: 3,
        access,
        assets: [],
      });
      expect(s.verifyReadAccess).toHaveBeenNthCalledWith(2, {
        actorUserId: 3,
        access,
        assets: [asset],
      });
      expect(s.verifyReadAccess.mock.invocationCallOrder[0]).toBeLessThan(
        s.createReadUrl.mock.invocationCallOrder[0]!,
      );
      expect(s.verifyReadAccess.mock.invocationCallOrder[1]).toBeGreaterThan(
        s.createReadUrl.mock.invocationCallOrder[0]!,
      );
    });
    it(`${operation} rejects revoked access before querying or signing`, async () => {
      const s = setup();
      s.verifyReadAccess.mockRejectedValue(new ForbiddenException());
      await expect(read(s)).rejects.toMatchObject({ status: 403 });
      expect(s.findPage).not.toHaveBeenCalled();
      expect(s.findById).not.toHaveBeenCalled();
      expect(s.createReadUrl).not.toHaveBeenCalled();
    });
    it.each([new ForbiddenException(), new NotFoundException()])(
      `${operation} withholds signed response after final rejection %s`,
      async (error) => {
        const s = setup();
        s.verifyReadAccess
          .mockResolvedValueOnce(undefined)
          .mockRejectedValueOnce(error);
        await expect(read(s)).rejects.toBe(error);
        expect(s.createReadUrl).toHaveBeenCalledOnce();
        expect(s.remove).not.toHaveBeenCalled();
      },
    );
  }
  it('rechecks an empty inventory instead of leaking its total after revocation', async () => {
    const s = setup();
    s.findPage.mockResolvedValue({ items: [], total: 0 });
    s.verifyReadAccess
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new ForbiddenException());
    await expect(s.service.list({}, access, 3)).rejects.toMatchObject({
      status: 403,
    });
    expect(s.verifyReadAccess).toHaveBeenCalledTimes(2);
    expect(s.createReadUrl).not.toHaveBeenCalled();
  });
  it.each([new ForbiddenException(), new ConflictException()])(
    'preserves transactional rejection without removing storage',
    async (error) => {
      const s = setup();
      s.deleteIfUnreferencedAdmin.mockRejectedValue(error);
      await expect(s.service.remove('42', audit, access)).rejects.toBe(error);
      expect(s.deleteIfUnreferencedAdmin).toHaveBeenCalledTimes(1);
      expect(s.remove).not.toHaveBeenCalled();
    },
  );
  it('returns an offset-paginated inventory with references and private signed URLs', async () => {
    const { service, findPage, createReadUrl } = setup();

    await expect(
      service.list({ page: '2', pageSize: '10', status: 'ready' }, access, 3),
    ).resolves.toMatchObject({
      items: [
        {
          assetId: '42',
          ownerAccount: 'uploader',
          url: 'https://assets.test/signed',
        },
      ],
      total: 1,
      page: 2,
      pageSize: 10,
      hasNext: false,
    });
    expect(findPage).toHaveBeenCalledWith({
      access,
      skip: 10,
      take: 10,
      status: 'ready',
    });
    expect(createReadUrl).toHaveBeenCalledWith(asset.storageKey, 900);
  });

  it('rejects invalid page limits', async () => {
    const { service, findPage } = setup();
    await expect(
      service.list({ pageSize: 101 }, access, 3),
    ).rejects.toMatchObject({
      status: 400,
    });
    expect(findPage).not.toHaveBeenCalled();
  });

  it.each([
    { page: Number.MAX_SAFE_INTEGER, pageSize: 100 },
    { ownerUserId: 2_147_483_648 },
  ])(
    'rejects database integer overflow before repository access',
    async (query) => {
      const { service, findPage } = setup();
      await expect(service.list(query, access, 3)).rejects.toMatchObject({
        status: 400,
      });
      expect(findPage).not.toHaveBeenCalled();
    },
  );

  it.each(['9223372036854775808', '99999999999999999999999999999999999', '01'])(
    'rejects invalid asset ID %s before database access',
    async (id) => {
      const { service, findById } = setup();
      await expect(service.get(id, access, 3)).rejects.toMatchObject({
        status: 400,
      });
      await expect(service.remove(id, audit, access)).rejects.toMatchObject({
        status: 400,
      });
      expect(findById).not.toHaveBeenCalled();
    },
  );

  it('blocks deletion of referenced assets before changing storage', async () => {
    const { service, deleteIfUnreferencedAdmin, remove } = setup({
      ...asset.references,
      resortImages: 1,
    });
    await expect(service.remove('42', audit, access)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(deleteIfUnreferencedAdmin).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('soft-deletes an unreferenced asset then removes its private object', async () => {
    const { service, deleteIfUnreferencedAdmin, remove } = setup();
    await expect(service.remove('42', audit, access)).resolves.toBeUndefined();
    expect(deleteIfUnreferencedAdmin).toHaveBeenCalledWith({
      assetId: '42',
      access,
      ...audit,
    });
    expect(remove).toHaveBeenCalledWith(asset.storageKey);
  });

  it('does not delete storage when a previously visible asset leaves scope', async () => {
    const { service, deleteIfUnreferencedAdmin, remove } = setup();
    deleteIfUnreferencedAdmin.mockResolvedValue('not_found');
    await expect(service.remove('42', audit, access)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(remove).not.toHaveBeenCalled();
  });

  it('returns not found for a missing asset', async () => {
    const { service, findById } = setup();
    findById.mockResolvedValue(null);
    await expect(service.get('42', access, 3)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

const audit = {
  actorUserId: 3,
  traceId: 'trace-1',
  clientIp: '127.0.0.1',
  userAgent: 'vitest',
};

const access = { kind: 'all' } as const;
