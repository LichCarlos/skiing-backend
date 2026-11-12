import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { PrismaMerchantResortRepository } from './prisma-merchant-resort.repository.js';
import { MerchantResortService } from '../application/merchant-resort-service.js';
import type { PrismaService } from '../../../shared/persistence/prisma.service.js';
import type { AssetStorage } from '../../assets/application/ports/asset-storage.js';
import type { CustomFieldRepository } from '../../platform-administration/application/ports/custom-field-repository.js';
import type { OutboxStore } from '../../integration-events/application/ports/outbox-store.js';

const resortRecord = (status = 'draft') => ({
  ResortId: 901,
  MerchantId: 27,
  Name: '雪峰测试场',
  Province: null,
  City: null,
  District: null,
  Address: null,
  Longitude: null,
  Latitude: null,
  LegacyCoverImage: null,
  LegacyDistance: { toString: () => '0' },
  CoverAssetId: null,
  Rating: null,
  RatingCount: 0,
  Price: 520,
  OpenStatus: 'open',
  SnowCondition: '粉雪',
  SnowConditionUpdatedAt: null,
  OpeningHours: null,
  TrailSummary: null,
  FacilitySummary: null,
  OfficialUrl: null,
  Description: '测试用雪场',
  CustomFields: {},
  SchemaVersion: 1,
  Status: status,
  UpdateTime: new Date('2026-10-27T00:00:00.000Z'),
  DeletedAt: null,
  FitTags: [],
  Gallery: [],
  CoverAsset: null,
});

function setup(
  options: {
    existing?: ReturnType<typeof resortRecord>;
    updatedCount?: number;
    assetResult?: { AssetId: bigint }[];
    transactionAssetResult?: { AssetId: bigint }[];
    activeActor?: boolean;
    fieldSchema?: Awaited<
      ReturnType<CustomFieldRepository['findActiveSchema']>
    >;
    roleFieldPolicies?: Array<{
      Role: {
        FieldPolicies: Array<{
          FieldKey: string;
          CanRead: boolean;
          CanWrite: boolean;
        }>;
      };
    }>;
  } = {},
) {
  const record = options.existing ?? resortRecord();
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    user: {
      findUnique: vi.fn().mockResolvedValue({
        UserId: 11,
        Status: 'active',
        MerchantProfile: { MerchantId: 27, Status: 'active' },
        UserRoles: [
          {
            Role: {
              RoleKey: 'custom_merchant',
              Status: 'active',
              DataScope: 'merchant',
              DataScopes: [],
              RolePermissions: [
                'management:portal:enter',
                'resort:merchant:create',
                'resort:merchant:update',
                'resort:merchant:delete',
                'resort:merchant:submit-review',
              ].map((PermissionKey) => ({
                Permission: { PermissionKey, Status: 'active' },
              })),
            },
          },
        ],
      }),
    },
    customFieldDefinition: { findMany: vi.fn().mockResolvedValue([]) },
    roleFieldPermission: { findMany: vi.fn().mockResolvedValue([]) },
    skiResort: {
      findFirst: vi.fn(async () => record),
      create: vi.fn(async () => ({ ResortId: 901 })),
      updateMany: vi
        .fn()
        .mockResolvedValue({ count: options.updatedCount ?? 1 }),
      findUniqueOrThrow: vi.fn(async () => record),
    },
    resortImage: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    resortFitTag: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    dictionaryItem: { findMany: vi.fn().mockResolvedValue([]) },
    asset: {
      findMany: vi
        .fn()
        .mockResolvedValue(
          options.transactionAssetResult ?? options.assetResult ?? [],
        ),
    },
    merchantProfile: {
      findFirst: vi
        .fn()
        .mockResolvedValue(
          options.activeActor === false
            ? null
            : { User: { Account: 'merchant.account' } },
        ),
    },
    operationLog: { create: vi.fn().mockResolvedValue({}) },
    outboxEvent: { create: vi.fn().mockResolvedValue(undefined) },
  };
  const prisma = {
    skiResort: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      findFirst: vi.fn().mockResolvedValue(options.existing ?? null),
      updateMany: vi
        .fn()
        .mockResolvedValue({ count: options.updatedCount ?? 0 }),
    },
    merchantProfile: tx.merchantProfile,
    asset: { findMany: vi.fn().mockResolvedValue(options.assetResult ?? []) },
    dictionaryItem: { findMany: vi.fn().mockResolvedValue([]) },
    userRole: {
      findMany: vi.fn().mockResolvedValue(options.roleFieldPolicies ?? []),
    },
    $transaction: vi.fn(async (actions: unknown) =>
      Array.isArray(actions)
        ? Promise.all(actions)
        : (actions as (tx: unknown) => unknown)(tx),
    ),
  };
  const storage = { createReadUrl: vi.fn() };
  const fields = {
    findActiveSchema: vi.fn().mockResolvedValue(options.fieldSchema ?? []),
  };
  const outbox = {
    append: vi.fn(async (transaction: unknown, event: unknown) => {
      const txValue = transaction as typeof tx;
      await txValue.outboxEvent.create({ data: event });
    }),
  };
  const service = new MerchantResortService(
    new PrismaMerchantResortRepository(
      prisma as unknown as PrismaService,
      outbox as unknown as OutboxStore,
    ),
    storage as unknown as AssetStorage,
    fields as unknown as CustomFieldRepository,
  );
  return { service, prisma, tx, outbox };
}

