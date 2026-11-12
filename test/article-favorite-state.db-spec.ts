import { randomUUID, randomInt } from 'node:crypto';
import { LoginBucketKeys } from '../src/modules/identity-access/infrastructure/login-bucket-keys.js';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { IdentityAccessModule } from '../src/modules/identity-access/identity-access.module.js';
import { KnowledgeContentModule } from '../src/modules/knowledge-content/knowledge-content.module.js';
import { MemberEngagementModule } from '../src/modules/member-engagement/member-engagement.module.js';
import { ASSET_STORAGE } from '../src/modules/assets/application/ports/asset-storage.js';
import { BcryptPasswordHasher } from '../src/modules/identity-access/infrastructure/bcrypt-password-hasher.js';
import { PrismaService } from '../src/shared/persistence/prisma.service.js';
import { configureHttp } from '../src/shared/http/configure-http.js';

describe('D-36 article favorite state HTTP / PostgreSQL', () => {
  const prefix = `article-fav-${randomUUID().slice(0, 8)}`;
  const password = 'article-favorite-validation-password';
  const users: number[] = [],
    articles: number[] = [];
  let app: INestApplication<App>, http: App, prisma: PrismaService;
  let itemId: number,
    owner: { id: number; token: string; account: string },
    other: typeof owner;
  let resortId: number;
  beforeAll(async () => {
    if (!process.env.DATABASE_URL)
      throw new Error('Dedicated migrated database required');
    vi.stubEnv(
      'JWT_ACCESS_SECRET',
      'article-favorite-secret-at-least-32-characters',
    );
    vi.stubEnv('WEB_ORIGINS', 'http://localhost:3000');
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        IdentityAccessModule,
        KnowledgeContentModule,
        MemberEngagementModule,
      ],
    })
      .overrideProvider(ASSET_STORAGE)
      .useValue({ createReadUrl: vi.fn(), put: vi.fn(), remove: vi.fn() })
      .compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.init();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);
    const role = await prisma.role.findUniqueOrThrow({
      where: { SystemRoleCode: 'registered_user' },
    });
    for (const name of ['owner', 'other']) {
      const row = await prisma.user.create({
        data: {
          Account: `${prefix}-${name}`,
          Nickname: name,
          PasswordHash: await new BcryptPasswordHasher().hash(password),
          UserRoles: { create: { RoleId: role.RoleId } },
        },
      });
      users.push(row.UserId);
      const response = await request(http)
        .post('/api/v1/auth/login')
        .send({ account: row.Account, password })
        .expect(200);
      const actor = {
        id: row.UserId,
        account: row.Account,
        token: response.body.data.accessToken as string,
      };
      if (name === 'owner') owner = actor;
      else other = actor;
    }
    const category = await prisma.dictionaryItem.create({
      data: {
        DictType: 'knowledge.article_category',
        Value: prefix,
        Label: prefix,
      },
    });
    itemId = category.ItemId;
    resortId = randomInt(1000000000, 2000000000);
    await prisma.skiResort.create({
      data: {
        ResortId: resortId,
        Name: prefix,
        Price: 100,
        SnowCondition: 'snow',
        Description: prefix,
        LegacyDistance: 0,
        Status: 'published',
      },
    });
    for (const [index, status] of [
      'published',
      'published',
      'draft',
      'withdrawn',
    ].entries()) {
      const row = await prisma.article.create({
        data: {
          ...(index === 0 ? { ArticleId: resortId } : {}),
          Title: `${prefix}-${index}`,
          Summary: prefix,
          Body: 'Public body',
          Status: status,
          CategoryValue: prefix,
          PublishTime: new Date(`2026-10-0${index + 1}T00:00:00Z`),
        },
      });
      articles.push(row.ArticleId);
    }
  });
  beforeEach(async () => {
    // Reset only this suite's synthetic buckets between independent examples.
    const keys = app.get(LoginBucketKeys);
    await prisma.loginAttemptBucket.deleteMany({
      where: {
        BucketKey: {
          in: [
            keys.account(owner.account),
            keys.account(other.account),
            keys.ip('127.0.0.1'),
          ],
        },
      },
    });
    await prisma.favorite.deleteMany({ where: { UserId: { in: users } } });
    await prisma.user.updateMany({
      where: { UserId: { in: users } },
      data: { Status: 'active' },
    });
    await prisma.dictionaryItem.update({
      where: { ItemId: itemId },
      data: { Status: 'active' },
    });
    await prisma.article.update({
      where: { ArticleId: articles[0]! },
      data: { Status: 'published', DeletedAt: null },
    });
    const response = await request(http)
      .post('/api/v1/auth/login')
      .send({ account: owner.account, password })
      .expect(200);
    owner.token = response.body.data.accessToken as string;
  });
  afterAll(async () => {
    try {
      if (prisma) {
        await prisma.favorite.deleteMany({ where: { UserId: { in: users } } });
        await prisma.article.deleteMany({
          where: { ArticleId: { in: articles } },
        });
        if (resortId)
          await prisma.skiResort.deleteMany({
            where: { ResortId: resortId, Name: prefix },
          });
        if (itemId)
          await prisma.dictionaryItem.delete({ where: { ItemId: itemId } });
        await prisma.operationLog.deleteMany({
          where: { ActorUserId: { in: users } },
        });
        await prisma.user.deleteMany({ where: { UserId: { in: users } } });
      }
    } finally {
      await app?.close();
      vi.unstubAllEnvs();
    }
  });
  const list = (token?: string, page = 1) => {
    const call = request(http).get(
      `/api/v1/articles?categoryValue=${prefix}&pageSize=1&page=${page}`,
    );
    return token ? call.auth(token, { type: 'bearer' }) : call;
  };
  const detail = (token?: string, id = articles[0]!) => {
    const call = request(http).get(`/api/v1/articles/${id}`);
    return token ? call.auth(token, { type: 'bearer' }) : call;
  };
  async function expectState(token: string | undefined, expected: boolean) {
    const response = await detail(token)
      .expect(200)
      .expect('Cache-Control', 'private, no-store');
    expect(response.body.data.favoriteByMe).toBe(expected);
    expect(response.body.data).not.toHaveProperty('Favorites');
    const page = await list(token, 2)
      .expect(200)
      .expect('Cache-Control', 'private, no-store');
    expect(page.body.data.total).toBe(2);
    expect(page.body.data.items).toHaveLength(1);
    expect(page.body.data.items[0]).toMatchObject({
      articleId: articles[0],
      favoriteByMe: expected,
    });
    expect(page.body.data.items[0]).not.toHaveProperty('body');
  }
  it('returns guest false, owner true and other false in both reads', async () => {
    await prisma.favorite.create({
      data: { UserId: owner.id, ArticleId: articles[0] },
    });
    await expectState(undefined, false);
    await expectState(owner.token, true);
    await expectState(other.token, false);
  });
  it('does not confuse a resort favorite with an article sharing its numeric ID', async () => {
    expect(articles[0]).toBe(resortId);
    await prisma.favorite.create({
      data: { UserId: owner.id, ResortId: resortId },
    });
    await expectState(owner.token, false);
  });
  it('reflects idempotent writes and deletion immediately without changing counts', async () => {
    for (let i = 0; i < 2; i++)
      await request(http)
        .put('/api/v1/me/favorites')
        .auth(owner.token, { type: 'bearer' })
        .send({ targetType: 'article', targetId: articles[0] })
        .expect(204);
    await expectState(owner.token, true);
    expect(
      await prisma.favorite.count({
        where: { UserId: owner.id, ArticleId: articles[0] },
      }),
    ).toBe(1);
    await request(http)
      .delete(`/api/v1/me/favorites/article/${articles[0]}`)
      .auth(owner.token, { type: 'bearer' })
      .expect(204);
    await expectState(owner.token, false);
  });
  it.each(['invalid', 'revoked', 'expired-session', 'disabled-account'])(
    'uses guest state for %s credentials',
    async (mode) => {
      await prisma.favorite.create({
        data: { UserId: owner.id, ArticleId: articles[0] },
      });
      const login = await request(http)
        .post('/api/v1/auth/login')
        .send({ account: owner.account, password })
        .expect(200);
      const token = login.body.data.accessToken as string;
      if (mode === 'revoked' || mode === 'expired-session')
        await prisma.authSession.updateMany({
          where: { UserId: owner.id },
          data:
            mode === 'revoked'
              ? { RevokedAt: new Date() }
              : { ExpiresAt: new Date(0) },
        });
      if (mode === 'disabled-account')
        await prisma.user.update({
          where: { UserId: owner.id },
          data: { Status: 'disabled' },
        });
      await expectState(mode === 'invalid' ? 'invalid' : token, false);
    },
  );
  it.each(['withdrawn', 'deleted', 'category-disabled'])(
    'never widens visibility for favorite %s content',
    async (mode) => {
      await prisma.favorite.create({
        data: { UserId: owner.id, ArticleId: articles[0] },
      });
      if (mode === 'category-disabled')
        await prisma.dictionaryItem.update({
          where: { ItemId: itemId },
          data: { Status: 'disabled' },
        });
      else
        await prisma.article.update({
          where: { ArticleId: articles[0]! },
          data:
            mode === 'withdrawn'
              ? { Status: 'withdrawn' }
              : { DeletedAt: new Date() },
        });
      await detail(other.token).expect(404);
      await detail(owner.token).expect(404);
      const page = await list(owner.token).expect(200);
      expect(page.body.data.total).toBe(mode === 'category-disabled' ? 0 : 1);
    },
  );
  it('rejects a caller-supplied userId', async () => {
    await request(http).get(`/api/v1/articles?userId=${owner.id}`).expect(400);
  });
  it.each(['0', '-1', '2147483648', '9007199254740992'])(
    'rejects invalid article ID %s without a database error',
    async (id) => {
      await request(http).get(`/api/v1/articles/${id}`).expect(400);
    },
  );
  it('supports browser cookies and CSRF with real guards and database', async () => {
    const origin = 'http://localhost:3000';
    const cookies = new Map<string, string>();
    const capture = (response: {
      headers: { 'set-cookie'?: string | string[] };
    }) => {
      const header = response.headers['set-cookie'];
      for (const value of Array.isArray(header)
        ? header
        : header
          ? [header]
          : []) {
        const pair = value.split(';')[0]!;
        cookies.set(pair.slice(0, pair.indexOf('=')), pair);
      }
      return [...cookies.values()].join('; ');
    };
    const csrf = await request(http)
      .get('/api/v1/auth/csrf')
      .set('Origin', origin)
      .expect(200);
    capture(csrf);
    const login = await request(http)
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .set('Cookie', [...cookies.values()].join('; '))
      .set('X-CSRF-Token', csrf.body.data.csrfToken)
      .send({ account: other.account, password })
      .expect(200);
    expect(login.body.data).not.toHaveProperty('accessToken');
    capture(login);
    const freshCsrf = await request(http)
      .get('/api/v1/auth/csrf')
      .set('Origin', origin)
      .set('Cookie', [...cookies.values()].join('; '))
      .expect(200);
    const header = capture(freshCsrf);
    await request(http)
      .put('/api/v1/me/favorites')
      .set('Origin', origin)
      .set('Cookie', header)
      .set('X-CSRF-Token', freshCsrf.body.data.csrfToken)
      .send({ targetType: 'article', targetId: articles[0] })
      .expect(204);
    const response = await request(http)
      .get(`/api/v1/articles/${articles[0]}`)
      .set('Origin', origin)
      .set('Cookie', header)
      .expect(200);
    expect(response.body.data.favoriteByMe).toBe(true);
  });
  async function withPublicArticleChanges(run: () => Promise<void>) {
    const original = await prisma.article.findMany({
      where: { ArticleId: { in: articles.slice(0, 2) } },
      select: {
        ArticleId: true,
        Title: true,
        Summary: true,
        PublishTime: true,
      },
    });
    try {
      await run();
    } finally {
      for (const { ArticleId, ...data } of original)
        await prisma.article.update({ where: { ArticleId }, data });
    }
  }
  const filtered = (params: Record<string, string | undefined>) => {
    const search = new URLSearchParams({ categoryValue: prefix });
    for (const [key, value] of Object.entries(params))
      if (value !== undefined) search.set(key, value);
    return request(http).get(`/api/v1/articles?${search}`);
  };
  it.each(['%', '_', '\\'])(
    'treats keyword %s as a literal substring, not a SQL wildcard',
    async (keyword) => {
      await withPublicArticleChanges(async () => {
        await prisma.article.update({
          where: { ArticleId: articles[0]! },
          data: { Summary: `literal ${keyword} symbol` },
        });
        const response = await filtered({ keyword }).expect(200);
        expect(response.body.data.total).toBe(1);
        expect(
          response.body.data.items.map(
            (item: { articleId: number }) => item.articleId,
          ),
        ).toEqual([articles[0]]);
      });
    },
  );
  it('combines exact category with case-insensitive title OR summary matching and trimmed keyword', async () => {
    await withPublicArticleChanges(async () => {
      await prisma.article.update({
        where: { ArticleId: articles[0]! },
        data: { Title: 'SNOW basics' },
      });
      await prisma.article.update({
        where: { ArticleId: articles[1]! },
        data: { Summary: 'sNow safety' },
      });
      const response = await filtered({
        keyword: ' sNoW ',
        pageSize: '1',
      }).expect(200);
      expect(response.body.data).toMatchObject({
        total: 2,
        page: 1,
        pageSize: 1,
        hasNext: true,
      });
      expect(response.body.data.items).toHaveLength(1);
      const empty = await filtered({
        categoryValue: `missing-${prefix}`,
        keyword: 'snow',
      }).expect(200);
      expect(empty.body.data).toMatchObject({
        total: 0,
        items: [],
        hasNext: false,
      });
    });
  });
  it('paginates equal publication times by descending article ID with a consistent total', async () => {
    await withPublicArticleChanges(async () => {
      await prisma.article.updateMany({
        where: { ArticleId: { in: articles.slice(0, 2) } },
        data: { PublishTime: new Date('2026-10-20T00:00:00Z') },
      });
      const expected = articles.slice(0, 2).sort((a, b) => b - a);
      for (const [index, id] of expected.entries()) {
        const response = await filtered({
          pageSize: '1',
          page: String(index + 1),
        }).expect(200);
        expect(response.body.data).toMatchObject({
          total: 2,
          page: index + 1,
          hasNext: index === 0,
        });
        expect(
          response.body.data.items.map(
            (item: { articleId: number }) => item.articleId,
          ),
        ).toEqual([id]);
        expect(Object.keys(response.body.data.items[0]).sort()).toEqual(
          [
            'articleId',
            'title',
            'summary',
            'coverUrl',
            'category',
            'authorName',
            'publishTime',
            'favoriteByMe',
          ].sort(),
        );
      }
      const empty = await filtered({ pageSize: '1', page: '3' }).expect(200);
      expect(empty.body.data).toMatchObject({
        total: 2,
        page: 3,
        items: [],
        hasNext: false,
      });
    });
  });
  it('does not expose published rows without a publication time', async () => {
    await withPublicArticleChanges(async () => {
      await prisma.article.update({
        where: { ArticleId: articles[0]! },
        data: { PublishTime: null },
      });
      await detail().expect(404);
      const response = await filtered({}).expect(200);
      expect(response.body.data.total).toBe(1);
    });
  });
  it('returns public category projections and removes a disabled selected category from both list and count', async () => {
    const active = await request(http)
      .get('/api/v1/knowledge/categories')
      .expect(200);
    expect(active.body.data).toContainEqual({ value: prefix, label: prefix });
    const category = active.body.data.find(
      (item: { value: string }) => item.value === prefix,
    );
    expect(Object.keys(category).sort()).toEqual(['label', 'value']);
    await prisma.dictionaryItem.update({
      where: { ItemId: itemId },
      data: { Status: 'disabled' },
    });
    const inactive = await request(http)
      .get('/api/v1/knowledge/categories')
      .expect(200);
    expect(
      inactive.body.data.some(
        (item: { value: string }) => item.value === prefix,
      ),
    ).toBe(false);
    const response = await filtered({}).expect(200);
    expect(response.body.data).toMatchObject({
      items: [],
      total: 0,
      hasNext: false,
    });
  });
  it.each([
    { page: '0' },
    { page: '1.5' },
    { page: '2147483649', pageSize: '100' },
    { pageSize: '101' },
    { pageSize: '0' },
    { keyword: 'x'.repeat(101) },
    { categoryValue: 'x'.repeat(101) },
    { status: 'draft' },
  ])('rejects invalid public query %j with 400', async (query) => {
    await filtered(query).expect(400);
  });
});
