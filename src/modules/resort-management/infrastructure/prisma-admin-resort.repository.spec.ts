import { PrismaAdminResortRepository } from './prisma-admin-resort.repository.js';
import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import type { OutboxStore } from '../../integration-events/application/ports/outbox-store.js';
import type { PrismaService } from '../../../shared/persistence/prisma.service.js';
import type { AssetStorage } from '../../assets/application/ports/asset-storage.js';
import { AdminResortService } from '../application/admin-resort-service.js';
import type { ResolvedDataScope } from '../../identity-access/domain/authorization.js';

const audit = {
  actorUserId: 3,
  traceId: 'trace-admin-resort',
  clientIp: '127.0.0.1',
  userAgent: 'vitest',
};
const globalScope = { kind: 'all' } as const;

function setup() {
  const events: string[] = [];
  const row = {
    ResortId: 12,
    MerchantId: 8,
    Name: 'Alpine',
    Status: 'published',
    Province: null,
    City: null,
    District: null,
    Address: null,
    Longitude: null,
    Latitude: null,
    CoverAssetId: null,
    Rating: null,
    RatingCount: 0,
    Price: 0,
    OpenStatus: 'unknown',
    SnowCondition: 'powder',
    SnowConditionUpdatedAt: null,
    OpeningHours: null,
    TrailSummary: null,
    FacilitySummary: null,
    OfficialUrl: null,
    Description: 'Alpine resort',
    CustomFields: {},
    UpdateTime: new Date('2026-10-28T00:00:00.000Z'),
    DeletedAt: null,
    FitTags: [],
    Gallery: [],
    CoverAsset: null,
    Merchant: null,
  };
  const tx = {
    skiResort: {
      findFirst: vi.fn(async () => {
        events.push('read');
        return { ...row };
      }),
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        events.push('write');
        Object.assign(row, data);
        return { count: 1 };
      }),
    },
    user: {
      findUnique: vi.fn(async () => {
        events.push('actor');
        return {
          Account: 'admin',
          UserId: 3,
          Status: 'active',
          MerchantProfile: null,
          UserRoles: [
            {
              Role: {
                RoleKey: 'configured_global_role',
                Status: 'active',
                DataScope: 'all',
                RolePermissions: [
                  'management:portal:enter',
                  'content:resort:delete-all',
                  'content:resort:offline',
                ].map((PermissionKey) => ({
                  Permission: { PermissionKey, Status: 'active' },
                })),
                DataScopes: [],
              },
            },
          ],
        };
      }),
    },
    customFieldGroup: { findMany: vi.fn(async () => []) },
    roleFieldPermission: { findMany: vi.fn(async () => []) },
    operationLog: {
      create: vi.fn(async () => {
        events.push('audit');
        return {};
      }),
    },
  };
  const prisma = {
    $transaction: vi.fn(async (work: (transaction: unknown) => unknown) =>
      work(tx),
    ),
  };
  const outbox = {
    append: vi.fn(async (transaction: unknown, event: unknown) => {
      expect(transaction).toBe(tx);
      expect(event).toMatchObject({
        eventType: 'resort.changed.v1',
        aggregateId: '12',
        payload: { merchantId: 8 },
      });
      events.push(
        `outbox:${(event as { payload: { status: string } }).payload.status}`,
      );
    }),
  };
  const service = new AdminResortService(
    new PrismaAdminResortRepository(
      prisma as unknown as PrismaService,
      outbox as unknown as OutboxStore,
    ),
    {} as AssetStorage,
  );
  return { service, tx, outbox, events, prisma };
}

