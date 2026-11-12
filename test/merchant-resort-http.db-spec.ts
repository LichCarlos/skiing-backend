import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { IdentityAccessModule } from '../src/modules/identity-access/identity-access.module.js';
import { BcryptPasswordHasher } from '../src/modules/identity-access/infrastructure/bcrypt-password-hasher.js';
import { PrismaService } from '../src/shared/persistence/prisma.service.js';
import { configureHttp } from '../src/shared/http/configure-http.js';
import { MerchantResortService } from '../src/modules/resort-management/application/merchant-resort-service.js';
import { MERCHANT_RESORT_REPOSITORY } from '../src/modules/resort-management/application/ports/merchant-resort-repository.js';
import { PrismaMerchantResortRepository } from '../src/modules/resort-management/infrastructure/prisma-merchant-resort.repository.js';
import { MerchantResortsController } from '../src/modules/resort-management/presentation/http/merchant-resorts.controller.js';
import { CUSTOM_FIELD_REPOSITORY } from '../src/modules/platform-administration/application/ports/custom-field-repository.js';
import { PrismaCustomFieldRepository } from '../src/modules/platform-administration/infrastructure/prisma-custom-field.repository.js';
import { PrismaOutboxStore } from '../src/modules/integration-events/infrastructure/prisma-outbox.store.js';
import { OUTBOX_STORE } from '../src/modules/integration-events/application/ports/outbox-store.js';
import { ASSET_STORAGE } from '../src/modules/assets/application/ports/asset-storage.js';

