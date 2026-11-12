import { describe, expect, it, vi } from 'vitest';
import {
  NotFoundException,
  ForbiddenException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ManageAssets } from './manage-assets.js';
import type { AssetRepository, AssetRecord } from './ports/asset-repository.js';
import type { AssetStorage } from './ports/asset-storage.js';
import type { AssetScanner } from './ports/asset-scanner.js';

const record: AssetRecord = {
  assetId: '12',
  ownerUserId: 42,
  storageKey: 'assets/42/image.png',
  originalName: 'image.png',
  mimeType: 'image/png',
  sizeBytes: '8',
  status: 'pending_scan',
  createdAt: new Date('2026-10-27T00:00:00.000Z'),
};

function setup(scanResult: 'clean' | 'infected' = 'clean') {
  const createPending = vi.fn(async () => record);
  const setStatus = vi.fn(async () => true);
  const findOwnedReady = vi.fn(async (_assetId: string, ownerUserId: number) =>
    ownerUserId === record.ownerUserId
      ? { ...record, status: 'ready' as const }
      : null,
  );
  const deleteIfUnreferenced = vi.fn(async () => true);
  const repository: AssetRepository = {
    createPending,
    setStatus,
    findOwnedReady,
    deleteIfUnreferenced,
  };
  const put = vi.fn(
    async (_input: Parameters<AssetStorage['put']>[0]) => undefined,
  );
  const remove = vi.fn(async (_key: string) => undefined);
  const createReadUrl = vi.fn(async (_key: string, ttl: number) => {
    expect(ttl).toBe(900);
    return 'https://assets.example/signed';
  });
  const storage: AssetStorage = {
    put,
    remove,
    createReadUrl,
  };
  const scan = vi.fn(async () => scanResult);
  const scanner: AssetScanner = { scan };
  return {
    service: new ManageAssets(repository, storage, scanner),
    createPending,
    setStatus,
    findOwnedReady,
    deleteIfUnreferenced,
    put,
    remove,
    createReadUrl,
    scan,
  };
}

