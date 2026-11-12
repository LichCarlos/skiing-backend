import { describe, expect, it, vi } from 'vitest';
import { AdminResortService } from './admin-resort-service.js';
import type { AdminResortRecord } from './admin-resort-models.js';
import type {
  AdminResortRepository,
  AdminResortTransaction,
} from './ports/admin-resort-repository.js';
import type { AssetStorage } from '../../assets/application/ports/asset-storage.js';

const audit = {
  actorUserId: 3,
  traceId: 'trace',
  clientIp: null,
  userAgent: null,
};
const scope = { kind: 'all' } as const;
function setup() {
  let record: AdminResortRecord = {
    resortId: 12,
    merchantId: 8,
    merchantName: 'Alpine merchant',
    name: 'Alpine',
    province: null,
    city: null,
    district: null,
    address: null,
    longitude: null,
    latitude: null,
    coverAssetId: '90',
    coverStorageKey: 'cover',
    gallery: [],
    fitTags: [],
    rating: '4.5',
    ratingCount: 2,
    price: 100,
    openStatus: 'open',
    snowCondition: 'powder',
    snowConditionUpdatedAt: null,
    openingHours: null,
    trailSummary: null,
    facilitySummary: null,
    officialUrl: null,
    description: 'Alpine resort',
    customFields: {},
    status: 'published',
    updatedAt: new Date('2026-10-28T00:00:00Z'),
  };
  const steps: string[] = [];
  const tx = {
    authorize: vi.fn(async () => undefined),
    fieldContext: vi.fn(
      async (): Promise<
        Awaited<ReturnType<AdminResortTransaction['fieldContext']>>
      > => ({
        definitions: [],
        policies: new Map(),
        dictionaryValues: new Map(),
      }),
    ),
    find: vi.fn(async () => record),
    assertReferences: vi.fn(async () => {
      steps.push('references');
    }),
    create: vi.fn(async () => 12),
    update: vi.fn(async (_id, _version, change) => {
      steps.push('write');
      record = {
        ...record,
        ...change.values,
        ...(change.status ? { status: change.status } : {}),
      };
      return true;
    }),
    replaceRelations: vi.fn(async () => {
      steps.push('relations');
    }),
    appendChanged: vi.fn(async () => {
      steps.push('event');
    }),
    audit: vi.fn(async () => {
      steps.push('audit');
    }),
  } satisfies AdminResortTransaction;
  const repository = {
    find: vi.fn(async () => record),
    findPage: vi.fn(async () => ({ items: [record], total: 1 })),
    findCustomFieldSchema: vi.fn(async () => ({
      groups: [],
      policies: new Map(),
    })),
    async runWrite<T>(
      work: (tx: AdminResortTransaction) => Promise<T>,
    ): Promise<T> {
      return work(tx);
    },
  } satisfies AdminResortRepository;
  const storage = {
    createReadUrl: vi.fn(async () => {
      steps.push('sign');
      return 'signed';
    }),
  };
  const service = new AdminResortService(
    repository,
    storage as unknown as AssetStorage,
  );
  return { service, repository, tx, storage, steps, getRecord: () => record };
}
describe('AdminResortService application ports', () => {
  it('edits published content without changing publication and signs assets after audit', async () => {
    const { service, tx, steps } = setup();
    await expect(
      service.update(12, { price: 200 }, audit, scope),
    ).resolves.toMatchObject({ price: 200, status: 'published' });
    expect(tx.update).toHaveBeenCalledWith(
      12,
      new Date('2026-10-28T00:00:00Z'),
      { values: expect.objectContaining({ price: 200, rating: 4.5 }) },
    );
    expect(tx.appendChanged).toHaveBeenCalledWith(12, 8, 'published');
    expect(tx.assertReferences).toHaveBeenCalledWith(
      3,
      8,
      {
        coverAssetId: '90',
        galleryAssetIds: [],
        fitTagValues: [],
      },
      { requireAssetAssociationPermission: false },
    );
    expect(tx.audit).toHaveBeenCalledWith(
      audit,
      expect.objectContaining({
        metadata: expect.objectContaining({ changedFields: ['price'] }),
      }),
    );
    expect(steps).toEqual([
      'references',
      'write',
      'relations',
      'event',
      'audit',
      'sign',
    ]);
  });
  it('does not write when transaction reference validation fails', async () => {
    const { service, tx, storage } = setup();
    tx.assertReferences.mockRejectedValueOnce(
      new Error('asset no longer ready'),
    );
    await expect(
      service.update(12, { price: 200 }, audit, scope),
    ).rejects.toThrow('asset no longer ready');
    expect(tx.update).not.toHaveBeenCalled();
    expect(tx.audit).not.toHaveBeenCalled();
    expect(storage.createReadUrl).not.toHaveBeenCalled();
  });
  it('preserves an unreadable field on a partial update without returning it', async () => {
    const { service, tx, getRecord } = setup();
    tx.fieldContext.mockResolvedValueOnce({
      definitions: [
        {
          fieldKey: 'internalNote',
          dataType: 'text',
          required: false,
          status: 'active',
          validation: null,
          optionsDictType: null,
        },
      ],
      policies: new Map([
        ['internalNote', { canRead: false, canWrite: false }],
      ]),
      dictionaryValues: new Map(),
    } as never);
    getRecord().customFields = { internalNote: 'merchant-only' };
    const result = await service.update(12, { price: 250 }, audit, scope);
    expect(tx.update).toHaveBeenCalledWith(12, expect.any(Date), {
      values: expect.objectContaining({
        customFields: { internalNote: 'merchant-only' },
      }),
    });
    expect(result.customFields).toEqual([]);
  });
  it('rejects writes to fields absent from the effective write policy', async () => {
    const { service, tx } = setup();
    tx.fieldContext.mockResolvedValueOnce({
      definitions: [
        {
          fieldKey: 'internalNote',
          dataType: 'text',
          required: false,
          status: 'active',
          validation: null,
          optionsDictType: null,
        },
      ],
      policies: new Map([['internalNote', { canRead: true, canWrite: false }]]),
      dictionaryValues: new Map(),
    } as never);
    await expect(
      service.update(
        12,
        { customFields: { internalNote: 'changed' } },
        audit,
        scope,
      ),
    ).rejects.toMatchObject({ status: 422 });
    expect(tx.update).not.toHaveBeenCalled();
  });
  it('does not sign assets when audit fails', async () => {
    const { service, tx, storage } = setup();
    tx.audit.mockRejectedValueOnce(new Error('audit unavailable'));
    await expect(service.offline(12, audit, scope)).rejects.toThrow(
      'audit unavailable',
    );
    expect(storage.createReadUrl).not.toHaveBeenCalled();
  });
  it('rejects republishing published content before mutation', async () => {
    const { service, tx } = setup();
    await expect(service.publish(12, audit, scope)).rejects.toMatchObject({
      status: 409,
    });
    expect(tx.update).not.toHaveBeenCalled();
    expect(tx.appendChanged).not.toHaveBeenCalled();
  });
});
