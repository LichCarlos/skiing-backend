import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { IdentityAccessModule } from '../src/modules/identity-access/identity-access.module.js';
import { BcryptPasswordHasher } from '../src/modules/identity-access/infrastructure/bcrypt-password-hasher.js';
import { PrismaService } from '../src/shared/persistence/prisma.service.js';
import { configureHttp } from '../src/shared/http/configure-http.js';
import { AdminResortService } from '../src/modules/resort-management/application/admin-resort-service.js';
import { ADMIN_RESORT_REPOSITORY } from '../src/modules/resort-management/application/ports/admin-resort-repository.js';
import { PrismaAdminResortRepository } from '../src/modules/resort-management/infrastructure/prisma-admin-resort.repository.js';
import { AdminResortsController } from '../src/modules/resort-management/presentation/http/admin-resorts.controller.js';
import { CUSTOM_FIELD_REPOSITORY } from '../src/modules/platform-administration/application/ports/custom-field-repository.js';
import { PrismaCustomFieldRepository } from '../src/modules/platform-administration/infrastructure/prisma-custom-field.repository.js';
import { PrismaOutboxStore } from '../src/modules/integration-events/infrastructure/prisma-outbox.store.js';
import { OUTBOX_STORE } from '../src/modules/integration-events/application/ports/outbox-store.js';
import { ASSET_STORAGE } from '../src/modules/assets/application/ports/asset-storage.js';