describe('ManageAssets', () => {
  it('scans validated image bytes before storing and returns a short-lived read URL', async () => {
    const { service, setStatus, put, scan } = setup();
    const result = await service.upload({
      ownerUserId: 42,
      originalName: '..\\private.png',
      buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    });
    expect(scan).toHaveBeenCalledOnce();
    expect(put).toHaveBeenCalledWith(
      expect.objectContaining({ contentType: 'image/png' }),
    );
    expect(setStatus).toHaveBeenCalledWith('12', 'ready');
    expect(result.url).toBe('https://assets.example/signed');
    expect(result.originalName).not.toContain('\\');
  });

  it('rejects infected files without putting them into object storage', async () => {
    const { service, setStatus, put } = setup('infected');
    await expect(
      service.upload({
        ownerUserId: 42,
        originalName: 'bad.png',
        buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(setStatus).toHaveBeenCalledWith('12', 'rejected');
    expect(put).not.toHaveBeenCalled();
  });

  it('fails closed when the malware scanner is unavailable', async () => {
    const { service, setStatus, put, scan } = setup();
    scan.mockRejectedValue(new Error('clamd is offline'));
    await expect(
      service.upload({
        ownerUserId: 42,
        originalName: 'image.png',
        buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(setStatus).toHaveBeenCalledWith('12', 'rejected');
    expect(put).not.toHaveBeenCalled();
  });

  it('does not reveal assets to another user and blocks deletion when referenced', async () => {
    const { service, deleteIfUnreferenced } = setup();
    await expect(service.get('12', 43)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    deleteIfUnreferenced.mockResolvedValue(false);
    await expect(service.remove('12', 42)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('checks owned read authorization before and after signing the same ready object', async () => {
    const s = setup();
    expect((await s.service.get('12', 42)).url).toBe(
      'https://assets.example/signed',
    );
    expect(s.findOwnedReady).toHaveBeenCalledTimes(2);
    expect(s.findOwnedReady).toHaveBeenNthCalledWith(1, '12', 42, 'read');
    expect(s.findOwnedReady).toHaveBeenNthCalledWith(2, '12', 42, 'read');
    expect(s.createReadUrl).toHaveBeenCalledOnce();
  });

  it('does not sign when current read authorization is denied before lookup', async () => {
    const s = setup(),
      denied = new ForbiddenException();
    s.findOwnedReady.mockRejectedValueOnce(denied);
    await expect(s.service.get('12', 42)).rejects.toBe(denied);
    expect(s.createReadUrl).not.toHaveBeenCalled();
  });

  it('does not return a signed response when read authorization was revoked during signing', async () => {
    const s = setup(),
      denied = new ForbiddenException();
    s.findOwnedReady
      .mockResolvedValueOnce({ ...record, status: 'ready' })
      .mockRejectedValueOnce(denied);
    await expect(s.service.get('12', 42)).rejects.toBe(denied);
    expect(s.createReadUrl).toHaveBeenCalledOnce();
    expect(s.remove).not.toHaveBeenCalled();
  });

  it.each([
    null,
    { ...record, storageKey: 'different-object', status: 'ready' as const },
  ])(
    'does not return an old URL after the asset was removed or rebound %#',
    async (current) => {
      const s = setup();
      s.findOwnedReady
        .mockResolvedValueOnce({ ...record, status: 'ready' })
        .mockResolvedValueOnce(current);
      await expect(s.service.get('12', 42)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(s.createReadUrl).toHaveBeenCalledOnce();
    },
  );

  it('does not delete a physical object when the database command denies current delete permission', async () => {
    const s = setup(),
      denied = new ForbiddenException();
    s.deleteIfUnreferenced.mockRejectedValueOnce(denied);
    await expect(s.service.remove('12', 42)).rejects.toBe(denied);
    expect(s.findOwnedReady).toHaveBeenCalledExactlyOnceWith(
      '12',
      42,
      'delete',
    );
    expect(s.remove).not.toHaveBeenCalled();
    expect(s.createReadUrl).not.toHaveBeenCalled();
  });

  it('uses the delete operation independently of read and completes cleanup after logical commit', async () => {
    const s = setup();
    await expect(s.service.remove('12', 42)).resolves.toBeUndefined();
    expect(s.findOwnedReady).toHaveBeenCalledExactlyOnceWith(
      '12',
      42,
      'delete',
    );
    expect(s.deleteIfUnreferenced).toHaveBeenCalledExactlyOnceWith('12', 42);
    expect(s.remove).toHaveBeenCalledExactlyOnceWith(record.storageKey);
    expect(s.createReadUrl).not.toHaveBeenCalled();
  });

  it('does not scan, store or sign when pending creation denies current upload authorization', async () => {
    const s = setup(),
      denied = new ForbiddenException();
    s.createPending.mockRejectedValue(denied);
    await expect(
      s.service.upload({
        ownerUserId: 42,
        originalName: 'image.png',
        buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      }),
    ).rejects.toBe(denied);
    expect(s.scan).not.toHaveBeenCalled();
    expect(s.put).not.toHaveBeenCalled();
    expect(s.createReadUrl).not.toHaveBeenCalled();
  });

  it('preserves forbidden after ready denial, rejects pending and removes the stored object once', async () => {
    const s = setup(),
      denied = new ForbiddenException();
    s.setStatus.mockRejectedValueOnce(denied);
    await expect(
      s.service.upload({
        ownerUserId: 42,
        originalName: 'image.png',
        buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      }),
    ).rejects.toBe(denied);
    expect(s.setStatus.mock.calls).toEqual([
      ['12', 'ready'],
      ['12', 'rejected'],
    ]);
    expect(s.put).toHaveBeenCalledOnce();
    expect(s.remove).toHaveBeenCalledOnce();
    expect(s.remove).toHaveBeenCalledWith(s.put.mock.calls[0]![0].key);
    expect(s.createReadUrl).not.toHaveBeenCalled();
  });

  it('does not retry or mask denied authorization if cleanup itself is unavailable', async () => {
    const s = setup(),
      denied = new ForbiddenException();
    s.setStatus
      .mockRejectedValueOnce(denied)
      .mockRejectedValueOnce(new Error('Database offline'));
    s.remove.mockRejectedValueOnce(new Error('S3 offline'));
    await expect(
      s.service.upload({
        ownerUserId: 42,
        originalName: 'image.png',
        buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      }),
    ).rejects.toBe(denied);
    expect(s.setStatus).toHaveBeenCalledTimes(2);
    expect(s.put).toHaveBeenCalledOnce();
    expect(s.remove).toHaveBeenCalledOnce();
    expect(s.createReadUrl).not.toHaveBeenCalled();
  });
});