const createBody = {
  name: '雪峰测试场',
  price: 520,
  openStatus: 'open',
  snowCondition: '粉雪',
  description: '测试用雪场',
};
const access = {
  userId: 11,
  merchantId: 27,
  scope: { kind: 'merchant' as const, merchantId: 27 },
};
const ownerWhere = {
  MerchantId: 27,
  Merchant: {
    is: { UserId: 11, Status: 'active', User: { Status: 'active' } },
  },
  DeletedAt: null,
};
const audit = {
  traceId: 'merchant-test',
  clientIp: '127.0.0.1',
  userAgent: 'vitest',
};

describe('MerchantResortService tenant boundaries', () => {
  it('returns active custom fields with the effective role grants only', async () => {
    const fieldSchema = [
      {
        entityType: 'ski_resort',
        groupKey: 'operations',
        label: '运营信息',
        sortOrder: 1,
        visibilityRule: null,
        status: 'active' as const,
        createTime: new Date(0),
        updateTime: new Date(0),
        fields: [
          {
            fieldDefinitionId: 1,
            entityType: 'ski_resort',
            fieldKey: 'operatorNote',
            label: '运营备注',
            dataType: 'textarea',
            groupKey: 'operations',
            sortOrder: 1,
            required: false,
            defaultValue: null,
            optionsDictType: null,
            validation: null,
            searchable: false,
            filterable: false,
            sortable: false,
            isPublic: false,
            status: 'active' as const,
            schemaVersion: 1,
            createTime: new Date(0),
            updateTime: new Date(0),
          },
          {
            fieldDefinitionId: 2,
            entityType: 'ski_resort',
            fieldKey: 'privateMemo',
            label: '内部备注',
            dataType: 'text',
            groupKey: 'operations',
            sortOrder: 2,
            required: false,
            defaultValue: null,
            optionsDictType: null,
            validation: null,
            searchable: false,
            filterable: false,
            sortable: false,
            isPublic: false,
            status: 'active' as const,
            schemaVersion: 1,
            createTime: new Date(0),
            updateTime: new Date(0),
          },
        ],
      },
    ];
    const { service } = setup({
      fieldSchema,
      roleFieldPolicies: [
        {
          Role: {
            FieldPolicies: [
              { FieldKey: 'operatorNote', CanRead: true, CanWrite: false },
            ],
          },
        },
        {
          Role: {
            FieldPolicies: [
              { FieldKey: 'operatorNote', CanRead: false, CanWrite: true },
            ],
          },
        },
        {
          Role: {
            FieldPolicies: [
              { FieldKey: 'privateMemo', CanRead: false, CanWrite: false },
            ],
          },
        },
      ],
    });

    await expect(
      service.customFieldSchema({ ...access }),
    ).resolves.toMatchObject({
      entityType: 'ski_resort',
      groups: [
        {
          fields: [{ fieldKey: 'operatorNote', canRead: true, canWrite: true }],
        },
      ],
    });
  });

  it('rejects custom field schema access without a merchant profile', async () => {
    const { service } = setup();

    await expect(
      service.customFieldSchema({ ...access, merchantId: null }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('filters the list by the authenticated merchant and excludes deleted records', async () => {
    const { service, prisma } = setup();

    const result = await service.list({ ...access });

    expect(result).toMatchObject({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });
    expect(prisma.skiResort.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: ownerWhere,
        skip: 0,
        take: 20,
      }),
    );
  });

  it('rejects accounts without an active merchant profile before querying', async () => {
    const { service, prisma } = setup();

    await expect(
      service.list({ ...access, merchantId: null }),
    ).rejects.toMatchObject({
      status: 403,
    });
    expect(prisma.skiResort.findMany).not.toHaveBeenCalled();
  });

  it('maps invalid offset pagination to an HTTP 400 without querying', async () => {
    const { service, prisma } = setup();

    await expect(
      service.list({ ...access, pageSize: 101 }),
    ).rejects.toMatchObject({ status: 400 });
    expect(prisma.skiResort.findMany).not.toHaveBeenCalled();
  });

  it('hides another merchant resort as not found using the principal merchant id', async () => {
    const { service, prisma } = setup();

    await expect(
      service.get({ ...access, resortId: 901 }),
    ).rejects.toMatchObject({ status: 404 });
    expect(prisma.skiResort.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ...ownerWhere, AND: [{ ResortId: 901 }] },
      }),
    );
  });

  it('soft deletes and appends an event in one merchant-scoped transaction', async () => {
    const { service, tx, outbox } = setup();

    await service.remove({ ...access, resortId: 901 }, audit);

    expect(tx.skiResort.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          ...ownerWhere,
          AND: [{ ResortId: 901 }],
          UpdateTime: expect.any(Date),
        },
        data: { DeletedAt: expect.any(Date) },
      }),
    );
    expect(outbox.append).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        eventType: 'resort.changed.v1',
        payload: { resortId: 901, merchantId: 27, status: 'deleted' },
      }),
    );
  });

  it('creates a draft and assigns merchant ownership from the trusted input context', async () => {
    const { service, tx, outbox } = setup();

    await service.create({ ...access, body: createBody }, audit);

    expect(tx.skiResort.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ MerchantId: 27, Status: 'draft' }),
      }),
    );
    expect(tx.skiResort.findFirst).toHaveBeenCalled();
    expect(outbox.append).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        eventType: 'resort.changed.v1',
        aggregateType: 'ski_resort',
        aggregateId: '901',
        payload: { resortId: 901, merchantId: 27, status: 'draft' },
      }),
    );
  });

  it('updates a published resort and moves it to pending review in the same transaction', async () => {
    const existing = resortRecord('published');
    const { service, tx, outbox } = setup({ existing });

    await service.update(
      {
        ...access,
        resortId: 901,
        body: { price: 600 },
      },
      audit,
    );

    expect(tx.skiResort.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          ...ownerWhere,
          AND: [{ ResortId: 901 }],
        }),
        data: expect.objectContaining({ Price: 600, Status: 'pending_review' }),
      }),
    );
    expect(tx.skiResort.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.skiResort.findFirst.mock.invocationCallOrder[0]!,
    );
    expect(outbox.append).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        eventType: 'resort.changed.v1',
        payload: { resortId: 901, merchantId: 27, status: 'pending_review' },
      }),
    );
  });

  it('rejects a repeated review submission without writing', async () => {
    const { service, prisma } = setup({
      existing: resortRecord('pending_review'),
    });

    await expect(
      service.submitReview({ ...access, resortId: 901 }, audit),
    ).rejects.toMatchObject({ status: 409 });
    expect(prisma.skiResort.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a cover asset that is not ready and owned by the current user', async () => {
    const { service, prisma, tx } = setup();

    await expect(
      service.create(
        {
          ...access,
          body: { ...createBody, coverAssetId: '77' },
        },
        audit,
      ),
    ).rejects.toMatchObject({ status: 422 });
    expect(tx.asset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ OwnerUserId: 11, Status: 'ready' }),
      }),
    );
    expect(tx.skiResort.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledOnce();
  });
  it.each([
    undefined,
    { kind: 'self' as const, userId: 12 },
    { kind: 'merchant' as const, merchantId: 28 },
    { kind: 'selected' as const, ids: [] },
    { kind: 'selected' as const, ids: [0] },
  ])(
    'rejects missing or invalid scope before any database access: %j',
    async (scope) => {
      const { service, prisma, tx, outbox } = setup();
      const input = { ...access, scope, resortId: 901, body: createBody };
      for (const call of [
        () => service.list(input),
        () => service.get(input),
        () => service.customFieldSchema(input),
        () => service.create(input, audit),
        () => service.update(input, audit),
        () => service.remove(input, audit),
        () => service.submitReview(input, audit),
      ])
        await expect(call()).rejects.toMatchObject({ status: 403 });
      expect(prisma.skiResort.findFirst).not.toHaveBeenCalled();
      expect(prisma.skiResort.findMany).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(tx.operationLog.create).not.toHaveBeenCalled();
      expect(outbox.append).not.toHaveBeenCalled();
    },
  );

  it.each([{ kind: 'self' as const, userId: 11 }, { kind: 'all' as const }])(
    'keeps account ownership and active profile predicates for %j',
    async (scope) => {
      const { service, prisma } = setup();
      await service.list({ ...access, scope });
      expect(prisma.skiResort.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: ownerWhere }),
      );
      expect(prisma.skiResort.count).toHaveBeenCalledWith({
        where: ownerWhere,
      });
    },
  );

  it('intersects selected IDs with ownership in both list and count before paging', async () => {
    const { service, prisma } = setup();
    await service.list({
      ...access,
      scope: { kind: 'selected', ids: [901, 902] },
      page: 2,
      pageSize: 1,
    });
    const where = { ...ownerWhere, ResortId: { in: [901, 902] } };
    expect(prisma.skiResort.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where, skip: 1, take: 1 }),
    );
    expect(prisma.skiResort.count).toHaveBeenCalledWith({ where });
  });

  it('retains both the selected set and requested target for every record operation', async () => {
    const { service, prisma, tx, outbox } = setup();
    tx.skiResort.findFirst.mockResolvedValueOnce(null as never);
    const input = {
      ...access,
      scope: { kind: 'selected' as const, ids: [902] },
      resortId: 901,
      body: { price: 600 },
    };
    const actor = await tx.user.findUnique();
    Object.assign(actor.UserRoles[0]!.Role, {
      DataScopes: [
        {
          ResourceKey: 'resort',
          ScopeType: 'selected',
          ScopeConfig: { selectedIds: [902] },
        },
      ],
    });
    for (const call of [
      () => service.get(input),
      () => service.update(input, audit),
      () => service.remove(input, audit),
      () => service.submitReview(input, audit),
    ])
      await expect(call()).rejects.toMatchObject({ status: 404 });
    const where = {
      ...ownerWhere,
      ResortId: { in: [902] },
      AND: [{ ResortId: 901 }],
    };
    expect(prisma.skiResort.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where }),
    );
    expect(tx.skiResort.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where }),
    );
    expect(tx.skiResort.updateMany).not.toHaveBeenCalled();
    expect(outbox.append).not.toHaveBeenCalled();
  });

  it('prevents selected creation before validation or writing, but permits its field catalog', async () => {
    const { service, prisma } = setup();
    const input = {
      ...access,
      scope: { kind: 'selected' as const, ids: [901] },
      body: createBody,
    };
    await expect(service.create(input, audit)).rejects.toMatchObject({
      status: 403,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    await expect(service.customFieldSchema(input)).resolves.toMatchObject({
      entityType: 'ski_resort',
    });
  });

  it.each(['create', 'update', 'remove', 'submitReview'] as const)(
    'writes actor audit and outbox inside a serializable %s transaction',
    async (operation) => {
      const { service, prisma, tx, outbox } = setup({
        existing: resortRecord(),
      });
      await service[operation](
        { ...access, resortId: 901, body: createBody },
        audit,
      );
      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: 'Serializable',
      });
      expect(tx.operationLog.create).toHaveBeenCalledOnce();
      expect(tx.operationLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          ActorUserId: 11,
          ActorAccountSnapshot: 'merchant.account',
          ResourceKey: 'resort',
          TargetId: '901',
          Result: 'success',
          TraceId: audit.traceId,
        }),
      });
      expect(outbox.append).toHaveBeenCalledWith(tx, expect.any(Object));
      expect(tx.merchantProfile.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            MerchantId: 27,
            UserId: 11,
            Status: 'active',
            User: { Status: 'active' },
          },
        }),
      );
      if (operation !== 'create')
        expect(tx.skiResort.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              ...ownerWhere,
              AND: [{ ResortId: 901 }],
              UpdateTime: expect.any(Date),
            }),
          }),
        );
    },
  );

  it.each(['create', 'update', 'remove', 'submitReview'] as const)(
    'refuses %s when account/profile is inactive inside the transaction',
    async (operation) => {
      const { service, tx, outbox } = setup({
        existing: resortRecord(),
        activeActor: false,
      });
      await expect(
        service[operation](
          { ...access, resortId: 901, body: createBody },
          audit,
        ),
      ).rejects.toMatchObject({ status: 403 });
      expect(tx.skiResort.create).not.toHaveBeenCalled();
      expect(tx.skiResort.updateMany).not.toHaveBeenCalled();
      expect(tx.operationLog.create).not.toHaveBeenCalled();
      expect(outbox.append).not.toHaveBeenCalled();
    },
  );

  it('rechecks image readiness/ownership inside the transaction before creating', async () => {
    const { service, tx, outbox } = setup({
      assetResult: [{ AssetId: 77n }],
      transactionAssetResult: [],
    });
    await expect(
      service.create(
        { ...access, body: { ...createBody, coverAssetId: '77' } },
        audit,
      ),
    ).rejects.toMatchObject({ status: 422 });
    expect(tx.skiResort.create).not.toHaveBeenCalled();
    expect(outbox.append).not.toHaveBeenCalled();
  });

  it('propagates audit failure to the transaction caller instead of reporting success', async () => {
    const { service, tx } = setup();
    tx.operationLog.create.mockRejectedValueOnce(
      new Error('audit unavailable'),
    );
    await expect(
      service.create({ ...access, body: createBody }, audit),
    ).rejects.toThrow('audit unavailable');
    expect(tx.skiResort.findFirst).not.toHaveBeenCalled();
  });

  it('maps serialization failure to 409 and never blindly retries the stale write', async () => {
    const { service, prisma } = setup();
    prisma.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('serialization conflict', {
        code: 'P2034',
        clientVersion: '6.19.0',
      }),
    );
    await expect(
      service.create({ ...access, body: createBody }, audit),
    ).rejects.toMatchObject({ status: 409 });
    expect(prisma.$transaction).toHaveBeenCalledOnce();
  });

  it.each(['40001', '40P01'])(
    'maps a raw reference lock conflict %s to 409 without retrying stale data',
    async (code) => {
      const { service, tx, prisma } = setup();
      tx.$queryRaw.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('reference changed', {
          code: 'P2010',
          clientVersion: '6.19.0',
          meta: { code },
        }),
      );
      await expect(
        service.create({ ...access, body: createBody }, audit),
      ).rejects.toMatchObject({ status: 409 });
      expect(prisma.$transaction).toHaveBeenCalledOnce();
      expect(tx.skiResort.create).not.toHaveBeenCalled();
      expect(tx.outboxEvent.create).not.toHaveBeenCalled();
      expect(tx.operationLog.create).not.toHaveBeenCalled();
    },
  );
});
