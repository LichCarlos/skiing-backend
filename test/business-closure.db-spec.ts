import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/shared/persistence/prisma.service.js';
import { ManageMerchantProfiles } from '../src/modules/identity-access/application/manage-merchant-profiles.js';
import { PrismaMerchantProfileRepository } from '../src/modules/identity-access/infrastructure/prisma-merchant-profile.repository.js';
import { PrismaBusinessQueryReader } from '../src/modules/platform-administration/infrastructure/prisma-business-query.reader.js';
import { PrismaRagSourceReader } from '../src/modules/ai-assistant/infrastructure/prisma-rag-source.reader.js';
import { PrismaRagDocumentWriter } from '../src/modules/ai-assistant/infrastructure/prisma-rag-document-writer.js';
import { PrismaRagMaintenance } from '../src/modules/ai-assistant/infrastructure/prisma-rag-maintenance.js';
import { PrismaAssetMaintenance } from '../src/modules/assets/infrastructure/prisma-asset-maintenance.js';
import { PrismaInboxExecutor } from '../src/modules/integration-events/infrastructure/prisma-inbox.executor.js';
import { RagDependencyEventHandler } from '../src/modules/integration-events/infrastructure/rag-dependency-event-handler.js';
import { currentPublicRagSource } from '../src/modules/ai-assistant/infrastructure/rag-source-visibility.sql.js';
import { Prisma } from '@prisma/client';