describe('Merchant resort real HTTP and transaction authorization', () => {
  const prefix = `mhttp_${randomUUID().slice(0, 8)}`;
  const users: number[] = [],
    roles: number[] = [],
    merchants: number[] = [],
    resorts: number[] = [];
  const base = '/api/v1/merchant/resorts';
  const body = {
    name: prefix,
    price: 100,
    openStatus: 'open',
    snowCondition: 'powder',
    description: 'Transaction fixture',
  };
  const fieldKey = `${prefix}_note`,
    groupKey = `${prefix}_group`;
  const optionsType = `${prefix}.options`;
  let tagId: number;
  let app: INestApplication<App>,
    http: App,
    prisma: PrismaService,
    repository: PrismaMerchantResortRepository;
  type Actor = {
    id: number;
    roleId: number;
    merchantId: number;
    token: string;
  };
  let owner: Actor, other: Actor;
  beforeAll(async () => {
    if (!process.env.DATABASE_URL)
      throw new Error('Dedicated migrated database required');
    vi.stubEnv(
      'JWT_ACCESS_SECRET',
      'merchant-resort-http-validation-at-least-32-characters',
    );
    const module = await Test.createTestingModule({
      imports: [IdentityAccessModule],
      controllers: [MerchantResortsController],
      providers: [
        MerchantResortService,
        {
          provide: MERCHANT_RESORT_REPOSITORY,
          useClass: PrismaMerchantResortRepository,
        },
        {
          provide: CUSTOM_FIELD_REPOSITORY,
          useClass: PrismaCustomFieldRepository,
        },
        { provide: OUTBOX_STORE, useClass: PrismaOutboxStore },
        {
          provide: ASSET_STORAGE,
          useValue: {
            createReadUrl: async (key: string) =>
              `https://validation.example/${key}`,
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.init();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);
    repository = app.get(MERCHANT_RESORT_REPOSITORY);
    owner = await account();
    other = await account();
    await prisma.customFieldGroup.create({
      data: { EntityType: 'ski_resort', GroupKey: groupKey, Label: prefix },
    });
    await prisma.customFieldDefinition.create({
      data: {
        EntityType: 'ski_resort',
        FieldKey: fieldKey,
        GroupKey: groupKey,
        Label: prefix,
        DataType: 'text',
        Status: 'active',
      },
    });
    await prisma.dictionaryType.create({
      data: { DictType: optionsType, DictName: prefix, GroupKey: prefix },
    });
    await prisma.dictionaryItem.create({
      data: { DictType: optionsType, Value: 'one', Label: 'One' },
    });
    tagId = (
      await prisma.dictionaryItem.create({
        data: { DictType: 'resort.fit_tag', Value: prefix, Label: prefix },
      })
    ).ItemId;
  });
  afterAll(async () => {
    try {
      if (prisma) {
        await prisma.operationLog.deleteMany({
          where: { ActorUserId: { in: users } },
        });
        await prisma.outboxEvent.deleteMany({
          where: {
            AggregateType: 'ski_resort',
            AggregateId: { in: resorts.map(String) },
          },
        });
        await prisma.skiResort.deleteMany({
          where: { ResortId: { in: resorts } },
        });
        await prisma.asset.deleteMany({
          where: { OwnerUserId: { in: users } },
        });
        await prisma.roleFieldPermission.deleteMany({
          where: { RoleId: { in: roles } },
        });
        await prisma.customFieldDefinition.deleteMany({
          where: { EntityType: 'ski_resort', GroupKey: groupKey },
        });
        await prisma.customFieldGroup.deleteMany({
          where: { EntityType: 'ski_resort', GroupKey: groupKey },
        });
        if (tagId)
          await prisma.dictionaryItem.delete({ where: { ItemId: tagId } });
        await prisma.dictionaryItem.deleteMany({
          where: { DictType: optionsType },
        });
        await prisma.dictionaryType.deleteMany({
          where: { DictType: optionsType },
        });
        await prisma.merchantProfile.deleteMany({
          where: { MerchantId: { in: merchants } },
        });
        await prisma.user.deleteMany({ where: { UserId: { in: users } } });
        await prisma.role.deleteMany({ where: { RoleId: { in: roles } } });
      }
    } finally {
      await app?.close();
      vi.unstubAllEnvs();
    }
  });
  async function account(): Promise<Actor> {
    const permissions = await prisma.permission.findMany({
      where: {
        PermissionKey: {
          in: [
            'management:portal:enter',
            'resort:merchant:list',
            'resort:merchant:create',
            'resort:merchant:update',
            'resort:merchant:delete',
            'resort:merchant:submit-review',
          ],
        },
      },
    });
    expect(permissions).toHaveLength(6);
    const role = await prisma.role.create({
      data: {
        RoleKey: `${prefix}_${roles.length}`,
        RoleName: prefix,
        DataScope: 'merchant',
        RolePermissions: {
          create: permissions.map(({ PermissionId }) => ({ PermissionId })),
        },
      },
    });
    roles.push(role.RoleId);
    const password = 'merchant-http-validation-password';
    const user = await prisma.user.create({
      data: {
        Account: `${prefix}_${users.length}`,
        Nickname: prefix,
        PasswordHash: await new BcryptPasswordHasher().hash(password),
        UserRoles: { create: { RoleId: role.RoleId } },
      },
    });
    users.push(user.UserId);
    const merchant = await prisma.merchantProfile.create({
      data: { UserId: user.UserId, BusinessName: prefix },
    });
    merchants.push(merchant.MerchantId);
    const response = await request(http)
      .post('/api/v1/auth/login')
      .send({ account: user.Account, password })
      .expect(200);
    return {
      id: user.UserId,
      roleId: role.RoleId,
      merchantId: merchant.MerchantId,
      token: response.body.data.accessToken as string,
    };
  }
  async function resort(actor = owner, status = 'draft') {
    const row = await prisma.skiResort.create({
      data: {
        Name: prefix,
        MerchantId: actor.merchantId,
        Price: 100,
        LegacyDistance: 0,
        SnowCondition: 'powder',
        Description: body.description,
        Status: status,
      },
    });
    resorts.push(row.ResortId);
    return row.ResortId;
  }
  function create(data: object = body, actor = owner) {
    return request(http)
      .post(base)
      .auth(actor.token, { type: 'bearer' })
      .send(data);
  }
  function patch(id: number, data: object, actor = owner) {
    return request(http)
      .patch(`${base}/${id}`)
      .auth(actor.token, { type: 'bearer' })
      .send(data);
  }
  async function sideEffects() {
    return {
      logs: await prisma.operationLog.count({
        where: { ActorUserId: { in: users } },
      }),
      events: await prisma.outboxEvent.count({
        where: {
          AggregateType: 'ski_resort',
          AggregateId: { in: resorts.map(String) },
        },
      }),
    };
  }
  const fieldWhere = {
    EntityType_FieldKey: { EntityType: 'ski_resort', FieldKey: fieldKey },
  };

  it.each(['create', 'update', 'delete', 'submit-review'] as const)(
    'rechecks the %s action after HTTP Guard and before the real write transaction',
    async (operation) => {
      const actor = await account();
      const id = await resort(actor);
      const before = await sideEffects();
      const original = repository.runWrite.bind(repository);
      const spy = vi
        .spyOn(repository, 'runWrite')
        .mockImplementationOnce(async (work) => {
          const permission = await prisma.permission.findUniqueOrThrow({
            where: { PermissionKey: `resort:merchant:${operation}` },
          });
          await prisma.rolePermission.delete({
            where: {
              RoleId_PermissionId: {
                RoleId: actor.roleId,
                PermissionId: permission.PermissionId,
              },
            },
          });
          return original(work);
        });
      try {
        if (operation === 'create') {
          const response = await create(body, actor);
          if (response.body.data?.resortId)
            resorts.push(response.body.data.resortId as number);
          expect(response.status).toBe(403);
        } else if (operation === 'update')
          await patch(id, { price: 200 }, actor).expect(403);
        else if (operation === 'delete')
          await request(http)
            .delete(`${base}/${id}`)
            .auth(actor.token, { type: 'bearer' })
            .expect(403);
        else
          await request(http)
            .patch(`${base}/${id}/submit-review`)
            .auth(actor.token, { type: 'bearer' })
            .send({})
            .expect(403);
      } finally {
        spy.mockRestore();
      }
      expect(await sideEffects()).toEqual(before);
      expect(
        await prisma.skiResort.findUniqueOrThrow({ where: { ResortId: id } }),
      ).toMatchObject({ Price: 100, Status: 'draft', DeletedAt: null });
    },
  );

  it('does not create after a committed selected scope replaces the Guard scope', async () => {
    const actor = await account();
    const id = await resort(actor);
    const before = await sideEffects();
    const original = repository.runWrite.bind(repository);
    const spy = vi
      .spyOn(repository, 'runWrite')
      .mockImplementationOnce(async (work) => {
        await prisma.roleDataScope.create({
          data: {
            RoleId: actor.roleId,
            ResourceKey: 'resort',
            ScopeType: 'selected',
            ScopeConfig: { selectedIds: [id] },
          },
        });
        return original(work);
      });
    try {
      const response = await create(body, actor);
      if (response.body.data?.resortId)
        resorts.push(response.body.data.resortId as number);
      expect(response.status).toBe(403);
    } finally {
      spy.mockRestore();
    }
    expect(await sideEffects()).toEqual(before);
  });

  it.each([
    'field permission',
    'field disabled',
    'group disabled',
    'validation tightened',
  ] as const)('revalidates %s at the actual write snapshot', async (change) => {
    const actor = await account();
    const id = await resort(actor);
    await prisma.roleFieldPermission.create({
      data: {
        RoleId: actor.roleId,
        EntityType: 'ski_resort',
        FieldKey: fieldKey,
        CanRead: true,
        CanWrite: true,
      },
    });
    const before = await sideEffects();
    const original = repository.runWrite.bind(repository);
    const spy = vi
      .spyOn(repository, 'runWrite')
      .mockImplementationOnce(async (work) => {
        if (change === 'field permission')
          await prisma.roleFieldPermission.updateMany({
            where: { RoleId: actor.roleId },
            data: { CanWrite: false },
          });
        if (change === 'field disabled')
          await prisma.customFieldDefinition.update({
            where: fieldWhere,
            data: { Status: 'disabled' },
          });
        if (change === 'group disabled')
          await prisma.customFieldGroup.update({
            where: {
              EntityType_GroupKey: {
                EntityType: 'ski_resort',
                GroupKey: groupKey,
              },
            },
            data: { Status: 'disabled' },
          });
        if (change === 'validation tightened')
          await prisma.customFieldDefinition.update({
            where: fieldWhere,
            data: { Validation: { maxLength: 2 } },
          });
        return original(work);
      });
    try {
      await patch(
        id,
        { customFields: { [fieldKey]: 'private-new-value' } },
        actor,
      ).expect(422);
    } finally {
      spy.mockRestore();
      await prisma.customFieldDefinition.update({
        where: fieldWhere,
        data: {
          Status: 'active',
          Validation: Prisma.DbNull,
        },
      });
      await prisma.customFieldGroup.update({
        where: {
          EntityType_GroupKey: { EntityType: 'ski_resort', GroupKey: groupKey },
        },
        data: { Status: 'active' },
      });
    }
    expect(await sideEffects()).toEqual(before);
    expect(
      (await prisma.skiResort.findUniqueOrThrow({ where: { ResortId: id } }))
        .CustomFields,
    ).toEqual({});
  });

  it('enforces own merchants for every record command and publishes the lifecycle with matching audits', async () => {
    const id = await resort(other);
    await request(http).get(base).expect(401);
    await request(http)
      .get(`${base}/${id}`)
      .auth(owner.token, { type: 'bearer' })
      .expect(404);
    await patch(id, { price: 200 }).expect(404);
    await request(http)
      .delete(`${base}/${id}`)
      .auth(owner.token, { type: 'bearer' })
      .expect(404);
    await request(http)
      .patch(`${base}/${id}/submit-review`)
      .auth(owner.token, { type: 'bearer' })
      .send({})
      .expect(404);
    const response = await create().expect(201);
    const ownId = response.body.data.resortId as number;
    resorts.push(ownId);
    await patch(ownId, { price: 200 }).expect(200);
    await request(http)
      .patch(`${base}/${ownId}/submit-review`)
      .auth(owner.token, { type: 'bearer' })
      .send({})
      .expect(200);
    await request(http)
      .delete(`${base}/${ownId}`)
      .auth(owner.token, { type: 'bearer' })
      .expect(204);
    expect(
      await prisma.operationLog.count({
        where: {
          ActorUserId: owner.id,
          ResourceKey: 'resort',
          TargetId: String(ownId),
        },
      }),
    ).toBe(4);
    expect(
      await prisma.outboxEvent.count({
        where: { AggregateType: 'ski_resort', AggregateId: String(ownId) },
      }),
    ).toBe(4);
  });

  it.each([
    'account',
    'role',
    'role binding',
    'portal',
    'merchant profile',
    'scope conflict',
  ] as const)(
    'rejects committed %s revocation after Guard without side effects',
    async (change) => {
      const actor = await account();
      const id = await resort(actor);
      const before = await sideEffects();
      const original = repository.runWrite.bind(repository);
      const spy = vi
        .spyOn(repository, 'runWrite')
        .mockImplementationOnce(async (work) => {
          if (change === 'account')
            await prisma.user.update({
              where: { UserId: actor.id },
              data: { Status: 'disabled' },
            });
          if (change === 'role')
            await prisma.role.update({
              where: { RoleId: actor.roleId },
              data: { Status: 'disabled' },
            });
          if (change === 'role binding')
            await prisma.userRole.deleteMany({ where: { UserId: actor.id } });
          if (change === 'merchant profile')
            await prisma.merchantProfile.update({
              where: { MerchantId: actor.merchantId },
              data: { Status: 'disabled' },
            });
          if (change === 'portal') {
            const permission = await prisma.permission.findUniqueOrThrow({
              where: { PermissionKey: 'management:portal:enter' },
            });
            await prisma.rolePermission.delete({
              where: {
                RoleId_PermissionId: {
                  RoleId: actor.roleId,
                  PermissionId: permission.PermissionId,
                },
              },
            });
          }
          if (change === 'scope conflict') {
            const another = await account();
            await prisma.role.update({
              where: { RoleId: another.roleId },
              data: { DataScope: 'self' },
            });
            await prisma.userRole.create({
              data: { UserId: actor.id, RoleId: another.roleId },
            });
          }
          return original(work);
        });
      try {
        await patch(id, { price: 500 }, actor).expect(403);
      } finally {
        spy.mockRestore();
      }
      expect(await sideEffects()).toEqual(before);
      expect(
        (await prisma.skiResort.findUniqueOrThrow({ where: { ResortId: id } }))
          .Price,
      ).toBe(100);
    },
  );

  it('applies the current multi-role field union and preserves omitted private legacy values', async () => {
    const actor = await account();
    const another = await account();
    const id = await resort(actor);
    // The extra role contributes only field grants; it must not introduce an action scope conflict.
    await prisma.rolePermission.deleteMany({
      where: { RoleId: another.roleId },
    });
    await prisma.userRole.create({
      data: { UserId: actor.id, RoleId: another.roleId },
    });
    await prisma.roleFieldPermission.createMany({
      data: [
        {
          RoleId: actor.roleId,
          EntityType: 'ski_resort',
          FieldKey: fieldKey,
          CanRead: true,
          CanWrite: false,
        },
        {
          RoleId: another.roleId,
          EntityType: 'ski_resort',
          FieldKey: fieldKey,
          CanRead: false,
          CanWrite: true,
        },
      ],
    });
    await prisma.skiResort.update({
      where: { ResortId: id },
      data: { CustomFields: { legacyPrivate: 'do-not-return' } },
    });
    const response = await patch(
      id,
      { customFields: { [fieldKey]: 'visible' } },
      actor,
    ).expect(200);
    expect(response.body.data.customFields).toEqual({ [fieldKey]: 'visible' });
    expect(
      (await prisma.skiResort.findUniqueOrThrow({ where: { ResortId: id } }))
        .CustomFields,
    ).toEqual({ legacyPrivate: 'do-not-return', [fieldKey]: 'visible' });
    await prisma.roleFieldPermission.updateMany({
      where: { RoleId: actor.roleId },
      data: { CanRead: false },
    });
    const hidden = await patch(id, { price: 101 }, actor).expect(200);
    expect(hidden.body.data.customFields).toEqual({});
    await patch(id, { customFields: { unknownField: 'denied' } }, actor).expect(
      422,
    );
    expect(JSON.stringify(hidden.body)).not.toContain('do-not-return');
  });

  async function readyAsset(actor = owner) {
    return prisma.asset.create({
      data: {
        OwnerUserId: actor.id,
        StorageKey: `${prefix}/${randomUUID()}`,
        OriginalName: 'snow.png',
        MimeType: 'image/png',
        SizeBytes: 64n,
        Sha256: 'a'.repeat(64),
        Status: 'ready',
      },
    });
  }

  it('revalidates image ownership and readiness before binding cover and gallery', async () => {
    const id = await resort();
    const foreign = await readyAsset(other);
    const own = await readyAsset();
    await patch(id, { coverAssetId: foreign.AssetId.toString() }).expect(422);
    await prisma.asset.update({
      where: { AssetId: own.AssetId },
      data: { Status: 'pending_scan' },
    });
    await patch(id, { galleryAssetIds: [own.AssetId.toString()] }).expect(422);
    await prisma.asset.update({
      where: { AssetId: own.AssetId },
      data: { Status: 'ready' },
    });
    const response = await patch(id, {
      coverAssetId: own.AssetId.toString(),
      galleryAssetIds: [own.AssetId.toString()],
    }).expect(200);
    expect(response.body.data).toMatchObject({
      coverAssetId: own.AssetId.toString(),
      gallery: [{ assetId: own.AssetId.toString() }],
    });
  });

  it('does not bind an image when its concurrent readiness change commits first', async () => {
    const id = await resort();
    const image = await readyAsset();
    const before = await sideEffects();
    let release!: () => void, locked!: () => void;
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holding = prisma.$transaction(
      async (tx) => {
        await tx.asset.update({
          where: { AssetId: image.AssetId },
          data: { Status: 'pending_scan' },
        });
        locked();
        await gate;
      },
      { timeout: 15000 },
    );
    await ready;
    const updating = patch(id, { coverAssetId: image.AssetId.toString() }).then(
      (r) => r,
    );
    try {
      const deadline = Date.now() + 8000;
      let waiting = 0;
      while (Date.now() < deadline) {
        const rows = await prisma.$queryRaw<
          { count: number }[]
        >`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM "Asset"%' AND query LIKE '%FOR SHARE%'`;
        waiting = rows[0].count;
        if (waiting > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(waiting).toBeGreaterThan(0);
    } finally {
      release();
      await holding;
    }
    expect((await updating).status).toBe(409);
    expect(
      (await prisma.skiResort.findUniqueOrThrow({ where: { ResortId: id } }))
        .CoverAssetId,
    ).toBeNull();
    expect(await sideEffects()).toEqual(before);
  });

  it('rolls back the resort, relations and Outbox when the actual audit INSERT fails', async () => {
    const id = await resort();
    const image = await readyAsset();
    const before = await sideEffects();
    const service = app.get(MerchantResortService);
    await expect(
      service.update(
        {
          userId: owner.id,
          merchantId: owner.merchantId,
          scope: { kind: 'merchant', merchantId: owner.merchantId },
          resortId: id,
          body: { price: 600, galleryAssetIds: [image.AssetId.toString()] },
        },
        { traceId: 'x'.repeat(101), clientIp: null, userAgent: null },
      ),
    ).rejects.toMatchObject({ code: 'P2000' });
    expect(
      (await prisma.skiResort.findUniqueOrThrow({ where: { ResortId: id } }))
        .Price,
    ).toBe(100);
    expect(await prisma.resortImage.count({ where: { ResortId: id } })).toBe(0);
    expect(await sideEffects()).toEqual(before);
  });

  it.each(['0', '01', '9223372036854775808', '9'.repeat(40)])(
    'rejects invalid storage IDs without a SQL overflow: %s',
    async (id) => {
      const target = await resort();
      const before = await sideEffects();
      await patch(target, { coverAssetId: id }).expect(422);
      await patch(target, { galleryAssetIds: [id] }).expect(422);
      expect(await sideEffects()).toEqual(before);
    },
  );

  it('rejects unsafe paging and nonpositive/out-of-range resort IDs before database access', async () => {
    for (const id of ['0', '-1', '2147483648', '9007199254740991'])
      await request(http)
        .get(`${base}/${id}`)
        .auth(owner.token, { type: 'bearer' })
        .expect(400);
    await request(http)
      .get(base)
      .auth(owner.token, { type: 'bearer' })
      .query({ page: '9007199254740991', pageSize: 100 })
      .expect(400);
  });

  it('rejects ready non-image resources without binding them', async () => {
    const id = await resort();
    const image = await readyAsset();
    await prisma.asset.update({
      where: { AssetId: image.AssetId },
      data: { MimeType: 'application/pdf' },
    });
    await patch(id, { coverAssetId: image.AssetId.toString() }).expect(422);
  });

  it.each(['type', 'item'] as const)(
    'uses current active dictionary %s for dynamic field options',
    async (change) => {
      const actor = await account();
      const id = await resort(actor);
      const before = await sideEffects();
      await prisma.roleFieldPermission.create({
        data: {
          RoleId: actor.roleId,
          EntityType: 'ski_resort',
          FieldKey: fieldKey,
          CanRead: true,
          CanWrite: true,
        },
      });
      await prisma.customFieldDefinition.update({
        where: fieldWhere,
        data: { DataType: 'single_select', OptionsDictType: optionsType },
      });
      const original = repository.runWrite.bind(repository);
      const spy = vi
        .spyOn(repository, 'runWrite')
        .mockImplementationOnce(async (work) => {
          if (change === 'type')
            await prisma.dictionaryType.update({
              where: { DictType: optionsType },
              data: { Status: 'disabled' },
            });
          else
            await prisma.dictionaryItem.updateMany({
              where: { DictType: optionsType },
              data: { Status: 'disabled' },
            });
          return original(work);
        });
      try {
        await patch(id, { customFields: { [fieldKey]: 'one' } }, actor).expect(
          422,
        );
      } finally {
        spy.mockRestore();
        await prisma.customFieldDefinition.update({
          where: fieldWhere,
          data: { DataType: 'text', OptionsDictType: null },
        });
        await prisma.dictionaryType.update({
          where: { DictType: optionsType },
          data: { Status: 'active' },
        });
        await prisma.dictionaryItem.updateMany({
          where: { DictType: optionsType },
          data: { Status: 'active' },
        });
      }
      expect(await sideEffects()).toEqual(before);
    },
  );

  it('does not bind tags when a concurrent dictionary item disable commits first', async () => {
    const id = await resort();
    const before = await sideEffects();
    let release!: () => void, locked!: () => void;
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holding = prisma.$transaction(
      async (tx) => {
        await tx.dictionaryItem.update({
          where: { ItemId: tagId },
          data: { Status: 'disabled' },
        });
        locked();
        await gate;
      },
      { timeout: 15000 },
    );
    await ready;
    const updating = patch(id, { fitTagValues: [prefix] }).then((r) => r);
    try {
      const deadline = Date.now() + 8000;
      let waiting = 0;
      while (Date.now() < deadline) {
        const rows = await prisma.$queryRaw<
          { count: number }[]
        >`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM "DictionaryItem"%' AND query LIKE '%FOR SHARE%'`;
        waiting = rows[0].count;
        if (waiting > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(waiting).toBeGreaterThan(0);
    } finally {
      release();
      await holding;
    }
    try {
      expect((await updating).status).toBe(409);
      expect(await prisma.resortFitTag.count({ where: { ResortId: id } })).toBe(
        0,
      );
      expect(await sideEffects()).toEqual(before);
    } finally {
      await prisma.dictionaryItem.update({
        where: { ItemId: tagId },
        data: { Status: 'active' },
      });
    }
    const response = await patch(id, { fitTagValues: [prefix] }).expect(200);
    expect(response.body.data.fitTags).toEqual([prefix]);
  });
});
