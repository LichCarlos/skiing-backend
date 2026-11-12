import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { IdentityAccessModule } from '../src/modules/identity-access/identity-access.module.js';
import { CommunityModule } from '../src/modules/community/community.module.js';
import { ASSET_STORAGE } from '../src/modules/assets/application/ports/asset-storage.js';
import { BcryptPasswordHasher } from '../src/modules/identity-access/infrastructure/bcrypt-password-hasher.js';
import { PrismaUserProfileRepository } from '../src/modules/identity-access/infrastructure/prisma-user-profile.repository.js';
import { PrismaService } from '../src/shared/persistence/prisma.service.js';
import { configureHttp } from '../src/shared/http/configure-http.js';

describe('D-30 own profile HTTP / PostgreSQL', () => {
  const prefix = `profile-${randomUUID().slice(0, 8)}`;
  const password = 'profile-database-validation-password';
  const users: number[] = [];
  const roles: number[] = [];
  const dynamics: number[] = [];
  const createReadUrl = vi.fn(async (key: string, ttl: number) => {
    expect(ttl).toBe(900);
    return `https://profile-validation.example/${key}?ttl=${ttl}`;
  });
  const remove = vi.fn(async () => undefined);
  let app: INestApplication<App>;
  let http: App;
  let prisma: PrismaService;
  let owner: { id: number; token: string; account: string };
  let other: typeof owner;
  let admin: typeof owner;
  let noGrant: typeof owner;
  beforeAll(async () => {
    if (!process.env.DATABASE_URL)
      throw new Error('Dedicated migrated database required');
    vi.stubEnv(
      'JWT_ACCESS_SECRET',
      'profile-validation-secret-at-least-32-characters',
    );
    const module = await Test.createTestingModule({
      imports: [IdentityAccessModule, CommunityModule],
    })
      .overrideProvider(ASSET_STORAGE)
      .useValue({ put: vi.fn(), remove, createReadUrl })
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
    const role = await prisma.role.create({
      data: { RoleKey: prefix, RoleName: prefix, DataScope: 'self' },
    });
    roles.push(role.RoleId);
    noGrant = await account(role.RoleId);
  });
  afterAll(async () => {
    try {
      if (prisma) {
        await prisma.comment.deleteMany({ where: { AuthorId: { in: users } } });
        await prisma.dynamic.deleteMany({
          where: { DynamicId: { in: dynamics } },
        });
        await prisma.operationLog.deleteMany({
          where: { ActorUserId: { in: users } },
        });
        await prisma.user.updateMany({
          where: { UserId: { in: users } },
          data: { AvatarAssetId: null },
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
  async function account(roleId: number) {
    const row = await prisma.user.create({
      data: {
        Account: `${prefix}-${users.length}`,
        Nickname: 'Original',
        PasswordHash: await new BcryptPasswordHasher().hash(password),
        Avatar: 'https://legacy.example/avatar.png',
        UserRoles: { create: { RoleId: roleId } },
      },
    });
    users.push(row.UserId);
    const login = await request(http)
      .post('/api/v1/auth/login')
      .send({ account: row.Account, password })
      .expect(200);
    return {
      id: row.UserId,
      account: row.Account,
      token: login.body.data.accessToken as string,
    };
  }
  async function asset(
    actor = owner,
    status = 'ready',
    mimeType = 'image/png',
  ) {
    return prisma.asset.create({
      data: {
        OwnerUserId: actor.id,
        StorageKey: `${prefix}/${randomUUID()}`,
        OriginalName: 'avatar.png',
        MimeType: mimeType,
        SizeBytes: 100n,
        Sha256: 'a'.repeat(64),
        Status: status,
      },
    });
  }
  const patch = (body: object, actor = owner) =>
    request(http)
      .patch('/api/v1/account/profile')
      .auth(actor.token, { type: 'bearer' })
      .send(body);
  it('updates only the authenticated nickname, retains the legacy URL and audits field names', async () => {
    const before = await prisma.user.findUniqueOrThrow({
      where: { UserId: other.id },
    });
    const response = await patch({ nickname: '  雪客🏂  ' }).expect(200);
    expect(response.body.data).toEqual({
      userId: owner.id,
      account: owner.account,
      nickname: '雪客🏂',
      avatarAssetId: null,
      avatarUrl: 'https://legacy.example/avatar.png',
    });
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { UserId: other.id } }))
        .Nickname,
    ).toBe(before.Nickname);
    const log = await prisma.operationLog.findFirstOrThrow({
      where: { ActorUserId: owner.id, ActionKey: 'account:profile:update' },
      orderBy: { OperationLogId: 'desc' },
    });
    expect(log.Metadata).toEqual({ fields: ['nickname'] });
    expect(JSON.stringify(log.Metadata)).not.toContain('雪客');
  });
  it.each([
    {},
    { nickname: null },
    { nickname: ' ' },
    { nickname: '雪'.repeat(51) },
    { avatarAssetId: 1 },
    { avatarAssetId: '9223372036854775808' },
    { avatarAssetId: '0' },
    { userId: 1, nickname: 'spoof' },
    { roles: ['system_admin'], nickname: 'spoof' },
    { avatarUrl: 'https://untrusted.example' },
  ])(
    'rejects invalid/unknown input %j without audit or mutation',
    async (body) => {
      const before = await prisma.user.findUniqueOrThrow({
        where: { UserId: owner.id },
      });
      const count = await prisma.operationLog.count({
        where: { ActorUserId: owner.id },
      });
      await patch(body).expect(400);
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { UserId: owner.id } }))
          .Nickname,
      ).toBe(before.Nickname);
      expect(
        await prisma.operationLog.count({ where: { ActorUserId: owner.id } }),
      ).toBe(count);
    },
  );
  it('rejects anonymous, ungranted and disabled accounts, including transaction-level revalidation', async () => {
    await request(http)
      .patch('/api/v1/account/profile')
      .send({ nickname: 'No' })
      .expect(401);
    await patch({ nickname: 'No' }, noGrant).expect(403);
    const repo = app.get(PrismaUserProfileRepository);
    const audit = { traceId: prefix, clientIp: null, userAgent: null };
    await expect(
      repo.updateOwn(noGrant.id, { nickname: 'No' }, audit),
    ).rejects.toThrow();
    await prisma.user.update({
      where: { UserId: noGrant.id },
      data: { Status: 'disabled' },
    });
    const response = await patch({ nickname: 'No' }, noGrant);
    expect([401, 403]).toContain(response.status);
    await expect(
      repo.updateOwn(noGrant.id, { nickname: 'No' }, audit),
    ).rejects.toThrow();
  });
  it('rejects permission revocation even with an existing access token and revalidates it in persistence', async () => {
    const permission = await prisma.permission.findUniqueOrThrow({
      where: { PermissionKey: 'account:profile:update' },
    });
    const role = await prisma.role.create({
      data: {
        RoleKey: `${prefix}-revoke`,
        RoleName: 'Profile grant',
        DataScope: 'self',
        RolePermissions: { create: { PermissionId: permission.PermissionId } },
      },
    });
    roles.push(role.RoleId);
    const actor = await account(role.RoleId);
    await patch({ nickname: 'Allowed' }, actor).expect(200);
    await prisma.rolePermission.deleteMany({ where: { RoleId: role.RoleId } });
    await patch({ nickname: 'Denied' }, actor).expect(403);
    await expect(
      app
        .get(PrismaUserProfileRepository)
        .updateOwn(
          actor.id,
          { nickname: 'Denied' },
          { traceId: prefix, clientIp: null, userAgent: null },
        ),
    ).rejects.toThrow();
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { UserId: actor.id } }))
        .Nickname,
    ).toBe('Allowed');
  });
  it.each(['image/jpeg', 'image/png', 'image/webp'])(
    'binds ready own %s with a fresh signed URL and clears the legacy URL',
    async (mimeType) => {
      const row = await asset(owner, 'ready', mimeType);
      const result = await patch({
        avatarAssetId: row.AssetId.toString(),
      }).expect(200);
      expect(result.body.data.avatarAssetId).toBe(row.AssetId.toString());
      expect(result.body.data.avatarUrl).toBe(
        `https://profile-validation.example/${row.StorageKey}?ttl=900`,
      );
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { UserId: owner.id } }))
          .Avatar,
      ).toBeNull();
    },
  );
  it.each([
    'pending_scan',
    'rejected',
    'deleted',
    'not-owned',
    'not-image',
    'missing',
  ])('rejects an invalid avatar: %s', async (kind) => {
    const row = await asset(
      kind === 'not-owned' ? other : owner,
      ['pending_scan', 'rejected', 'deleted'].includes(kind) ? kind : 'ready',
      kind === 'not-image' ? 'text/plain' : 'image/png',
    );
    if (kind === 'missing')
      await prisma.asset.delete({ where: { AssetId: row.AssetId } });
    await patch({ avatarAssetId: row.AssetId.toString() }).expect(400);
  });
  it('retains omitted avatar; exposes it in login/me/refresh, public feed/detail/comments and own dynamics', async () => {
    const row = await asset();
    const id = row.AssetId.toString();
    const expected = `https://profile-validation.example/${row.StorageKey}?ttl=900`;
    await patch({ avatarAssetId: id }).expect(200);
    expect(
      (await patch({ nickname: 'Preserved' }).expect(200)).body.data
        .avatarAssetId,
    ).toBe(id);
    const login = await request(http)
      .post('/api/v1/auth/login')
      .send({ account: owner.account, password })
      .expect(200);
    expect(login.body.data.currentUser.avatarUrl).toBe(expected);
    const me = await request(http)
      .get('/api/v1/auth/me')
      .auth(owner.token, { type: 'bearer' })
      .expect(200);
    expect(me.body.data.avatarUrl).toBe(expected);
    const refresh = await request(http)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: login.body.data.refreshToken })
      .expect(200);
    expect(refresh.body.data.currentUser.avatarUrl).toBe(expected);
    const dynamic = await prisma.dynamic.create({
      data: { AuthorId: owner.id, Content: prefix, Status: 'published' },
    });
    dynamics.push(dynamic.DynamicId);
    await prisma.comment.create({
      data: {
        AuthorId: owner.id,
        DynamicId: dynamic.DynamicId,
        Content: 'Comment',
      },
    });
    const feed = await request(http)
      .get('/api/v1/dynamics')
      .query({ keyword: prefix })
      .expect(200);
    expect(feed.body.data.items[0].author.avatarUrl).toBe(expected);
    const detail = await request(http)
      .get(`/api/v1/dynamics/${dynamic.DynamicId}`)
      .expect(200);
    expect(detail.body.data.author.avatarUrl).toBe(expected);
    const comments = await request(http)
      .get(`/api/v1/dynamics/${dynamic.DynamicId}/comments`)
      .expect(200);
    expect(comments.body.data.items[0].author.avatarUrl).toBe(expected);
    const own = await request(http)
      .get(`/api/v1/me/dynamics/${dynamic.DynamicId}`)
      .auth(owner.token, { type: 'bearer' })
      .expect(200);
    expect(own.body.data.author.avatarUrl).toBe(expected);
    const ownPage = await request(http)
      .get('/api/v1/me/dynamics')
      .auth(owner.token, { type: 'bearer' })
      .expect(200);
    expect(ownPage.body.data.items[0].author.avatarUrl).toBe(expected);
  });
  it('protects avatar references from owner, administrator and physical deletion, then allows deletion after clearing', async () => {
    const row = await asset();
    const id = row.AssetId.toString();
    await patch({ avatarAssetId: id }).expect(200);
    const inventory = await request(http)
      .get(`/api/v1/admin/assets/${id}`)
      .auth(admin.token, { type: 'bearer' })
      .expect(200);
    expect(inventory.body.data.references.userAvatars).toBe(1);
    await request(http)
      .delete(`/api/v1/assets/${id}`)
      .auth(owner.token, { type: 'bearer' })
      .expect(422);
    await request(http)
      .delete(`/api/v1/admin/assets/${id}`)
      .auth(admin.token, { type: 'bearer' })
      .expect(422);
    await expect(
      prisma.asset.delete({ where: { AssetId: row.AssetId } }),
    ).rejects.toMatchObject({ code: 'P2003' });
    expect(
      (await patch({ avatarAssetId: null }).expect(200)).body.data,
    ).toMatchObject({ avatarAssetId: null, avatarUrl: null });
    await request(http)
      .delete(`/api/v1/assets/${id}`)
      .auth(owner.token, { type: 'bearer' })
      .expect(204);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { UserId: owner.id } }))
        .Avatar,
    ).toBeNull();
  });
  it('rolls back nickname, avatar and legacy cleanup when audit INSERT fails', async () => {
    const row = await asset();
    const before = await prisma.user.findUniqueOrThrow({
      where: { UserId: owner.id },
    });
    await expect(
      app
        .get(PrismaUserProfileRepository)
        .updateOwn(
          owner.id,
          { nickname: 'Rollback', avatarAssetId: row.AssetId.toString() },
          { traceId: 'x'.repeat(101), clientIp: null, userAgent: null },
        ),
    ).rejects.toThrow();
    expect(
      await prisma.user.findUniqueOrThrow({ where: { UserId: owner.id } }),
    ).toMatchObject({
      Nickname: before.Nickname,
      AvatarAssetId: before.AvatarAssetId,
      Avatar: before.Avatar,
    });
  });
  it.each(['owner', 'admin'])(
    'rechecks committed avatar references after the %s deletion has already waited for the row lock',
    async (kind) => {
      const row = await asset();
      const id = row.AssetId.toString();
      let release!: () => void, locked!: () => void;
      const ready = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const holding = prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT "AssetId" FROM "Asset" WHERE "AssetId" = ${row.AssetId} FOR UPDATE`;
          await tx.user.update({
            where: { UserId: owner.id },
            data: { AvatarAssetId: row.AssetId, Avatar: null },
          });
          locked();
          await gate;
        },
        { timeout: 15_000 },
      );
      await ready;
      const deletion = request(http)
        .delete(`/api/v1/${kind === 'admin' ? 'admin/' : ''}assets/${id}`)
        .auth((kind === 'admin' ? admin : owner).token, { type: 'bearer' })
        .then((response) => response);
      try {
        let waiting = 0;
        for (let i = 0; i < 100; i++) {
          const rows = await prisma.$queryRaw<
            { count: number }[]
          >`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%Asset%'`;
          waiting = rows[0].count;
          if (waiting >= 1) break;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(waiting).toBeGreaterThanOrEqual(1);
      } finally {
        release();
        await holding;
      }
      expect((await deletion).status).toBe(422);
      expect(
        (
          await prisma.asset.findUniqueOrThrow({
            where: { AssetId: row.AssetId },
          })
        ).Status,
      ).toBe('ready');
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { UserId: owner.id } }))
          .AvatarAssetId,
      ).toBe(row.AssetId);
    },
  );
  it.each(['owner', 'admin'])(
    'serializes real concurrent binding and %s deletion without a deleted bound avatar',
    async (kind) => {
      const row = await asset();
      const id = row.AssetId.toString();
      let release!: () => void, locked!: () => void;
      const ready = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const holding = prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT "AssetId" FROM "Asset" WHERE "AssetId" = ${row.AssetId} FOR UPDATE`;
          locked();
          await gate;
        },
        { timeout: 15_000 },
      );
      await ready;
      const requests = Promise.all([
        patch({ avatarAssetId: id }).then((response) => response),
        request(http)
          .delete(`/api/v1/${kind === 'admin' ? 'admin/' : ''}assets/${id}`)
          .auth((kind === 'admin' ? admin : owner).token, { type: 'bearer' })
          .then((response) => response),
      ]);
      try {
        let waiting = 0;
        for (let i = 0; i < 100; i++) {
          const rows = await prisma.$queryRaw<
            { count: number }[]
          >`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%Asset%'`;
          waiting = rows[0].count;
          if (waiting >= 2) break;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(waiting).toBeGreaterThanOrEqual(2);
      } finally {
        release();
        await holding;
      }
      const [binding, deletion] = await requests;
      expect([200, 400, 409]).toContain(binding.status);
      expect(kind === 'admin' ? [204, 409, 422] : [204, 422]).toContain(
        deletion.status,
      );
      expect(binding.status === 200 && deletion.status === 204).toBe(false);
      const current = await prisma.user.findUniqueOrThrow({
        where: { UserId: owner.id },
      });
      const stored = await prisma.asset.findUniqueOrThrow({
        where: { AssetId: row.AssetId },
      });
      if (binding.status === 200)
        expect(current.AvatarAssetId).toBe(row.AssetId);
      else expect(current.AvatarAssetId).not.toBe(row.AssetId);
      if (deletion.status === 204) {
        expect(current.AvatarAssetId).not.toBe(row.AssetId);
        expect(stored.Status).toBe('deleted');
      } else expect(stored.Status).toBe('ready');
    },
  );
});