describe('PrismaAdminResortRepository orchestration', () => {
  it.each<ResolvedDataScope | undefined>([
    undefined,
    { kind: 'self', userId: 3 },
    { kind: 'merchant', merchantId: 8 },
    { kind: 'selected', ids: [12] },
  ])(
    'rejects non-global scope before reading, validating, or writing: %j',
    async (scope) => {
      const { service, prisma, tx, outbox, events } = setup();
      const operations = [
        () => service.list({}, scope, 3),
        () => service.get(12, scope, 3),
        () => service.create({}, audit, scope),
        () => service.update(12, {}, audit, scope),
        () => service.remove(12, audit, scope),
        () => service.publish(12, audit, scope),
        () => service.offline(12, audit, scope),
      ];
      for (const operation of operations)
        await expect(operation()).rejects.toMatchObject({ status: 403 });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(tx.operationLog.create).not.toHaveBeenCalled();
      expect(outbox.append).not.toHaveBeenCalled();
      expect(events).toEqual([]);
    },
  );
  it('writes soft-delete, outbox event and actor audit through the same transaction', async () => {
    const { service, tx, outbox, events } = setup();

    await expect(
      service.remove(12, audit, globalScope),
    ).resolves.toBeUndefined();

    expect(tx.skiResort.updateMany).toHaveBeenCalledWith({
      where: {
        ResortId: 12,
        DeletedAt: null,
        UpdateTime: new Date('2026-10-28T00:00:00.000Z'),
      },
      data: { DeletedAt: expect.any(Date) },
    });
    expect(outbox.append).toHaveBeenCalledOnce();
    expect(tx.operationLog.create).toHaveBeenCalledWith({
      data: {
        ActorUserId: 3,
        ActorAccountSnapshot: 'admin',
        ActionKey: 'content:resort:delete-all',
        ResourceKey: 'resort',
        Reason: null,
        TargetType: 'SkiResort',
        TargetId: '12',
        Result: 'success',
        TraceId: 'trace-admin-resort',
        ClientIp: '127.0.0.1',
        UserAgent: 'vitest',
        Metadata: {
          before: { name: 'Alpine', merchantId: 8, status: 'published' },
          after: { deleted: true },
        },
      },
    });
    expect(events).toEqual([
      'actor',
      'read',
      'write',
      'outbox:deleted',
      'actor',
      'audit',
    ]);
  });

  it('writes offline transition, outbox event and actor audit through the same transaction', async () => {
    const { service, tx, outbox, events } = setup();

    await expect(
      service.offline(12, audit, globalScope),
    ).resolves.toMatchObject({
      resortId: 12,
      status: 'offline',
    });

    expect(tx.skiResort.updateMany).toHaveBeenCalledWith({
      where: {
        ResortId: 12,
        DeletedAt: null,
        UpdateTime: new Date('2026-10-28T00:00:00.000Z'),
      },
      data: { Status: 'offline' },
    });
    expect(outbox.append).toHaveBeenCalledOnce();
    expect(tx.operationLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ActionKey: 'content:resort:offline',
        TargetId: '12',
        Metadata: {
          before: { name: 'Alpine', status: 'published' },
          after: { name: 'Alpine', status: 'offline' },
        },
      }),
    });
    expect(events).toEqual([
      'actor',
      'read',
      'write',
      'outbox:offline',
      'read',
      'actor',
      'audit',
      'actor',
    ]);
  });

  it('does not write an audit record when the resort is missing', async () => {
    const { service, tx } = setup();
    tx.skiResort.findFirst.mockResolvedValueOnce(null as never);

    await expect(service.remove(12, audit, globalScope)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(tx.operationLog.create).not.toHaveBeenCalled();
  });

  it('uses Serializable and translates serialization failure without retrying', async () => {
    const { service, prisma, outbox } = setup();
    prisma.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('conflict', {
        code: 'P2034',
        clientVersion: '6.19.0',
      }),
    );
    await expect(service.remove(12, audit, globalScope)).rejects.toMatchObject({
      status: 409,
    });
    expect(prisma.$transaction).toHaveBeenCalledExactlyOnceWith(
      expect.any(Function),
      { isolationLevel: 'Serializable' },
    );
    expect(outbox.append).not.toHaveBeenCalled();
  });
  it('rejects a stale version before appending an event or audit', async () => {
    const { service, tx, outbox } = setup();
    tx.skiResort.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.remove(12, audit, globalScope)).rejects.toMatchObject({
      status: 409,
    });
    expect(outbox.append).not.toHaveBeenCalled();
    expect(tx.operationLog.create).not.toHaveBeenCalled();
  });
  it.each(['40001', '40P01'])(
    'translates raw PostgreSQL %s without retrying',
    async (code) => {
      const { service, prisma, outbox } = setup();
      prisma.$transaction.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('raw conflict', {
          code: 'P2010',
          clientVersion: '6.19.0',
          meta: { code },
        }),
      );
      await expect(
        service.remove(12, audit, globalScope),
      ).rejects.toMatchObject({ status: 409 });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(outbox.append).not.toHaveBeenCalled();
    },
  );
});

