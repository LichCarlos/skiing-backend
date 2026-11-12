import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { IdentityAccessModule } from '../src/modules/identity-access/identity-access.module.js';
import { CommunityModule } from '../src/modules/community/community.module.js';
import { AdminCommunityService } from '../src/modules/community/application/admin-community-service.js';
import { CommunityWrites } from '../src/modules/community/application/community-writes.js';
import {
  COMMUNITY_UNIT_OF_WORK,
  type CommunityUnitOfWork,
} from '../src/modules/community/application/ports/community-unit-of-work.js';
import { ASSET_STORAGE } from '../src/modules/assets/application/ports/asset-storage.js';
import { BcryptPasswordHasher } from '../src/modules/identity-access/infrastructure/bcrypt-password-hasher.js';
import { PrismaService } from '../src/shared/persistence/prisma.service.js';
import { configureHttp } from '../src/shared/http/configure-http.js';

describe('Community HTTP / PostgreSQL boundaries and atomicity', () => {
  const prefix = `community-http-${randomUUID().slice(0, 8)}`;
  const password = 'community-http-validation-password';
  const users: number[] = [],
    roles: number[] = [],
    dynamics: number[] = [],
    resorts: number[] = [];
  const createReadUrl = vi.fn(async (key: string, ttl: number) => {
    expect(ttl).toBe(900);
    return `https://community-validation.example/${key}`;
  });
  let app: INestApplication<App>, http: App, prisma: PrismaService;
  type Actor = { id: number; token: string };
  let owner: Actor,
    other: Actor,
    admin: Actor,
    portalOnly: Actor,
    grantOnly: Actor;
  beforeAll(async () => {
    if (!process.env.DATABASE_URL)
      throw new Error('Dedicated migrated database required');
    vi.stubEnv(
      'JWT_ACCESS_SECRET',
      'community-validation-secret-at-least-32-characters',
    );
    const module = await Test.createTestingModule({
      imports: [IdentityAccessModule, CommunityModule],
    })
      .overrideProvider(ASSET_STORAGE)
      .useValue({ put: vi.fn(), remove: vi.fn(), createReadUrl })
      .compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.init();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);
    const memberRole = await prisma.role.findUniqueOrThrow({
      where: { SystemRoleCode: 'registered_user' },
    });
    const adminRole = await prisma.role.findUniqueOrThrow({
      where: { SystemRoleCode: 'system_admin' },
    });
    owner = await account(memberRole.RoleId);
    other = await account(memberRole.RoleId);
    admin = await account(adminRole.RoleId);
    portalOnly = await customAccount(['management:portal:enter']);
    grantOnly = await customAccount(['content:dynamic:moderate']);
  });
  afterAll(async () => {
    try {
      if (prisma) {
        await prisma.operationLog.deleteMany({
          where: { ActorUserId: { in: users } },
        });
        await prisma.outboxEvent.deleteMany({
          where: {
            AggregateType: 'Dynamic',
            AggregateId: { in: dynamics.map(String) },
          },
        });
        await prisma.dynamic.deleteMany({
          where: { DynamicId: { in: dynamics } },
        });
        await prisma.skiResort.deleteMany({
          where: { ResortId: { in: resorts } },
        });
        await prisma.asset.deleteMany({
          where: { OwnerUserId: { in: users } },
        });
        await prisma.user.deleteMany({ where: { UserId: { in: users } } });
        await prisma.role.deleteMany({ where: { RoleId: { in: roles } } });
      }
    } finally {
      await app?.close();
      vi.unstubAllEnvs();
    }
  });
  async function account(roleId: number): Promise<Actor> {
    const row = await prisma.user.create({
      data: {
        Account: `${prefix}-${users.length}`,
        Nickname: prefix,
        PasswordHash: await new BcryptPasswordHasher().hash(password),
        UserRoles: { create: { RoleId: roleId } },
      },
    });
    users.push(row.UserId);
    const response = await request(http)
      .post('/api/v1/auth/login')
      .send({ account: row.Account, password })
      .expect(200);
    return { id: row.UserId, token: response.body.data.accessToken as string };
  }
  async function customAccount(keys: string[]) {
    const permissions = await prisma.permission.findMany({
      where: { PermissionKey: { in: keys } },
    });
    expect(permissions).toHaveLength(keys.length);
    const role = await prisma.role.create({
      data: {
        RoleKey: `${prefix}-${roles.length}`,
        RoleName: prefix,
        DataScope: 'all',
        RolePermissions: {
          create: permissions.map((p) => ({ PermissionId: p.PermissionId })),
        },
      },
    });
    roles.push(role.RoleId);
    return account(role.RoleId);
  }
  async function create(content = prefix, images: string[] = []) {
    const response = await request(http)
      .post('/api/v1/dynamics')
      .auth(owner.token, { type: 'bearer' })
      .send({ content, imageAssetIds: images })
      .expect(201);
    const id = response.body.data.dynamicId as number;
    dynamics.push(id);
    return id;
  }
  const get = (path: string, actor?: Actor) => {
    const req = request(http).get(`/api/v1/${path}`);
    return actor ? req.auth(actor.token, { type: 'bearer' }) : req;
  };
  const patch = (id: number, body: object, actor = owner) =>
    request(http)
      .patch(`/api/v1/dynamics/${id}`)
      .auth(actor.token, { type: 'bearer' })
      .send(body);
  const moderate = (
    id: number,
    action: string,
    extra: object = {},
    actor = admin,
  ) =>
    request(http)
      .patch(`/api/v1/admin/dynamics/${id}/moderation`)
      .auth(actor.token, { type: 'bearer' })
      .send({ action, ...extra });
  async function asset(actor = owner, status = 'ready', mime = 'image/png') {
    return prisma.asset.create({
      data: {
        OwnerUserId: actor.id,
        StorageKey: `${prefix}/${randomUUID()}`,
        OriginalName: 'image.png',
        MimeType: mime,
        SizeBytes: 100n,
        Sha256: 'a'.repeat(64),
        Status: status,
      },
    });
  }
  async function snapshot(id: number) {
    return {
      row: await prisma.dynamic.findUniqueOrThrow({ where: { DynamicId: id } }),
      events: await prisma.outboxEvent.count({
        where: { AggregateType: 'Dynamic', AggregateId: String(id) },
      }),
      logs: await prisma.operationLog.count({
        where: {
          ActorUserId: admin.id,
          TargetType: 'Dynamic',
          TargetId: String(id),
        },
      }),
    };
  }
  async function waitForAssetLock(minimum = 1) {
    let waiting = 0;
    for (let i = 0; i < 100; i++) {
      const rows = await prisma.$queryRaw<
        { count: number }[]
      >`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%Asset%'`;
      waiting = rows[0]!.count;
      if (waiting >= minimum) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(waiting).toBeGreaterThanOrEqual(minimum);
  }
  function gate() {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { promise, release };
  }
  it('denies all eleven internal write commands without current grants, before business mutation', async () => {
    const id = await create();
    await moderate(id, 'approve').expect(200);
    const comment = await prisma.comment.create({
      data: {
        DynamicId: id,
        AuthorId: owner.id,
        Content: 'kept',
        Status: 'visible',
      },
    });
    const before = await snapshot(id);
    const writes = app.get(CommunityWrites),
      management = app.get(AdminCommunityService);
    const audit = {
      actorUserId: portalOnly.id,
      traceId: prefix,
      clientIp: null,
      userAgent: null,
    };
    const commands = [
      () =>
        writes.createDynamic(portalOnly.id, {
          content: 'denied',
          imageAssetIds: [],
        }),
      () => writes.updateDynamic(portalOnly.id, id, { content: 'denied' }),
      () => writes.removeDynamic(portalOnly.id, id),
      () => writes.createComment(portalOnly.id, id, { content: 'denied' }),
      () => writes.removeComment(portalOnly.id, comment.CommentId),
      () => writes.setLiked(portalOnly.id, id, true),
      () => writes.setLiked(portalOnly.id, id, false),
      () => management.moderateDynamic(id, { action: 'hide' }, audit),
      () =>
        management.moderateComment(
          comment.CommentId,
          { action: 'hide' },
          audit,
        ),
      () => management.removeDynamic(id, audit),
      () => management.removeComment(comment.CommentId, audit),
    ];
    for (const command of commands)
      await expect(command()).rejects.toMatchObject({ status: 403 });
    expect(await snapshot(id)).toEqual(before);
    expect(
      await prisma.comment.findUniqueOrThrow({
        where: { CommentId: comment.CommentId },
      }),
    ).toMatchObject({ Content: 'kept', Status: 'visible', DeletedAt: null });
    expect(await prisma.likeRecord.count({ where: { DynamicId: id } })).toBe(0);
    expect(
      await prisma.dynamic.count({ where: { AuthorId: portalOnly.id } }),
    ).toBe(0);
  });
  it.each([
    'grant',
    'membership',
    'account',
    'role',
    'conflicting-role',
  ] as const)(
    'rejects create after the Guard passes but %s changes before the write transaction',
    async (kind) => {
      const actor = await customAccount(['community:dynamic:create']);
      const membership = await prisma.userRole.findFirstOrThrow({
        where: { UserId: actor.id },
      });
      const uow = app.get<CommunityUnitOfWork>(COMMUNITY_UNIT_OF_WORK);
      const original = uow.run.bind(uow);
      const delayed: CommunityUnitOfWork['run'] = async (work) => {
        if (kind === 'grant')
          await prisma.rolePermission.deleteMany({
            where: { RoleId: membership.RoleId },
          });
        if (kind === 'membership')
          await prisma.userRole.deleteMany({ where: { UserId: actor.id } });
        if (kind === 'account')
          await prisma.user.update({
            where: { UserId: actor.id },
            data: { Status: 'disabled' },
          });
        if (kind === 'role')
          await prisma.role.update({
            where: { RoleId: membership.RoleId },
            data: { Status: 'disabled' },
          });
        if (kind === 'conflicting-role') {
          const permission = await prisma.permission.findUniqueOrThrow({
            where: { PermissionKey: 'community:dynamic:create' },
          });
          const role = await prisma.role.create({
            data: {
              RoleKey: `${prefix}-${roles.length}`,
              RoleName: prefix,
              DataScope: 'self',
              RolePermissions: {
                create: { PermissionId: permission.PermissionId },
              },
              UserRoles: { create: { UserId: actor.id } },
            },
          });
          roles.push(role.RoleId);
        }
        return original(work);
      };
      const spy = vi.spyOn(uow, 'run').mockImplementationOnce(delayed);
      try {
        await request(http)
          .post('/api/v1/dynamics')
          .auth(actor.token, { type: 'bearer' })
          .send({ content: prefix, imageAssetIds: [] })
          .expect(403);
        expect(spy).toHaveBeenCalledOnce();
        expect(
          await prisma.dynamic.count({ where: { AuthorId: actor.id } }),
        ).toBe(0);
      } finally {
        spy.mockRestore();
      }
    },
  );
  it.each(['management:portal:enter', 'content:dynamic:moderate'])(
    'rejects moderation when %s is revoked between Guard and the write transaction',
    async (key) => {
      const id = await create();
      const before = await snapshot(id);
      const actor = await customAccount([
        'management:portal:enter',
        'content:dynamic:moderate',
      ]);
      const membership = await prisma.userRole.findFirstOrThrow({
        where: { UserId: actor.id },
      });
      const permission = await prisma.permission.findUniqueOrThrow({
        where: { PermissionKey: key },
      });
      const uow = app.get<CommunityUnitOfWork>(COMMUNITY_UNIT_OF_WORK),
        original = uow.run.bind(uow);
      const delayed: CommunityUnitOfWork['run'] = async (work) => {
        await prisma.rolePermission.delete({
          where: {
            RoleId_PermissionId: {
              RoleId: membership.RoleId,
              PermissionId: permission.PermissionId,
            },
          },
        });
        return original(work);
      };
      const spy = vi.spyOn(uow, 'run').mockImplementationOnce(delayed);
      try {
        await moderate(id, 'approve', {}, actor).expect(403);
        expect(spy).toHaveBeenCalledOnce();
        expect(await snapshot(id)).toEqual(before);
        expect(
          await prisma.operationLog.count({ where: { ActorUserId: actor.id } }),
        ).toBe(0);
      } finally {
        spy.mockRestore();
      }
    },
  );
  it.each(['owner', 'admin'] as const)(
    'keeps the image shared lock until the post commits and forces %s deletion to recheck its reference',
    async (kind) => {
      const row = await asset();
      const entered = gate(),
        resume = gate();
      const uow = app.get<CommunityUnitOfWork>(COMMUNITY_UNIT_OF_WORK),
        original = uow.run.bind(uow);
      const delayed: CommunityUnitOfWork['run'] = async (work) =>
        original(async (tx) => {
          const create = tx.createDynamic.bind(tx);
          tx.createDynamic = async (...args) => {
            entered.release();
            await resume.promise;
            return create(...args);
          };
          return work(tx);
        });
      const spy = vi.spyOn(uow, 'run').mockImplementationOnce(delayed);
      const binding = create(prefix, [String(row.AssetId)]);
      let deletion: Promise<request.Response> | undefined;
      try {
        await entered.promise;
        deletion = request(http)
          .delete(
            `/api/v1/${kind === 'admin' ? 'admin/' : ''}assets/${row.AssetId}`,
          )
          .auth((kind === 'admin' ? admin : owner).token, { type: 'bearer' })
          .then((r) => r);
        await waitForAssetLock();
      } finally {
        resume.release();
        spy.mockRestore();
      }
      const id = await binding;
      expect((await deletion!).status).toBe(422);
      expect((await snapshot(id)).events).toBe(1);
      expect(
        await prisma.dynamicImage.count({
          where: { AssetId: row.AssetId, DynamicId: id },
        }),
      ).toBe(1);
      expect(
        (
          await prisma.asset.findUniqueOrThrow({
            where: { AssetId: row.AssetId },
          })
        ).Status,
      ).toBe('ready');
    },
  );
  it('retries a real row-lock serialization failure and rejects binding after soft deletion commits', async () => {
    const row = await asset();
    const entered = gate(),
      resume = gate();
    const before = await prisma.dynamic.count({
      where: { AuthorId: owner.id },
    });
    const holding = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "AssetId" FROM "Asset" WHERE "AssetId"=${row.AssetId} FOR UPDATE`;
        await tx.asset.update({
          where: { AssetId: row.AssetId },
          data: { Status: 'deleted' },
        });
        entered.release();
        await resume.promise;
      },
      { timeout: 15000 },
    );
    await entered.promise;
    const binding = request(http)
      .post('/api/v1/dynamics')
      .auth(owner.token, { type: 'bearer' })
      .send({ content: prefix, imageAssetIds: [String(row.AssetId)] })
      .then((r) => r);
    try {
      await waitForAssetLock();
    } finally {
      resume.release();
      await holding;
    }
    expect((await binding).status).toBe(404);
    expect(await prisma.dynamic.count({ where: { AuthorId: owner.id } })).toBe(
      before,
    );
    expect(
      await prisma.dynamicImage.count({ where: { AssetId: row.AssetId } }),
    ).toBe(0);
  });
  it('rejects a resort reference after its publication state changes while the reference lock is waiting', async () => {
    const resort = await prisma.skiResort.create({
      data: {
        Name: prefix,
        LegacyDistance: 0,
        Price: 100,
        SnowCondition: 'powder',
        Description: prefix,
        Status: 'published',
      },
    });
    resorts.push(resort.ResortId);
    const entered = gate(),
      resume = gate();
    const holding = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "ResortId" FROM "SkiResort" WHERE "ResortId"=${resort.ResortId} FOR UPDATE`;
        await tx.skiResort.update({
          where: { ResortId: resort.ResortId },
          data: { Status: 'pending_review' },
        });
        entered.release();
        await resume.promise;
      },
      { timeout: 15000 },
    );
    await entered.promise;
    const binding = request(http)
      .post('/api/v1/dynamics')
      .auth(owner.token, { type: 'bearer' })
      .send({ content: prefix, imageAssetIds: [], resortId: resort.ResortId })
      .then((r) => r);
    try {
      let waiting = 0;
      for (let i = 0; i < 100; i++) {
        const rows = await prisma.$queryRaw<
          { count: number }[]
        >`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%SkiResort%'`;
        waiting = rows[0]!.count;
        if (waiting >= 1) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(waiting).toBeGreaterThanOrEqual(1);
    } finally {
      resume.release();
      await holding;
    }
    expect((await binding).status).toBe(404);
    expect(
      await prisma.dynamic.count({ where: { ResortId: resort.ResortId } }),
    ).toBe(0);
  });
  it('enforces pending/published/hidden transitions, own visibility, audit and Outbox', async () => {
    const id = await create('  original  ');
    await get(`dynamics/${id}`).expect(404);
    expect(
      (await get(`me/dynamics/${id}`, owner).expect(200)).body.data,
    ).toMatchObject({ content: 'original', status: 'pending' });
    await get(`me/dynamics/${id}`, other).expect(404);
    await patch(id, { content: 'foreign' }, other).expect(403);
    await moderate(id, 'approve', { reason: '  checked  ' }).expect(200);
    expect((await get(`dynamics/${id}`).expect(200)).body.data.content).toBe(
      'original',
    );
    await moderate(id, 'approve').expect(409);
    await patch(id, { content: 'edited' }).expect(200);
    await get(`dynamics/${id}`).expect(404);
    await moderate(id, 'hide').expect(200);
    await patch(id, { content: 'hidden edit' }).expect(200);
    expect(
      (await get(`me/dynamics/${id}`, owner).expect(200)).body.data.status,
    ).toBe('hidden');
    await moderate(id, 'restore').expect(200);
    const state = await snapshot(id);
    expect(state.row.Status).toBe('published');
    expect(state.events).toBe(6);
    expect(state.logs).toBe(3);
  });
  it.each([
    {},
    { content: null },
    { imageAssetIds: null },
    { content: '  ' },
    { content: 1 },
    { imageAssetIds: [1] },
    { status: 'published' },
    { authorId: 1 },
    { likeCount: 99 },
    { resortId: 2147483648 },
    { content: 'x'.repeat(10001) },
  ])(
    'rejects invalid PATCH %j without changing published state or events',
    async (body) => {
      const id = await create();
      await moderate(id, 'approve').expect(200);
      const before = await snapshot(id);
      await patch(id, body).expect(400);
      expect(await snapshot(id)).toEqual(before);
    },
  );
  it.each([
    { content: null, imageAssetIds: [] },
    { content: 'ok', imageAssetIds: null },
    { content: 'ok', imageAssetIds: [], resortId: null },
    { content: 'ok', imageAssetIds: [], status: 'published' },
  ])('rejects invalid create %j without inserting a dynamic', async (body) => {
    const before = await prisma.dynamic.count({
      where: { AuthorId: owner.id },
    });
    await request(http)
      .post('/api/v1/dynamics')
      .auth(owner.token, { type: 'bearer' })
      .send(body)
      .expect(400);
    expect(await prisma.dynamic.count({ where: { AuthorId: owner.id } })).toBe(
      before,
    );
  });
  it.each(['0', '-1', '2147483648', '9007199254740992', '1.1'])(
    'rejects invalid target ID %s across read/write paths',
    async (id) => {
      await get(`dynamics/${id}`).expect(400);
      await get(`dynamics/${id}/comments`).expect(400);
      await get(`me/dynamics/${id}`, owner).expect(400);
      await get(`admin/dynamics/${id}`, admin).expect(400);
      await request(http)
        .put(`/api/v1/dynamics/${id}/like`)
        .auth(owner.token, { type: 'bearer' })
        .expect(400);
    },
  );
  it('rejects overflowing pagination and malformed cursors before database access', async () => {
    const id = await create();
    for (const path of [
      `me/dynamics`,
      `admin/dynamics`,
      `dynamics/${id}/comments`,
      `admin/dynamics/${id}/comments`,
    ]) {
      await get(
        `${path}?page=2147483648&pageSize=100`,
        path.startsWith('admin') ? admin : owner,
      ).expect(400);
    }
    for (const cursor of [
      '',
      '!',
      Buffer.from(
        JSON.stringify({ createdAt: '2026-01-01', dynamicId: 1 }),
      ).toString('base64url'),
      Buffer.from(
        JSON.stringify({
          createdAt: '2026-01-01T00:00:00.000Z',
          dynamicId: 2147483648,
        }),
      ).toString('base64url'),
    ]) {
      await get(`dynamics?cursor=${encodeURIComponent(cursor)}`).expect(400);
    }
  });
  it('paginates tied timestamps by ID, matches only body case-insensitively and excludes pending/hidden/deleted', async () => {
    const ids = [
      await create(`${prefix} Snow ABC`),
      await create(`${prefix} Snow abc`),
      await create(`${prefix} Snow AbC`),
    ];
    await prisma.dynamic.updateMany({
      where: { DynamicId: { in: ids } },
      data: {
        Status: 'published',
        CreateTime: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    const hidden = await create(`${prefix} Snow abc`);
    await prisma.dynamic.update({
      where: { DynamicId: hidden },
      data: { Status: 'hidden' },
    });
    const first = (
      await get(`dynamics?keyword=${prefix}%20sNoW%20aBc&limit=2`).expect(200)
    ).body.data;
    expect(first.items.map((r: { dynamicId: number }) => r.dynamicId)).toEqual([
      ids[2],
      ids[1],
    ]);
    const second = (
      await get(
        `dynamics?keyword=${prefix}%20sNoW%20aBc&limit=2&cursor=${first.nextCursor}`,
      ).expect(200)
    ).body.data;
    expect(second.items.map((r: { dynamicId: number }) => r.dynamicId)).toEqual(
      [ids[0]],
    );
    expect(second.nextCursor).toBeNull();
  });
  it.each(['%', '_', '\\'])(
    'matches literal keyword symbol %s without treating it as a wildcard',
    async (symbol) => {
      const exact = await create(`${prefix} literal ${symbol} symbol`);
      const decoy = await create(`${prefix} literal X symbol`);
      await prisma.dynamic.updateMany({
        where: { DynamicId: { in: [exact, decoy] } },
        data: { Status: 'published' },
      });
      const params = new URLSearchParams({
        keyword: `${prefix} literal ${symbol} symbol`,
      });
      const response = await get(`dynamics?${params}`).expect(200);
      expect(
        response.body.data.items.map(
          (item: { dynamicId: number }) => item.dynamicId,
        ),
      ).toEqual([exact]);
      expect(response.body.data).toMatchObject({
        hasNext: false,
        nextCursor: null,
      });
    },
  );
  it('round-trips 150 owned images in order on create, edit and public reading', async () => {
    const images = [];
    for (let i = 0; i < 150; i++) images.push(String((await asset()).AssetId));
    const id = await create(prefix, images);
    expect(
      (await get(`me/dynamics/${id}`, owner).expect(200)).body.data.images.map(
        (r: { assetId: string }) => r.assetId,
      ),
    ).toEqual(images);
    const reversed = images.slice().reverse();
    await patch(id, { imageAssetIds: reversed }).expect(200);
    expect(
      (await get(`me/dynamics/${id}`, owner).expect(200)).body.data.images.map(
        (r: { assetId: string }) => r.assetId,
      ),
    ).toEqual(reversed);
    await moderate(id, 'approve').expect(200);
    const publicDetail = (await get(`dynamics/${id}`).expect(200)).body.data;
    expect(publicDetail.imageCount).toBe(150);
    expect(publicDetail.imageUrls).toHaveLength(150);
  });
  it('accepts only ready images owned by the author; corrupted associations never receive signed URLs', async () => {
    const good = await asset(),
      foreign = await asset(other),
      rejected = await asset(owner, 'rejected'),
      invalidMime = await asset(owner, 'ready', 'text/plain');
    for (const row of [foreign, rejected, invalidMime]) {
      await request(http)
        .post('/api/v1/dynamics')
        .auth(owner.token, { type: 'bearer' })
        .send({ content: prefix, imageAssetIds: [String(row.AssetId)] })
        .expect(404);
    }
    const id = await create(prefix, [String(good.AssetId)]);
    await prisma.dynamicImage.createMany({
      data: [foreign, rejected, invalidMime].map((row, index) => ({
        DynamicId: id,
        AssetId: row.AssetId,
        SortOrder: index + 1,
      })),
    });
    await moderate(id, 'approve').expect(200);
    createReadUrl.mockClear();
    const detail = (await get(`dynamics/${id}`).expect(200)).body.data;
    const own = (await get(`me/dynamics/${id}`, owner).expect(200)).body.data;
    expect(detail.imageCount).toBe(1);
    expect(detail.imageUrls).toEqual([
      `https://community-validation.example/${good.StorageKey}`,
    ]);
    expect(own.images).toEqual([
      { assetId: String(good.AssetId), url: detail.imageUrls[0] },
    ]);
    const feed = (await get(`dynamics?keyword=${prefix}`).expect(200)).body
      .data;
    expect(
      feed.items.find((r: { dynamicId: number }) => r.dynamicId === id)
        .imageCount,
    ).toBe(1);
    for (const row of [foreign, rejected, invalidMime])
      expect(createReadUrl).not.toHaveBeenCalledWith(row.StorageKey, 900);
    expect(createReadUrl).toHaveBeenCalledWith(good.StorageKey, 900);
  });
  it('keeps likes idempotent, user-specific and private in public responses, including concurrent writes', async () => {
    const id = await create();
    await moderate(id, 'approve').expect(200);
    const like = () =>
      request(http)
        .put(`/api/v1/dynamics/${id}/like`)
        .auth(owner.token, { type: 'bearer' });
    await like().expect(200);
    const parallel = await Promise.all([like(), like()]);
    expect(parallel.map((r) => r.status)).toEqual([200, 200]);
    expect(await prisma.likeRecord.count({ where: { DynamicId: id } })).toBe(1);
    for (const [actor, expected] of [
      [owner, true],
      [other, false],
      [undefined, false],
    ] as const) {
      const response = await get(`dynamics/${id}`, actor).expect(200);
      expect(response.body.data).toMatchObject({
        likedByMe: expected,
        likeCount: 1,
      });
      expect(response.headers['cache-control']).toBe('private, no-store');
      const feed = await get(`dynamics?keyword=${prefix}`, actor).expect(200);
      expect(feed.headers['cache-control']).toBe('private, no-store');
      expect(
        feed.body.data.items.find(
          (r: { dynamicId: number }) => r.dynamicId === id,
        ).likedByMe,
      ).toBe(expected);
    }
    for (let i = 0; i < 2; i++)
      await request(http)
        .delete(`/api/v1/dynamics/${id}/like`)
        .auth(owner.token, { type: 'bearer' })
        .expect(200);
    expect(await prisma.likeRecord.count({ where: { DynamicId: id } })).toBe(0);
    await moderate(id, 'hide').expect(200);
    await like().expect(404);
    await request(http)
      .post(`/api/v1/dynamics/${id}/comments`)
      .auth(owner.token, { type: 'bearer' })
      .send({ content: 'no' })
      .expect(404);
  });
  it('separates visible comments from management pagination and enforces author deletion', async () => {
    const id = await create();
    await moderate(id, 'approve').expect(200);
    const created = await request(http)
      .post(`/api/v1/dynamics/${id}/comments`)
      .auth(owner.token, { type: 'bearer' })
      .send({ content: '  comment  ' })
      .expect(201);
    const commentId = created.body.data.commentId as number;
    await request(http)
      .patch(`/api/v1/admin/comments/${commentId}/moderation`)
      .auth(admin.token, { type: 'bearer' })
      .send({ action: 'hide', reason: ' checked ' })
      .expect(200);
    expect(
      (await get(`dynamics/${id}/comments`).expect(200)).body.data.total,
    ).toBe(0);
    const managed = (
      await get(`admin/dynamics/${id}/comments`, admin).expect(200)
    ).body.data;
    expect(managed.total).toBe(1);
    expect(managed.items[0]).toMatchObject({
      commentId,
      status: 'hidden',
      content: 'comment',
    });
    await request(http)
      .delete(`/api/v1/comments/${commentId}`)
      .auth(other.token, { type: 'bearer' })
      .expect(403);
    await request(http)
      .patch(`/api/v1/admin/comments/${commentId}/moderation`)
      .auth(admin.token, { type: 'bearer' })
      .send({ action: 'restore' })
      .expect(200);
    expect(
      (await get(`dynamics/${id}/comments`).expect(200)).body.data.total,
    ).toBe(1);
    await request(http)
      .delete(`/api/v1/comments/${commentId}`)
      .auth(owner.token, { type: 'bearer' })
      .expect(204);
    expect(
      (await get(`dynamics/${id}/comments`).expect(200)).body.data.total,
    ).toBe(0);
    await moderate(id, 'hide').expect(200);
    await get(`dynamics/${id}/comments`).expect(404);
  });
  it('requires authentication, management entry and moderation grants; old JWTs do not retain revoked grants', async () => {
    await request(http)
      .post('/api/v1/dynamics')
      .send({ content: prefix, imageAssetIds: [] })
      .expect(401);
    for (const actor of [owner, portalOnly, grantOnly])
      await get('admin/dynamics', actor).expect(403);
    const actor = await customAccount([
      'management:portal:enter',
      'content:dynamic:moderate',
    ]);
    await get('admin/dynamics', actor).expect(200);
    const roleId = (
      await prisma.userRole.findFirstOrThrow({ where: { UserId: actor.id } })
    ).RoleId;
    await prisma.rolePermission.deleteMany({ where: { RoleId: roleId } });
    await get('admin/dynamics', actor).expect(403);
  });
  it.each([
    { reason: null },
    { reason: 'x'.repeat(501) },
    { action: 'publish' },
    { status: 'published' },
  ])(
    'rejects invalid moderation %j without state/audit/events',
    async (extra) => {
      const id = await create();
      const before = await snapshot(id);
      await moderate(id, 'approve', extra).expect(400);
      expect(await snapshot(id)).toEqual(before);
    },
  );
  it('rolls back state, Outbox and audit when the real database rejects the audit INSERT', async () => {
    const id = await create();
    const before = await snapshot(id);
    await expect(
      app.get(AdminCommunityService).moderateDynamic(
        id,
        { action: 'approve' },
        {
          actorUserId: admin.id,
          traceId: 'x'.repeat(101),
          clientIp: null,
          userAgent: null,
        },
      ),
    ).rejects.toThrow();
    expect(await snapshot(id)).toEqual(before);
  });
  it('soft deletes through owner/admin endpoints and removes public/own visibility', async () => {
    const id = await create();
    await request(http)
      .delete(`/api/v1/dynamics/${id}`)
      .auth(other.token, { type: 'bearer' })
      .expect(403);
    await request(http)
      .delete(`/api/v1/dynamics/${id}`)
      .auth(owner.token, { type: 'bearer' })
      .expect(204);
    await get(`me/dynamics/${id}`, owner).expect(404);
    await get(`dynamics/${id}`).expect(404);
    expect((await snapshot(id)).row.DeletedAt).not.toBeNull();
    const managed = await create();
    await request(http)
      .delete(`/api/v1/admin/dynamics/${managed}`)
      .auth(admin.token, { type: 'bearer' })
      .expect(204);
    await get(`admin/dynamics/${managed}`, admin).expect(404);
    expect((await snapshot(managed)).logs).toBe(1);
  });
});