// Run exclusively against a disposable, migrated and seeded PostgreSQL cluster.
// Database, pgvector and Inbox are real. Only storage failure is injected here;
// the native acceptance runner separately uses MinIO and ClamAV.
describe('business closure: PostgreSQL transactions, public query and maintenance', () => {
  const db = new PrismaService(),
    prefix = `closure_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const profiles = new ManageMerchantProfiles(
    new PrismaMerchantProfileRepository(db),
  );
  const reader = new PrismaBusinessQueryReader(db);
  let admin: number, user: number, resort: number, field: number;
  const traceIds: string[] = [];
  const audit = () => ({
    actorUserId: admin,
    traceId: (() => {
      const id = randomUUID();
      traceIds.push(id);
      return id;
    })(),
    clientIp: null,
    userAgent: null,
  });
  beforeAll(async () => {
    if (!process.env.DATABASE_URL)
      throw Error('Dedicated migrated DB required');
    await db.$connect();
    admin = (
      await db.user.findFirstOrThrow({
        where: {
          UserRoles: {
            some: {
              Role: { SystemRoleCode: 'system_admin', Status: 'active' },
            },
          },
          Status: 'active',
        },
      })
    ).UserId;
    user = (
      await db.user.create({
        data: {
          Account: prefix,
          Nickname: '闭环验收',
          PasswordHash: 'test-only-not-a-login',
        },
      })
    ).UserId;
    await db.customFieldGroup.create({
      data: {
        EntityType: 'ski_resort',
        GroupKey: prefix,
        Label: '测试公开字段',
      },
    });
    field = (
      await db.customFieldDefinition.create({
        data: {
          EntityType: 'ski_resort',
          GroupKey: prefix,
          FieldKey: prefix,
          Label: '测试坡度',
          DataType: 'integer',
          Status: 'active',
          IsPublic: true,
          Searchable: false,
          Filterable: true,
          Sortable: true,
        },
      })
    ).FieldDefinitionId;
    resort = (
      await db.skiResort.create({
        data: {
          Name: prefix,
          LegacyDistance: 0,
          Price: 120,
          SnowCondition: '压雪',
          Description: '验收合成资料',
          Status: 'published',
          CustomFields: { [prefix]: 5, internal_secret: 'never public' },
        },
      })
    ).ResortId;
  });
  afterAll(async () => {
    const docs = await db.ragDocument.findMany({
      where: { SourceKey: `resort:${resort}` },
      select: { RagDocumentId: true },
    });
    const assets = await db.asset.findMany({
      where: { OwnerUserId: user },
      select: { AssetId: true },
    });
    await db.operationLog.deleteMany({
      where: {
        OR: [
          { TraceId: { in: traceIds } },
          {
            TargetType: 'RagDocument',
            TargetId: { in: docs.map((d) => String(d.RagDocumentId)) },
          },
          {
            TargetType: 'Asset',
            TargetId: { in: assets.map((a) => String(a.AssetId)) },
          },
        ],
      },
    });
    await db.outboxEvent.deleteMany({
      where: { AggregateId: String(resort), EventType: 'resort.changed.v1' },
    });
    await db.ragDocument.deleteMany({
      where: { SourceKey: `resort:${resort}` },
    });
    await db.skiResort.deleteMany({ where: { ResortId: resort } });
    await db.asset.deleteMany({ where: { OwnerUserId: user } });
    await db.merchantProfile.deleteMany({ where: { UserId: user } });
    await db.user.deleteMany({ where: { UserId: user } });
    await db.customFieldDefinition.deleteMany({
      where: { FieldDefinitionId: field },
    });
    await db.customFieldGroup.deleteMany({
      where: { EntityType: 'ski_resort', GroupKey: prefix },
    });
    await db.$disconnect();
  });
  it('creates a profile without granting roles, rejects duplicates and stale writes, preserves published resorts on disable', async () => {
    expect(await profiles.read(user, admin)).toBeNull();
    const created = await profiles.write({
      userId: user,
      kind: 'create',
      patch: { businessName: '  闭环商家  ', contact: '电话' },
      reason: '  资料核对  ',
      audit: audit(),
    });
    expect(created).toMatchObject({
      businessName: '闭环商家',
      version: 1,
      status: 'active',
    });
    expect(await db.userRole.count({ where: { UserId: user } })).toBe(0);
    await expect(profiles.read(user, user)).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      profiles.write({
        userId: user,
        kind: 'create',
        patch: { businessName: '重复' },
        reason: '重复创建',
        audit: audit(),
      }),
    ).rejects.toMatchObject({ status: 409 });
    const patched = await profiles.write({
      userId: user,
      kind: 'update',
      expectedVersion: 1,
      patch: { contact: null },
      reason: '清除联系信息',
      audit: audit(),
    });
    expect(patched).toMatchObject({ contact: null, version: 2 });
    await expect(
      profiles.write({
        userId: user,
        kind: 'update',
        expectedVersion: 1,
        patch: { businessName: '旧版本' },
        reason: '过期请求',
        audit: audit(),
      }),
    ).rejects.toMatchObject({ status: 409 });
    await db.skiResort.update({
      where: { ResortId: resort },
      data: { MerchantId: created.merchantId },
    });
    const disabled = await profiles.write({
      userId: user,
      kind: 'status',
      expectedVersion: 2,
      status: 'disabled',
      patch: {},
      reason: '停用核对',
      audit: audit(),
    });
    expect(disabled.version).toBe(3);
    expect(
      (await db.skiResort.findUniqueOrThrow({ where: { ResortId: resort } }))
        .Status,
    ).toBe('published');
    const log = await db.operationLog.findFirstOrThrow({
      where: {
        TargetType: 'MerchantProfile',
        TargetId: String(created.merchantId),
        ActionKey: 'system:merchant-profile:create',
      },
    });
    expect(log.Reason).toBe('资料核对');
    expect(JSON.stringify(log.Metadata)).not.toContain('电话');
  });
  it('uses typed public JSON filters and real COUNT while excluding unknown/private fields and SQL injection', async () => {
    const result = await reader.query('ski_resort', {
      keyword: prefix,
      pageSize: 1,
      filters: [
        { field: `custom.${prefix}`, op: 'gte', value: 5 },
        { field: 'price', op: 'lte', value: 130 },
      ],
      sort: { field: `custom.${prefix}`, direction: 'desc' },
    });
    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      id: resort,
      customFields: { [prefix]: 5 },
    });
    expect(JSON.stringify(result)).not.toContain('internal_secret');
    await expect(
      reader.query('ski_resort', {
        filters: [
          { field: 'custom.internal_secret', op: 'eq', value: 'never public' },
        ],
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(
      (await reader.query('ski_resort', { keyword: "' OR 1=1 --" })).total,
    ).toBe(0);
    await db.customFieldDefinition.update({
      where: { FieldDefinitionId: field },
      data: { IsPublic: false },
    });
    expect(
      (await reader.fields('ski_resort')).some(
        (f) => f.key === `custom.${prefix}`,
      ),
    ).toBe(false);
    await db.customFieldDefinition.update({
      where: { FieldDefinitionId: field },
      data: { IsPublic: true },
    });
  });
  it('matches source snapshot SQL, rejects changed field definitions, previews then clears stale content and fences old workers', async () => {
    const source = await new PrismaRagSourceReader(db).findResort(resort);
    expect(source?.sourceState).toBeDefined();
    const writer = new PrismaRagDocumentWriter(db);
    const document = {
      sourceKey: `resort:${resort}`,
      sourceType: 'resort' as const,
      sourceId: resort,
      title: prefix,
      content: '旧索引正文',
      accessScope: 'public' as const,
      merchantId: null,
      sourceUpdatedAt: source!.updatedAt,
      sourceState: source!.sourceState,
    };
    const claim = await writer.beginIndexing(document, prefix, 'test-model', 1);
    expect(claim.kind).toBe('claimed');
    if (claim.kind !== 'claimed') throw Error('claim expected');
    expect(
      await writer.replaceChunksAndMarkIndexed(
        document.sourceKey,
        prefix,
        'test-model',
        claim,
        [
          {
            index: 0,
            content: '旧索引正文',
            embedding: Array.from({ length: 1024 }, (_, i) =>
              i === 0 ? 1 : 0,
            ),
          },
        ],
      ),
    ).toBe(true);
    const visible = async () =>
      (
        await db.$queryRaw<{ visible: boolean }[]>(
          Prisma.sql`SELECT (${currentPublicRagSource()}) AS visible FROM "RagDocument" document WHERE "SourceKey"=${document.sourceKey}`,
        )
      )[0]!.visible;
    expect(await visible()).toBe(true);
    await db.customFieldDefinition.update({
      where: { FieldDefinitionId: field },
      data: { Label: '新的坡度说明' },
    });
    expect(await visible()).toBe(false);
    await db.ragDocument.update({
      where: { SourceKey: document.sourceKey },
      data: { IndexStartedAt: new Date(Date.now() - 48 * 3600000) },
    });
    const maintenance = new PrismaRagMaintenance(db),
      preview = await maintenance.sweep({ apply: false });
    expect(preview.candidates).toBeGreaterThan(0);
    expect(
      (
        await db.ragDocument.findUniqueOrThrow({
          where: { SourceKey: document.sourceKey },
        })
      ).Content,
    ).toBe('旧索引正文');
    await maintenance.sweep({ apply: true });
    const cleared = await db.ragDocument.findUniqueOrThrow({
      where: { SourceKey: document.sourceKey },
    });
    expect(cleared).toMatchObject({
      Content: '',
      Status: 'disabled',
      LastFailureReason: 'stale_index_cleaned',
    });
    expect(
      await db.ragChunk.count({
        where: { RagDocumentId: cleared.RagDocumentId },
      }),
    ).toBe(0);
    expect(await writer.markFailed(document.sourceKey, prefix, claim)).toBe(
      false,
    );
    expect(
      await db.outboxEvent.count({
        where: {
          EventType: 'resort.changed.v1',
          AggregateType: 'RagMaintenance',
          AggregateId: String(resort),
        },
      }),
    ).toBe(1);
  });
  it('commits dependency fanout and Inbox together and suppresses redelivery', async () => {
    const handler = new RagDependencyEventHandler(new PrismaInboxExecutor(db));
    const event = {
      eventId: randomUUID(),
      eventType: 'rag.dependencies.changed.v1',
      aggregateType: prefix,
      aggregateId: prefix,
      occurredAt: new Date(),
      payload: { entityType: 'ski_resort', afterId: resort - 1, maxId: resort },
    };
    const before = await db.outboxEvent.count({
      where: { EventType: 'resort.changed.v1', AggregateId: String(resort) },
    });
    expect(await handler.handle(event)).toBe(true);
    expect(await handler.handle(event)).toBe(false);
    expect(
      await db.outboxEvent.count({
        where: { EventType: 'resort.changed.v1', AggregateId: String(resort) },
      }),
    ).toBe(before + 1);
    await db.consumedEvent.deleteMany({ where: { EventId: event.eventId } });
  });
  it('protects referenced assets, records storage failure and safely retries unreferenced retirement', async () => {
    const make = (suffix: string) =>
      db.asset.create({
        data: {
          OwnerUserId: user,
          StorageKey: `${prefix}/${suffix}`,
          OriginalName: 'test.png',
          MimeType: 'image/png',
          SizeBytes: 10,
          Sha256: '0'.repeat(64),
          Status: 'ready',
          CreateTime: new Date(Date.now() - 48 * 3600000),
        },
      });
    const referenced = await make('referenced'),
      orphan = await make('orphan');
    await db.skiResort.update({
      where: { ResortId: resort },
      data: { CoverAssetId: referenced.AssetId },
    });
    const remove = vi
      .fn()
      .mockRejectedValueOnce(Error('storage unavailable'))
      .mockResolvedValue(undefined);
    const maintenance = new PrismaAssetMaintenance(db, {
      remove,
      put: vi.fn(),
      createReadUrl: vi.fn(),
    });
    expect(
      (
        await maintenance.sweep({
          apply: false,
          afterId: (referenced.AssetId - 1n).toString(),
        })
      ).candidates,
    ).toBe(1);
    expect(remove).not.toHaveBeenCalled();
    expect(
      (
        await maintenance.sweep({
          apply: true,
          afterId: (referenced.AssetId - 1n).toString(),
        })
      ).failed,
    ).toBe(1);
    expect(
      await db.asset.findUniqueOrThrow({ where: { AssetId: orphan.AssetId } }),
    ).toMatchObject({
      Status: 'deleted',
      CleanupFailureCode: 'storage_delete_failed',
      StorageDeletedAt: null,
    });
    expect(
      (
        await maintenance.sweep({
          apply: true,
          afterId: (referenced.AssetId - 1n).toString(),
        })
      ).removed,
    ).toBe(1);
    expect(
      (
        await db.asset.findUniqueOrThrow({
          where: { AssetId: referenced.AssetId },
        })
      ).Status,
    ).toBe('ready');
    expect(
      (
        await maintenance.sweep({
          apply: true,
          afterId: (referenced.AssetId - 1n).toString(),
        })
      ).candidates,
    ).toBe(0);
    await db.skiResort.update({
      where: { ResortId: resort },
      data: { CoverAssetId: null },
    });
  });
  it('vetoes physical cleanup when a binding commits after the Serializable snapshot was established', async () => {
    const asset = await db.asset.create({
      data: {
        OwnerUserId: user,
        StorageKey: `${prefix}/concurrent`,
        OriginalName: 'test.png',
        MimeType: 'image/png',
        SizeBytes: 10,
        Sha256: '0'.repeat(64),
        Status: 'ready',
        CreateTime: new Date(Date.now() - 48 * 3600000),
      },
    });
    // Only orchestration is injected: both transactions and the reference read
    // use real PostgreSQL connections. Reproduce the old-snapshot race exactly.
    const facade = new Proxy(db, {
      get(target, key) {
        if (key === '$transaction')
          return (
            effect: (tx: Prisma.TransactionClient) => Promise<unknown>,
            options: object,
          ) =>
            target.$transaction(async (tx) => {
              await tx.$queryRaw`SELECT count(*) FROM "Asset"`;
              await db.$transaction(async (binding) => {
                await binding.$queryRaw`SELECT "AssetId" FROM "Asset" WHERE "AssetId"=${asset.AssetId} FOR SHARE`;
                await binding.skiResort.update({
                  where: { ResortId: resort },
                  data: { CoverAssetId: asset.AssetId },
                });
              });
              return effect(tx);
            }, options);
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const remove = vi.fn();
    const maintenance = new PrismaAssetMaintenance(facade, {
      remove,
      put: vi.fn(),
      createReadUrl: vi.fn(),
    });
    const result = await maintenance.sweep({
      apply: true,
      afterId: String(asset.AssetId - 1n),
    });
    expect(result).toMatchObject({
      removed: 0,
      candidates: 0,
      nextCursor: String(asset.AssetId),
    });
    expect(remove).not.toHaveBeenCalled();
    expect(
      (await db.asset.findUniqueOrThrow({ where: { AssetId: asset.AssetId } }))
        .Status,
    ).toBe('ready');
    await db.skiResort.update({
      where: { ResortId: resort },
      data: { CoverAssetId: null },
    });
  });
});