describe('PrismaAdminResortRepository reference validation', () => {
  function setupReferences() {
    const tx = {
      $queryRaw: vi.fn(async () => []),
      user: {
        findUnique: vi.fn(async () => ({
          UserId: 3,
          Status: 'active',
          MerchantProfile: null,
          UserRoles: [
            {
              Role: {
                RoleKey: 'asset_admin',
                Status: 'active',
                DataScope: 'all',
                RolePermissions: [
                  'management:portal:enter',
                  'content:asset:list',
                ].map((PermissionKey) => ({
                  Permission: { PermissionKey, Status: 'active' },
                })),
                DataScopes: [],
              },
            },
          ],
        })),
      },
      merchantProfile: { findFirst: vi.fn(async () => ({ MerchantId: 8 })) },
      asset: {
        findMany: vi.fn(async () => [{ AssetId: 90n }, { AssetId: 91n }]),
      },
      dictionaryItem: { findMany: vi.fn(async () => [{ Value: 'beginner' }]) },
    };
    const prisma = {
      $transaction: vi.fn(async (work: (tx: unknown) => unknown) => work(tx)),
    };
    return {
      repository: new PrismaAdminResortRepository(
        prisma as unknown as PrismaService,
        {} as OutboxStore,
      ),
      tx,
    };
  }
  const relations = {
    coverAssetId: '90',
    galleryAssetIds: ['90', '91'],
    fitTagValues: ['beginner'],
  };
  it('validates active merchant/account, deduplicated ready images, and active tag/type inside the transaction', async () => {
    const { repository, tx } = setupReferences();
    await repository.runWrite((tx) => tx.assertReferences(3, 8, relations));
    expect(tx.merchantProfile.findFirst).toHaveBeenCalledWith({
      where: { MerchantId: 8, Status: 'active', User: { Status: 'active' } },
      select: { MerchantId: true },
    });
    expect(tx.asset.findMany).toHaveBeenCalledWith({
      where: {
        AssetId: { in: [90n, 91n] },
        Status: 'ready',
        MimeType: { in: ['image/jpeg', 'image/png', 'image/webp'] },
      },
      select: { AssetId: true },
    });
    expect(tx.dictionaryItem.findMany).toHaveBeenCalledWith({
      where: {
        DictType: 'resort.fit_tag',
        Value: { in: ['beginner'] },
        Status: 'active',
        Type: { Status: 'active' },
      },
      select: { Value: true },
    });
  });
  it.each(['merchant', 'asset', 'tag'] as const)(
    'rejects missing or inactive %s references',
    async (kind) => {
      const { repository, tx } = setupReferences();
      if (kind === 'merchant')
        tx.merchantProfile.findFirst.mockResolvedValueOnce(null as never);
      if (kind === 'asset') tx.asset.findMany.mockResolvedValueOnce([]);
      if (kind === 'tag') tx.dictionaryItem.findMany.mockResolvedValueOnce([]);
      await expect(
        repository.runWrite((tx) => tx.assertReferences(3, 8, relations)),
      ).rejects.toMatchObject({ status: 422 });
    },
  );
});
