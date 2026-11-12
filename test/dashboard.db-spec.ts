import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { IdentityAccessModule } from '../src/modules/identity-access/identity-access.module.js';
import { BcryptPasswordHasher } from '../src/modules/identity-access/infrastructure/bcrypt-password-hasher.js';
import { PrismaDashboardReader } from '../src/modules/platform-administration/infrastructure/prisma-dashboard.reader.js';
import { DASHBOARD_READER } from '../src/modules/platform-administration/application/ports/dashboard-reader.js';
import { GetDashboardSummary } from '../src/modules/platform-administration/application/get-dashboard-summary.js';
import { DashboardController } from '../src/modules/platform-administration/presentation/http/dashboard.controller.js';
import { PrismaService } from '../src/shared/persistence/prisma.service.js';
import { configureHttp } from '../src/shared/http/configure-http.js';

describe('Dashboard authorized snapshot (dedicated real PostgreSQL + HTTP)', () => {
  const prefix = `dash_${randomUUID().slice(0, 8)}`;
  const users: number[] = [],
    roles: number[] = [],
    merchants: number[] = [],
    resorts: number[] = [],
    articles: number[] = [],
    dynamics: number[] = [];
  const permissionIds = new Map<string, number>();
  const path = '/api/v1/admin/dashboard/summary';
  let app: INestApplication<App>,
    http: App,
    prisma: PrismaService,
    reader: PrismaDashboardReader;
  let actor: { id: number; token: string },
    other: { id: number; token: string },
    admin: { id: number; token: string };
  let actorRole: number, ragId: number;
  let categoryTypeCreated = false;
  beforeAll(async () => {
    if (!process.env.DATABASE_URL)
      throw new Error('Dedicated migrated DATABASE_URL required');
    vi.stubEnv(
      'JWT_ACCESS_SECRET',
      'dashboard-validation-secret-at-least-32-characters',
    );
    const module = await Test.createTestingModule({
      imports: [IdentityAccessModule],
      controllers: [DashboardController],
      providers: [
        GetDashboardSummary,
        PrismaDashboardReader,
        { provide: DASHBOARD_READER, useExisting: PrismaDashboardReader },
      ],
    }).compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.init();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);
    reader = app.get(PrismaDashboardReader);
    for (const permission of await prisma.permission.findMany())
      permissionIds.set(permission.PermissionKey, permission.PermissionId);
    expect(permissionIds.has('revenue:system:summary')).toBe(true);
    actorRole = await role(['management:portal:enter']);
    actor = await account(actorRole);
    other = await account(await role(['management:portal:enter']));
    admin = await account(
      (
        await prisma.role.findUniqueOrThrow({
          where: { SystemRoleCode: 'system_admin' },
        })
      ).RoleId,
    );
    for (const user of [actor, other]) {
      const profile = await prisma.merchantProfile.create({
        data: { UserId: user.id, BusinessName: prefix },
      });
      merchants.push(profile.MerchantId);
    }
    for (const status of [
      'draft',
      'pending_review',
      'published',
      'offline',
      'published',
    ]) {
      const index = resorts.length;
      const resort = await prisma.skiResort.create({
        data: {
          Name: prefix,
          Price: 100,
          SnowCondition: 'test',
          Description: prefix,
          LegacyDistance: 0,
          MerchantId: index === 4 ? merchants[1] : merchants[0],
          Status: status,
        },
      });
      resorts.push(resort.ResortId);
      await prisma.resortRevenueRecord.create({
        data: {
          ResortId: resort.ResortId,
          ReportDate: new Date('2026-10-01T00:00:00Z'),
          RevenueAmount:
            index === 4
              ? '9999999999.99'
              : ['0.10', '0.20', '2.00', '3.00'][index],
          Source: 'manual',
          CreatedBy: actor.id,
        },
      });
    }
    if (
      !(await prisma.dictionaryType.findUnique({
        where: { DictType: 'knowledge.article_category' },
      }))
    ) {
      await prisma.dictionaryType.create({
        data: {
          DictType: 'knowledge.article_category',
          DictName: 'Categories',
          GroupKey: 'knowledge',
          PubliclyReadable: true,
        },
      });
      categoryTypeCreated = true;
    }
    const category = await prisma.dictionaryItem.create({
      data: {
        DictType: 'knowledge.article_category',
        Value: prefix,
        Label: prefix,
      },
    });
    for (const status of ['draft', 'published', 'withdrawn', 'published']) {
      const row = await prisma.article.create({
        data: {
          Title: prefix,
          Summary: prefix,
          Body: prefix,
          AuthorId: articles.length === 3 ? other.id : actor.id,
          CategoryValue: category.Value,
          Status: status,
        },
      });
      articles.push(row.ArticleId);
    }
    for (const status of ['pending', 'published', 'hidden']) {
      const row = await prisma.dynamic.create({
        data: { AuthorId: actor.id, Content: prefix, Status: status },
      });
      dynamics.push(row.DynamicId);
    }
    ragId = (
      await prisma.ragDocument.create({
        data: {
          SourceKey: prefix,
          SourceType: 'article',
          Title: prefix,
          Content: 'sensitive source',
          AccessScope: 'public',
          Status: 'failed',
          ContentHash: 'a'.repeat(64),
          SourceUpdatedAt: new Date(),
        },
      })
    ).RagDocumentId;
  });
  afterAll(async () => {
    try {
      if (prisma) {
        await prisma.ragDocument.deleteMany({ where: { SourceKey: prefix } });
        await prisma.dynamic.deleteMany({
          where: { DynamicId: { in: dynamics } },
        });
        await prisma.article.deleteMany({
          where: { ArticleId: { in: articles } },
        });
        await prisma.dictionaryItem.deleteMany({
          where: { DictType: 'knowledge.article_category', Value: prefix },
        });
        if (categoryTypeCreated)
          await prisma.dictionaryType.delete({
            where: { DictType: 'knowledge.article_category' },
          });
        await prisma.resortRevenueRecord.deleteMany({
          where: { ResortId: { in: resorts } },
        });
        await prisma.skiResort.deleteMany({
          where: { ResortId: { in: resorts } },
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
  beforeEach(async () => {
    if (!prisma) return;
    await prisma.userRole.deleteMany({
      where: { UserId: actor.id, RoleId: { not: actorRole } },
    });
    await prisma.user.update({
      where: { UserId: actor.id },
      data: { Status: 'active' },
    });
    await prisma.merchantProfile.update({
      where: { MerchantId: merchants[0] },
      data: { Status: 'active' },
    });
    await prisma.skiResort.updateMany({
      where: { ResortId: { in: resorts } },
      data: { DeletedAt: null },
    });
    await prisma.article.updateMany({
      where: { ArticleId: { in: articles } },
      data: { DeletedAt: null },
    });
    await prisma.dynamic.updateMany({
      where: { DynamicId: { in: dynamics } },
      data: { DeletedAt: null },
    });
    await configure(['management:portal:enter']);
  });
  async function role(grants: string[], scope = 'all') {
    const row = await prisma.role.create({
      data: {
        RoleKey: `${prefix}_${roles.length}`,
        RoleName: prefix,
        DataScope: scope === 'selected' ? 'all' : scope,
        RolePermissions: {
          create: grants.map((key) => ({
            PermissionId: permissionIds.get(key)!,
          })),
        },
      },
    });
    roles.push(row.RoleId);
    return row.RoleId;
  }
  async function account(roleId: number) {
    const password = 'dashboard-validation-password';
    const row = await prisma.user.create({
      data: {
        Account: `${prefix}_${users.length}`,
        Nickname: prefix,
        PasswordHash: await new BcryptPasswordHasher().hash(password),
        UserRoles: { create: { RoleId: roleId } },
      },
    });
    users.push(row.UserId);
    const login = await request(http)
      .post('/api/v1/auth/login')
      .send({ account: row.Account, password })
      .expect(200);
    return { id: row.UserId, token: login.body.data.accessToken as string };
  }
  async function configure(
    grants: string[],
    scope = 'all',
    resource?: string,
    ids?: number[],
  ) {
    await prisma.rolePermission.deleteMany({ where: { RoleId: actorRole } });
    await prisma.roleDataScope.deleteMany({ where: { RoleId: actorRole } });
    await prisma.role.update({
      where: { RoleId: actorRole },
      data: {
        DataScope: scope === 'selected' ? 'all' : scope,
        Status: 'active',
        RolePermissions: {
          create: grants.map((key) => ({
            PermissionId: permissionIds.get(key)!,
          })),
        },
      },
    });
    if (resource)
      await prisma.roleDataScope.create({
        data: {
          RoleId: actorRole,
          ResourceKey: resource,
          ScopeType: scope,
          ScopeConfig: ids ? { selectedIds: ids } : Prisma.DbNull,
        },
      });
  }
  function get(token = actor.token) {
    return request(http).get(path).set('Authorization', `Bearer ${token}`);
  }
  it('requires authentication and rejects missing portal access', async () => {
    await request(http).get(path).expect(401);
    await configure(['system:user:list']);
    await get().expect(403);
  });
  it('returns seven null panels for entry-only, with no-store and timestamp', async () => {
    const response = await get().expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.data).toEqual({
      generatedAt: expect.any(String),
      users: null,
      merchants: null,
      resorts: null,
      articles: null,
      dynamics: null,
      rag: null,
      revenue: null,
    });
    expect(new Date(response.body.data.generatedAt).toISOString()).toBe(
      response.body.data.generatedAt,
    );
  });
  it.each(['?page=1', '?merchantId=1', '?fromDate=2026-10-01', '?scope=all'])(
    'rejects query overrides %s',
    async (query) => {
      await request(http)
        .get(path + query)
        .set('Authorization', `Bearer ${actor.token}`)
        .expect(400);
    },
  );
  it.each(['self', 'selected', 'merchant', 'all'])(
    'uses user %s scope and counts linked profiles including disabled',
    async (scope) => {
      await configure(
        ['management:portal:enter', 'system:user:list'],
        scope,
        'user',
        scope === 'selected' ? [actor.id, other.id] : undefined,
      );
      await prisma.user.update({
        where: { UserId: other.id },
        data: { Status: 'disabled' },
      });
      await prisma.merchantProfile.update({
        where: { MerchantId: merchants[0] },
        data: { Status: scope === 'merchant' ? 'active' : 'disabled' },
      });
      try {
        const result = (await get().expect(200)).body.data;
        const count = scope === 'all' || scope === 'selected' ? 2 : 1;
        expect(result.merchants).toEqual({
          total: count,
          active: scope === 'merchant' ? count : count - 1,
          disabled: scope === 'merchant' ? 0 : 1,
        });
        expect(result.users.total).toBe(
          result.users.active + result.users.disabled,
        );
        if (scope !== 'all')
          expect(result.users).toEqual({
            total: count,
            active: 1,
            disabled: count - 1,
          });
      } finally {
        await prisma.user.update({
          where: { UserId: other.id },
          data: { Status: 'active' },
        });
      }
    },
  );
  it.each(['self', 'merchant', 'all', 'selected'])(
    'intersects merchant %s scope with ownership for resorts and money',
    async (scope) => {
      await configure(
        [
          'management:portal:enter',
          'resort:merchant:list',
          'revenue:merchant:list',
        ],
        scope,
        'resort',
        scope === 'selected' ? [resorts[0]!, resorts[4]!] : undefined,
      );
      const result = (await get().expect(200)).body.data;
      expect(result.resorts).toEqual(
        scope === 'selected'
          ? { total: 1, draft: 1, pendingReview: 0, published: 0, offline: 0 }
          : { total: 4, draft: 1, pendingReview: 1, published: 1, offline: 1 },
      );
      expect(result.revenue).toEqual({
        amount: scope === 'selected' ? '0.10' : '5.30',
        currency: 'CNY',
        period: 'all-time',
        scope: 'merchant',
      });
      expect(result.users).toBeNull();
      expect(result.dynamics).toBeNull();
    },
  );
  it('global resort branch takes precedence and excludes soft deletion', async () => {
    await configure([
      'management:portal:enter',
      'content:resort:list-all',
      'resort:merchant:list',
    ]);
    await prisma.skiResort.update({
      where: { ResortId: resorts[4] },
      data: { DeletedAt: new Date() },
    });
    expect((await get().expect(200)).body.data.resorts).toEqual({
      total: 4,
      draft: 1,
      pendingReview: 1,
      published: 1,
      offline: 1,
    });
  });
  it.each(['self', 'selected', 'merchant'])(
    'rejects unsupported global resort scope %s without merchant fallback',
    async (scope) => {
      await configure(
        [
          'management:portal:enter',
          'content:resort:list-all',
          'resort:merchant:list',
        ],
        scope,
        'resort',
        scope === 'selected' ? [resorts[0]!] : undefined,
      );
      await get().expect(403);
    },
  );
  it.each(['self', 'selected', 'all'])(
    'counts article %s scope without deleted rows',
    async (scope) => {
      await configure(
        ['management:portal:enter', 'content:article:manage'],
        scope,
        'article',
        scope === 'selected' ? [articles[0]!, articles[3]!] : undefined,
      );
      await prisma.article.update({
        where: { ArticleId: articles[2] },
        data: { DeletedAt: new Date() },
      });
      const total = scope === 'self' || scope === 'selected' ? 2 : 3;
      expect((await get().expect(200)).body.data.articles).toEqual({
        total,
        draft: 1,
        published: total - 1,
        withdrawn: 0,
      });
    },
  );
  it('rejects unsupported article merchant scope', async () => {
    await configure(
      ['management:portal:enter', 'content:article:manage'],
      'merchant',
    );
    await get().expect(403);
  });
  it('moderator sees global moderation counts while ordinary merchant cannot', async () => {
    await configure(['management:portal:enter', 'content:dynamic:moderate']);
    await prisma.dynamic.update({
      where: { DynamicId: dynamics[2] },
      data: { DeletedAt: new Date() },
    });
    expect((await get().expect(200)).body.data.dynamics).toEqual({
      total: 2,
      pending: 1,
      published: 1,
      hidden: 0,
    });
  });
  it('only a protected admin sees RAG failures and global exact cumulative sum', async () => {
    const result = (await get(admin.token).expect(200)).body.data;
    expect(result.rag).toEqual({ failed: 1 });
    expect(result.revenue).toEqual({
      amount: '10000000005.29',
      currency: 'CNY',
      period: 'all-time',
      scope: 'all',
    });
    expect(JSON.stringify(result)).not.toContain('sensitive source');
    await configure([
      'management:portal:enter',
      'ai:knowledge:list',
      'revenue:system:summary',
    ]);
    expect((await get().expect(200)).body.data).toMatchObject({
      rag: null,
      revenue: null,
    });
    expect(
      await prisma.ragDocument.count({ where: { RagDocumentId: ragId } }),
    ).toBe(1);
  });
  it('empty selected ownership gives numeric zero and exact zero amount', async () => {
    await configure(
      [
        'management:portal:enter',
        'resort:merchant:list',
        'revenue:merchant:list',
      ],
      'selected',
      'resort',
      [resorts[4]!],
    );
    expect((await get().expect(200)).body.data).toMatchObject({
      resorts: { total: 0 },
      revenue: { amount: '0.00' },
    });
  });
  it('disabled merchant profile removes merchant-only panels', async () => {
    await configure(
      [
        'management:portal:enter',
        'resort:merchant:list',
        'revenue:merchant:list',
      ],
      'merchant',
    );
    await prisma.merchantProfile.update({
      where: { MerchantId: merchants[0] },
      data: { Status: 'disabled' },
    });
    expect((await get().expect(200)).body.data).toMatchObject({
      resorts: null,
      revenue: null,
    });
  });
  it.each([
    'system:user:list',
    'content:article:manage',
    'resort:merchant:list',
    'revenue:merchant:list',
    'content:dynamic:moderate',
  ])('rejects conflicting granted scopes for %s', async (grant) => {
    await configure(['management:portal:enter', grant], 'all');
    const second = await role([grant], 'self');
    await prisma.userRole.create({
      data: { UserId: actor.id, RoleId: second },
    });
    await get().expect(403);
  });
  it('portal scopes from unrelated roles do not create a fake business-scope conflict', async () => {
    const second = await role(['management:portal:enter'], 'self');
    await prisma.userRole.create({
      data: { UserId: actor.id, RoleId: second },
    });
    await get().expect(200);
  });
  it.each(['permission', 'role', 'account', 'portal'])(
    'next request reflects revoked %s',
    async (kind) => {
      await configure(['management:portal:enter', 'system:user:list'], 'self');
      expect((await get().expect(200)).body.data.users.total).toBe(1);
      if (kind === 'permission')
        await prisma.rolePermission.deleteMany({
          where: {
            RoleId: actorRole,
            PermissionId: permissionIds.get('system:user:list'),
          },
        });
      if (kind === 'portal')
        await prisma.rolePermission.deleteMany({
          where: {
            RoleId: actorRole,
            PermissionId: permissionIds.get('management:portal:enter'),
          },
        });
      if (kind === 'role')
        await prisma.role.update({
          where: { RoleId: actorRole },
          data: { Status: 'disabled' },
        });
      if (kind === 'account')
        await prisma.user.update({
          where: { UserId: actor.id },
          data: { Status: 'disabled' },
        });
      const response = await get();
      if (kind === 'permission') {
        expect(response.status).toBe(200);
        expect(response.body.data.users).toBeNull();
      } else expect(response.status).toBe(403);
    },
  );
  it('keeps later aggregates on the first read snapshot and read-only transaction', async () => {
    await configure(['management:portal:enter', 'system:user:list'], 'self');
    const facade = {
      $transaction: (
        work: (tx: Prisma.TransactionClient) => Promise<unknown>,
        options: object,
      ) =>
        prisma.$transaction(async (tx) => {
          const [settings] = await tx.$queryRaw<
            { read_only: string }[]
          >`SELECT current_setting('transaction_read_only') AS read_only`;
          // Reader sets READ ONLY itself; inspect at the first aggregate, after that command.
          expect(settings!.read_only).toBe('off');
          return work(
            new Proxy(tx, {
              get(target, prop) {
                if (prop !== 'user') return Reflect.get(target, prop);
                return new Proxy(target.user, {
                  get(user, key) {
                    if (key !== 'groupBy') return Reflect.get(user, key);
                    return async (args: Prisma.UserGroupByArgs) => {
                      const [setting] = await tx.$queryRaw<
                        { read_only: string }[]
                      >`SELECT current_setting('transaction_read_only') AS read_only`;
                      expect(setting!.read_only).toBe('on');
                      const result = await user.groupBy(args as never);
                      await prisma.user.update({
                        where: { UserId: actor.id },
                        data: { Status: 'disabled' },
                      });
                      await prisma.merchantProfile.update({
                        where: { MerchantId: merchants[0] },
                        data: { Status: 'disabled' },
                      });
                      return result;
                    };
                  },
                });
              },
            }),
          );
        }, options),
    };
    const result = await new PrismaDashboardReader(
      facade as unknown as PrismaService,
    ).summarize(actor.id);
    expect(result.users).toEqual({ total: 1, active: 1, disabled: 0 });
    expect(result.merchants).toEqual({ total: 1, active: 1, disabled: 0 });
    await expect(reader.summarize(actor.id)).rejects.toThrow();
  });
  it('never creates audit or Outbox side effects', async () => {
    const before = await prisma.outboxEvent.count();
    await get(admin.token).expect(200);
    expect(
      await prisma.operationLog.count({
        where: { ActorUserId: { in: users } },
      }),
    ).toBe(0);
    expect(await prisma.outboxEvent.count()).toBe(before);
  });
});
