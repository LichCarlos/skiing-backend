import { MerchantResortService } from './merchant-resort-service.js';
import type { MerchantResortRecord } from './merchant-resort-models.js';
import type {
  MerchantResortRepository,
  MerchantResortTransaction,
} from './ports/merchant-resort-repository.js';
import type { AssetStorage } from '../../assets/application/ports/asset-storage.js';
import type { CustomFieldRepository } from '../../platform-administration/application/ports/custom-field-repository.js';

const access = {
  userId: 11,
  merchantId: 27,
  scope: { kind: 'self' as const, userId: 11 },
};
const audit = { traceId: 'application-test', clientIp: null, userAgent: null };
const body = {
  name: 'Resort',
  price: 100,
  openStatus: 'open',
  snowCondition: 'powder',
  description: 'Description',
};
const record: MerchantResortRecord = {
  resortId: 901,
  merchantId: 27,
  name: 'Resort',
  province: null,
  city: null,
  district: null,
  address: null,
  longitude: '120.1234567',
  latitude: '30.1234567',
  coverAssetId: null,
  coverStorageKey: null,
  gallery: [],
  fitTags: [],
  rating: '4.5',
  ratingCount: 10,
  price: 100,
  openStatus: 'open',
  snowCondition: 'powder',
  snowConditionUpdatedAt: null,
  openingHours: null,
  trailSummary: null,
  facilitySummary: null,
  officialUrl: null,
  description: 'Description',
  customFields: {},
  status: 'draft',
  updatedAt: new Date('2026-10-29T00:00:00Z'),
};

function setup(existing = record) {
  let inTransaction = false;
  const tx = {
    authorize: vi.fn(async () => 'account'),
    fieldContext: vi.fn(async () => ({
      definitions: [],
      policies: new Map(),
      dictionaryValues: new Map(),
    })),
    requireActiveActor: vi.fn(async () => 'account'),
    find: vi.fn(async () => existing),
    assertReferences: vi.fn(async () => undefined),
    create: vi.fn(async () => 901),
    update: vi.fn(async () => true),
    replaceRelations: vi.fn(async () => undefined),
    appendChanged: vi.fn(async () => undefined),
    audit: vi.fn(async () => undefined),
  };
  const repo = {
    findPage: vi.fn(async () => ({ items: [existing], total: 1 })),
    find: vi.fn(async () => existing),
    requireActiveActor: vi.fn(async () => 'account'),
    fieldGrants: vi.fn(async () => []),
    runWrite: vi.fn(
      async <T>(
        work: (transaction: MerchantResortTransaction) => Promise<T>,
      ) => {
        inTransaction = true;
        try {
          return await work(tx);
        } finally {
          inTransaction = false;
        }
      },
    ),
  };
  const storage = {
    createReadUrl: vi.fn(async () => {
      expect(inTransaction).toBe(false);
      return 'https://example.test/signed';
    }),
  };
  const fields = { findActiveSchema: vi.fn(async () => []) };
  const service = new MerchantResortService(
    repo as MerchantResortRepository,
    storage as unknown as AssetStorage,
    fields as unknown as CustomFieldRepository,
  );
  return { service, repo, tx, storage };
}

describe('Merchant resort application through business ports', () => {
  it('rejects invalid scope before consulting any port', async () => {
    const { service, repo } = setup();
    const input = { ...access, scope: undefined, resortId: 901, body };
    for (const call of [
      () => service.list(input),
      () => service.get(input),
      () => service.create(input, audit),
      () => service.update(input, audit),
      () => service.remove(input, audit),
      () => service.submitReview(input, audit),
    ])
      await expect(call()).rejects.toMatchObject({ status: 403 });
    for (const method of Object.values(repo))
      expect(method).not.toHaveBeenCalled();
  });

  it('publishes no event or audit when a concurrent update loses its version check', async () => {
    const { service, tx } = setup({ ...record, status: 'published' });
    tx.update.mockResolvedValue(false);
    await expect(
      service.update({ ...access, resortId: 901, body: { price: 200 } }, audit),
    ).rejects.toMatchObject({ status: 409 });
    expect(tx.appendChanged).not.toHaveBeenCalled();
    expect(tx.audit).not.toHaveBeenCalled();
    expect(tx.replaceRelations).not.toHaveBeenCalled();
  });

  it('uses the domain review rule and keeps the scope and version in the transaction command', async () => {
    const { service, tx } = setup({ ...record, status: 'published' });
    await service.update(
      { ...access, resortId: 901, body: { price: 200 } },
      audit,
    );
    expect(tx.update).toHaveBeenCalledWith(
      expect.objectContaining(access),
      901,
      record.updatedAt,
      {
        values: expect.objectContaining({ price: 200 }),
        status: 'pending_review',
      },
    );
    expect(tx.appendChanged).toHaveBeenCalledWith(901, 27, 'pending_review');
    expect(tx.audit).toHaveBeenCalledWith(
      11,
      'account',
      audit,
      expect.objectContaining({
        changedFields: ['price'],
        before: expect.objectContaining({ status: 'published' }),
        after: expect.objectContaining({ status: 'pending_review' }),
      }),
    );
  });

  it('retains omitted media and tags, and replaces them only when explicitly supplied', async () => {
    const existing = {
      ...record,
      gallery: [{ assetId: '77', sortOrder: 0, storageKey: 'private/77' }],
      fitTags: ['beginner'],
    };
    const { service, tx } = setup(existing);
    await service.update(
      { ...access, resortId: 901, body: { price: 200 } },
      audit,
    );
    expect(tx.assertReferences).toHaveBeenCalledWith(11, {
      coverAssetId: null,
      galleryAssetIds: ['77'],
      fitTagValues: ['beginner'],
    });
    expect(tx.replaceRelations).toHaveBeenLastCalledWith(901, {});
    await service.update(
      {
        ...access,
        resortId: 901,
        body: { galleryAssetIds: [], fitTagValues: [] },
      },
      audit,
    );
    expect(tx.replaceRelations).toHaveBeenLastCalledWith(901, {
      galleryAssetIds: [],
      fitTagValues: [],
    });
  });

  it('waits for audit success before projecting signed URLs', async () => {
    const { service, tx, storage } = setup({
      ...record,
      coverAssetId: '77',
      coverStorageKey: 'private/77',
    });
    tx.audit.mockRejectedValueOnce(new Error('audit failed'));
    await expect(service.create({ ...access, body }, audit)).rejects.toThrow(
      'audit failed',
    );
    expect(storage.createReadUrl).not.toHaveBeenCalled();
    await expect(
      service.create({ ...access, body }, audit),
    ).resolves.toMatchObject({
      coverUrl: 'https://example.test/signed',
      longitude: '120.1234567',
      rating: '4.5',
    });
    expect(storage.createReadUrl).toHaveBeenCalledWith('private/77', 900);
  });

  it('rejects a repeated review submission without starting a write transaction', async () => {
    const { service, repo } = setup({ ...record, status: 'pending_review' });
    await expect(
      service.submitReview({ ...access, resortId: 901 }, audit),
    ).rejects.toMatchObject({ status: 409 });
    expect(repo.runWrite).not.toHaveBeenCalled();
  });
});