describe('Global resort real HTTP transaction authorization and references', () => {
  const prefix = `ahttp_${randomUUID().slice(0, 8)}`;
  const users: number[] = [],
    roles: number[] = [],
    resorts: number[] = [],
    merchants: number[] = [];
  const base = '/api/v1/admin/resorts';
  const body = {
    name: prefix,
    price: 100,
    openStatus: 'open',
    snowCondition: 'powder',
    description: 'Transaction fixture',
  };
  const actions = {
    create: 'content:resort:create-all',
    update: 'content:resort:update-all',
    delete: 'content:resort:delete-all',
    publish: 'content:resort:publish',
    offline: 'content:resort:offline',
  } as const;
  type Actor = { id: number; roleId: number; token: string };
  let owner: Actor;
  let app: INestApplication<App>,
    http: App,
    prisma: PrismaService,
    repository: PrismaAdminResortRepository;
  beforeAll(async () => {
    if (!process.env.DATABASE_URL)
      throw new Error('Dedicated migrated database required');
    vi.stubEnv(
      'JWT_ACCESS_SECRET',
      'admin-resort-http-validation-at-least-32-characters',
    );
    const module = await Test.createTestingModule({
      imports: [IdentityAccessModule],
      controllers: [AdminResortsController],
      providers: [
        AdminResortService,
        {
          provide: ADMIN_RESORT_REPOSITORY,
          useClass: PrismaAdminResortRepository,
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
    repository = app.get(ADMIN_RESORT_REPOSITORY);
    owner = await account();
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
        await prisma.dictionaryItem.deleteMany({
          where: { DictType: 'resort.fit_tag', Value: { startsWith: prefix } },
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
  async function account(withAssetRead = true): Promise<Actor> {
    const permissions = await prisma.permission.findMany({
      where: {
        PermissionKey: {
          in: [
            'management:portal:enter',
            'content:resort:list-all',
            ...(withAssetRead ? ['content:asset:list'] : []),
            ...Object.values(actions),
          ],
        },
      },
    });
    expect(permissions).toHaveLength(withAssetRead ? 8 : 7);
    const role = await prisma.role.create({
      data: {
        RoleKey: `${prefix}_${roles.length}`,
        RoleName: prefix,
        DataScope: 'all',
        RolePermissions: {
          create: permissions.map(({ PermissionId }) => ({ PermissionId })),
        },
      },
    });
    roles.push(role.RoleId);
    const password = 'global-http-validation-password';
    const user = await prisma.user.create({
      data: {
        Account: `${prefix}_${users.length}`,
        Nickname: prefix,
        PasswordHash: await new BcryptPasswordHasher().hash(password),
        UserRoles: { create: { RoleId: role.RoleId } },
      },
    });
    users.push(user.UserId);
    const response = await request(http)
      .post('/api/v1/auth/login')
      .send({ account: user.Account, password })
      .expect(200);
    return {
      id: user.UserId,
      roleId: role.RoleId,
      token: response.body.data.accessToken as string,
    };
  }
  async function resort(status = 'draft') {
    const row = await prisma.skiResort.create({
      data: {
        Name: prefix,
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
  async function image(ownerUserId = owner.id) {
    return prisma.asset.create({
      data: {
        OwnerUserId: ownerUserId,
        StorageKey: `${prefix}/${randomUUID()}`,
        OriginalName: 'authorization.png',
        MimeType: 'image/png',
        SizeBytes: 12n,
        Sha256: 'd'.repeat(64),
        Status: 'ready',
      },
    });
  }
  function patch(id: number, data: object, actor = owner) {
    return request(http)
      .patch(`${base}/${id}`)
      .auth(actor.token, { type: 'bearer' })
      .send(data);
  }
  async function execute(
    operation: keyof typeof actions,
    id: number,
    actor: Actor,
  ) {
    if (operation === 'create') {
      const response = await request(http)
        .post(base)
        .auth(actor.token, { type: 'bearer' })
        .send(body);
      if (response.body.data?.resortId)
        resorts.push(response.body.data.resortId as number);
      return response;
    }
    if (operation === 'update') return patch(id, { price: 200 }, actor);
    if (operation === 'delete')
      return request(http)
        .delete(`${base}/${id}`)
        .auth(actor.token, { type: 'bearer' });
    return request(http)
      .patch(`${base}/${id}/${operation}`)
      .auth(actor.token, { type: 'bearer' })
      .send({});
  }
  async function effects() {
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
  async function atWrite(
    change: () => Promise<unknown>,
    work: () => Promise<unknown>,
  ) {
    const original = repository.runWrite.bind(repository);
    const spy = vi
      .spyOn(repository, 'runWrite')
      .mockImplementationOnce(async (callback) => {
        await change();
        return original(callback);
      });
    try {
      await work();
    } finally {
      spy.mockRestore();
    }
  }
  it.each(Object.keys(actions) as (keyof typeof actions)[])(
    'rechecks the %s grant after Guard and before transaction writes',
    async (operation) => {
      const actor = await account(),
        id = await resort(operation === 'offline' ? 'published' : 'draft');
      const before = await effects();
      await atWrite(
        async () => {
          const permission = await prisma.permission.findUniqueOrThrow({
            where: { PermissionKey: actions[operation] },
          });
          await prisma.rolePermission.delete({
            where: {
              RoleId_PermissionId: {
                RoleId: actor.roleId,
                PermissionId: permission.PermissionId,
              },
            },
          });
        },
        async () => {
          expect((await execute(operation, id, actor)).status).toBe(403);
        },
      );
      expect(await effects()).toEqual(before);
      expect(
        await prisma.skiResort.findUniqueOrThrow({ where: { ResortId: id } }),
      ).toMatchObject({
        Price: 100,
        Status: operation === 'offline' ? 'published' : 'draft',
        DeletedAt: null,
      });
    },
  );
  it.each([
    'account',
    'role',
    'binding',
    'portal',
    'selected scope',
    'scope conflict',
  ] as const)('rejects committed %s changes after Guard', async (change) => {
    const actor = await account(),
      id = await resort();
    const before = await effects();
    await atWrite(
      async () => {
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
        if (change === 'binding')
          await prisma.userRole.deleteMany({ where: { UserId: actor.id } });
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
        if (change === 'selected scope')
          await prisma.roleDataScope.create({
            data: {
              RoleId: actor.roleId,
              ResourceKey: 'resort',
              ScopeType: 'selected',
              ScopeConfig: { selectedIds: [id] },
            },
          });
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
      },
      async () => {
        await patch(id, { price: 700 }, actor).expect(403);
      },
    );
    expect(await effects()).toEqual(before);
    expect(
      (await prisma.skiResort.findUniqueOrThrow({ where: { ResortId: id } }))
        .Price,
    ).toBe(100);
  });
  it.each(['text/plain', 'image/svg+xml', 'image/gif'])(
    'rejects ready %s assets without any write effects',
    async (mime) => {
      const id = await resort(),
        before = await effects();
      const asset = await prisma.asset.create({
        data: {
          OwnerUserId: owner.id,
          StorageKey: `${prefix}/${randomUUID()}`,
          OriginalName: 'fixture',
          MimeType: mime,
          SizeBytes: 12n,
          Sha256: 'a'.repeat(64),
          Status: 'ready',
        },
      });
      await patch(id, { coverAssetId: asset.AssetId.toString() }).expect(422);
      expect(await effects()).toEqual(before);
      expect(
        (await prisma.skiResort.findUniqueOrThrow({ where: { ResortId: id } }))
          .CoverAssetId,
      ).toBeNull();
    },
  );
  it.each(['missing', 'self', 'selected'] as const)(
    'rejects explicit image association with %s asset authorization, including own images',
    async (scope) => {
      const actor = await account(scope !== 'missing');
      const id = await resort(),
        asset = await image(actor.id);
      if (scope !== 'missing')
        await prisma.roleDataScope.create({
          data: {
            RoleId: actor.roleId,
            ResourceKey: 'asset',
            ScopeType: scope,
            ...(scope === 'selected'
              ? { ScopeConfig: { selectedIds: [asset.AssetId.toString()] } }
              : {}),
          },
        });
      const before = await effects();
      await patch(id, { coverAssetId: asset.AssetId.toString() }, actor).expect(
        403,
      );
      expect(await effects()).toEqual(before);
      expect(
        await prisma.skiResort.findUnique({ where: { ResortId: id } }),
      ).toMatchObject({ CoverAssetId: null });
    },
  );
  it.each(['cover', 'gallery'] as const)(
    'revalidates retained %s image readiness on partial updates without requiring asset-library permission',
    async (kind) => {
      const actor = await account(false),
        id = await resort(),
        asset = await image();
      if (kind === 'cover')
        await prisma.skiResort.update({
          where: { ResortId: id },
          data: { CoverAssetId: asset.AssetId },
        });
      else
        await prisma.resortImage.create({
          data: { ResortId: id, AssetId: asset.AssetId, SortOrder: 0 },
        });
      await patch(id, { price: 200 }, actor).expect(200);
      await prisma.asset.update({
        where: { AssetId: asset.AssetId },
        data: { Status: 'pending_scan' },
      });
      const before = await effects();
      await patch(id, { price: 300 }, actor).expect(422);
      expect(await effects()).toEqual(before);
      expect(
        await prisma.skiResort.findUnique({ where: { ResortId: id } }),
      ).toMatchObject({ Price: 200 });
    },
  );
  it('preserves ready associations when omitted, rejects explicit resubmission, and permits clearing without asset-library permission', async () => {
    const actor = await account(false),
      id = await resort(),
      asset = await image();
    await prisma.skiResort.update({
      where: { ResortId: id },
      data: { CoverAssetId: asset.AssetId },
    });
    await prisma.resortImage.create({
      data: { ResortId: id, AssetId: asset.AssetId, SortOrder: 0 },
    });
    await patch(id, { price: 200 }, actor).expect(200);
    expect(
      await prisma.skiResort.findUnique({ where: { ResortId: id } }),
    ).toMatchObject({ CoverAssetId: asset.AssetId });
    expect(await prisma.resortImage.count({ where: { ResortId: id } })).toBe(1);
    await patch(id, { coverAssetId: asset.AssetId.toString() }, actor).expect(
      403,
    );
    await patch(id, { coverAssetId: null, galleryAssetIds: [] }, actor).expect(
      200,
    );
    expect(
      await prisma.skiResort.findUnique({ where: { ResortId: id } }),
    ).toMatchObject({ CoverAssetId: null });
    expect(await prisma.resortImage.count({ where: { ResortId: id } })).toBe(0);
  });
  it('rechecks revoked asset permission after Guard before associating an image', async () => {
    const actor = await account(),
      id = await resort(),
      asset = await image();
    const grant = await prisma.permission.findUniqueOrThrow({
      where: { PermissionKey: 'content:asset:list' },
    });
    const before = await effects();
    await atWrite(
      async () => {
        await prisma.rolePermission.delete({
          where: {
            RoleId_PermissionId: {
              RoleId: actor.roleId,
              PermissionId: grant.PermissionId,
            },
          },
        });
      },
      async () => {
        await patch(
          id,
          { coverAssetId: asset.AssetId.toString() },
          actor,
        ).expect(403);
      },
    );
    expect(await effects()).toEqual(before);
  });
  it.each(['0', '01', '9223372036854775808'])(
    'rejects noncanonical or overflowing image identifier %s',
    async (value) => {
      const id = await resort();
      await patch(id, { galleryAssetIds: [value] }).expect(422);
    },
  );
  it.each(['0', '2147483648'])(
    'rejects target identifier %s outside PostgreSQL int4 before querying',
    async (id) => {
      await request(http)
        .get(`${base}/${id}`)
        .auth(owner.token, { type: 'bearer' })
        .expect(400);
      await request(http)
        .patch(`${base}/${id}/publish`)
        .auth(owner.token, { type: 'bearer' })
        .send({})
        .expect(400);
    },
  );
  it.each(['price', 'ratingCount', 'merchantId'] as const)(
    'rejects overflowing %s before PostgreSQL execution',
    async (key) => {
      const id = await resort();
      await patch(id, { [key]: 2147483648 }).expect(
        key === 'price' ? 400 : 422,
      );
    },
  );
  it('rolls back business data, outbox and success audit on a real audit INSERT error', async () => {
    const id = await resort(),
      before = await effects();
    const asset = await prisma.asset.create({
      data: {
        OwnerUserId: owner.id,
        StorageKey: `${prefix}/${randomUUID()}`,
        OriginalName: 'fixture.png',
        MimeType: 'image/png',
        SizeBytes: 12n,
        Sha256: 'c'.repeat(64),
        Status: 'ready',
      },
    });
    await expect(
      app.get(AdminResortService).update(
        id,
        {
          price: 900,
          coverAssetId: asset.AssetId.toString(),
          galleryAssetIds: [asset.AssetId.toString()],
        },
        {
          actorUserId: owner.id,
          traceId: 'x'.repeat(101),
          clientIp: null,
          userAgent: null,
        },
        { kind: 'all' },
      ),
    ).rejects.toMatchObject({ code: 'P2000' });
    expect(await effects()).toEqual(before);
    expect(
      (await prisma.skiResort.findUniqueOrThrow({ where: { ResortId: id } }))
        .Price,
    ).toBe(100);
    expect(await prisma.resortImage.count({ where: { ResortId: id } })).toBe(0);
    expect(
      (await prisma.skiResort.findUniqueOrThrow({ where: { ResortId: id } }))
        .CoverAssetId,
    ).toBeNull();
  });
  it.each(['image', 'merchant', 'tag'] as const)(
    'serializes the %s reference against an actual competing update',
    async (kind) => {
      const id = await resort(),
        before = await effects();
      const image = await prisma.asset.create({
        data: {
          OwnerUserId: owner.id,
          StorageKey: `${prefix}/${randomUUID()}`,
          OriginalName: 'fixture.png',
          MimeType: 'image/png',
          SizeBytes: 12n,
          Sha256: 'b'.repeat(64),
          Status: 'ready',
        },
      });
      const merchant = await prisma.merchantProfile.create({
        data: { UserId: (await account()).id, BusinessName: prefix },
      });
      merchants.push(merchant.MerchantId);
      const tag = await prisma.dictionaryItem.create({
        data: {
          DictType: 'resort.fit_tag',
          Value: `${prefix}_${randomUUID().slice(0, 8)}`,
          Label: prefix,
        },
      });
      let release!: () => void, locked!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const ready = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const holding = prisma.$transaction(
        async (tx) => {
          if (kind === 'image')
            await tx.asset.update({
              where: { AssetId: image.AssetId },
              data: { Status: 'pending_scan' },
            });
          if (kind === 'merchant')
            await tx.merchantProfile.update({
              where: { MerchantId: merchant.MerchantId },
              data: { Status: 'disabled' },
            });
          if (kind === 'tag')
            await tx.dictionaryItem.update({
              where: { ItemId: tag.ItemId },
              data: { Status: 'disabled' },
            });
          locked();
          await gate;
        },
        { timeout: 15000 },
      );
      await ready;
      const data =
        kind === 'image'
          ? { coverAssetId: image.AssetId.toString() }
          : kind === 'merchant'
            ? { merchantId: merchant.MerchantId }
            : { fitTagValues: [tag.Value] };
      const updating = patch(id, data).then((r) => r);
      try {
        const deadline = Date.now() + 8000;
        let waiting = 0;
        while (Date.now() < deadline) {
          const table =
            kind === 'image'
              ? '%FROM "Asset"%'
              : kind === 'merchant'
                ? '%FROM "MerchantProfile"%'
                : '%FROM "DictionaryItem"%';
          const rows = await prisma.$queryRaw<
            { count: number }[]
          >`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE ${table} AND query LIKE '%FOR SHARE%'`;
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
      expect(await effects()).toEqual(before);
      expect(
        await prisma.skiResort.findUniqueOrThrow({ where: { ResortId: id } }),
      ).toMatchObject({ CoverAssetId: null, MerchantId: null, Price: 100 });
    },
  );
  it('allows a configured global role without any merchant profile and retains the published edit lifecycle', async () => {
    await request(http).get(base).expect(401);
    const response = await execute('create', 0, owner);
    expect(response.status).toBe(201);
    const id = response.body.data.resortId as number;
    await execute('publish', id, owner).then((r) => expect(r.status).toBe(200));
    expect((await patch(id, { price: 200 }).expect(200)).body.data.status).toBe(
      'published',
    );
    await execute('offline', id, owner).then((r) => expect(r.status).toBe(200));
    await execute('delete', id, owner).then((r) => expect(r.status).toBe(204));
    expect(
      await prisma.outboxEvent.count({
        where: { AggregateType: 'ski_resort', AggregateId: String(id) },
      }),
    ).toBe(5);
    expect(
      await prisma.operationLog.count({
        where: {
          ActorUserId: owner.id,
          ResourceKey: 'resort',
          TargetId: String(id),
        },
      }),
    ).toBe(5);
  });
});
