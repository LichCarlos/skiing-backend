import { LOGIN_ATTEMPT_STORE } from '../src/modules/identity-access/application/ports/login-attempt-store.js';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureHttp } from '../src/shared/http/configure-http.js';
import { createOpenApiDocument } from '../src/shared/http/openapi-document.js';
import { AUTH_TOKEN_SERVICE } from '../src/modules/identity-access/application/ports/auth-token-service.js';
import { AUTH_SESSION_REPOSITORY } from '../src/modules/identity-access/application/ports/auth-session-repository.js';
import { AUTHORIZATION_PRINCIPAL_READER } from '../src/modules/identity-access/application/ports/authorization-principal-reader.js';
import { ASSET_STORAGE } from '../src/modules/assets/application/ports/asset-storage.js';
import {
  ARTICLE_REPOSITORY,
  type ArticleRepository,
  type ArticleTransaction,
  type ArticleFieldContext,
} from '../src/modules/knowledge-content/application/ports/article-repository.js';
import { articleRecord } from './fixtures/content-records.js';

describe('Article field HTTP policy (real application, repository stand-in)', () => {
  let app: INestApplication;
  let row = articleRecord();
  const reads = vi.fn(),
    writes = vi.fn();
  const tx = {
    fields: {
      definitions: ['read', 'write', 'private'].map((fieldKey) => ({
        fieldKey,
        dataType: 'text',
        status: 'active',
        required: false,
        schemaVersion: 2,
      })),
      policies: new Map([
        ['read', { canRead: true, canWrite: false }],
        ['write', { canRead: false, canWrite: true }],
      ]),
      dictionaryValues: new Map(),
      groups: [] as ArticleFieldContext['groups'],
    },
    find: vi.fn(async () => row),
    findPage: vi.fn(async () => ({ items: [row], total: 1 })),
    assertReferences: vi.fn(async () => {}),
    create: vi.fn(async (values, actorUserId) => {
      row = articleRecord({
        ...values,
        authorId: actorUserId,
        status: 'draft',
      });
      return row;
    }),
    update: vi.fn(async (_id, _version, change) => {
      row = {
        ...row,
        ...change.values,
        ...(change.status ? { status: change.status } : {}),
        version: row.version + 1,
      };
      return true;
    }),
    appendChanged: vi.fn(async () => {}),
    audit: vi.fn(async () => {}),
  } satisfies ArticleTransaction;
  const repository: ArticleRepository = {
    runRead: async (access, actorId, work) => {
      reads(access, actorId);
      return work(tx);
    },
    runWrite: async (access, actorId, work) => {
      writes(access, actorId);
      return work(tx);
    },
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LOGIN_ATTEMPT_STORE)
      .useValue({ consume: async () => ({ allowed: true }) })
      .overrideProvider(AUTH_TOKEN_SERVICE)
      .useValue({
        verifyAccessToken: (token: string) =>
          ['editor', 'no-grant'].includes(token)
            ? { userId: token === 'editor' ? 7 : 8, sessionId: 'test' }
            : null,
      })
      .overrideProvider(AUTH_SESSION_REPOSITORY)
      .useValue({ isActive: async () => true })
      .overrideProvider(AUTHORIZATION_PRINCIPAL_READER)
      .useValue({
        findByUserId: async (userId: number) => ({
          userId,
          status: 'active',
          merchant: null,
          roles: [
            {
              key: 'custom_content',
              status: 'active',
              dataScope: 'self',
              permissions:
                userId === 7
                  ? ['management:portal:enter', 'content:article:manage'].map(
                      (key) => ({ key, status: 'active' }),
                    )
                  : [],
            },
          ],
        }),
      })
      .overrideProvider(ARTICLE_REPOSITORY)
      .useValue(repository)
      .overrideProvider(ASSET_STORAGE)
      .useValue({ createReadUrl: async () => 'signed' })
      .compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.init();
  });
  afterAll(async () => app.close());
  beforeEach(() => {
    vi.clearAllMocks();
    row = articleRecord({
      authorId: 7,
      customFields: { read: 'visible', write: 'stored', private: 'hidden' },
    });
  });
  const base = '/api/v1/admin/articles';
  const body = {
    title: 'Updated',
    summary: 'Summary',
    body: 'Body',
    categoryValue: 'basics',
  };
  it('filters list/detail and uses only the authenticated actor for the repository session', async () => {
    const detail = await request(app.getHttpServer())
      .get(`${base}/19`)
      .set('authorization', 'Bearer editor')
      .expect(200);
    expect(detail.body.data.customFields).toEqual({ read: 'visible' });
    const list = await request(app.getHttpServer())
      .get(base)
      .set('authorization', 'Bearer editor')
      .expect(200);
    expect(list.body.data.items[0].customFields).toEqual({ read: 'visible' });
    expect(reads).toHaveBeenCalledWith({ kind: 'self', userId: 7 }, 7);
  });
  it('routes custom-fields before :id and returns only the granted field schema', async () => {
    tx.fields.groups = [
      {
        groupKey: 'general',
        label: 'General',
        sortOrder: 0,
        fields: ['read', 'write', 'private'].map((fieldKey, index) => ({
          fieldDefinitionId: index + 1,
          fieldKey,
          label: fieldKey,
          dataType: 'text',
          groupKey: 'general',
          sortOrder: index,
          required: false,
          defaultValue: null,
          optionsDictType: null,
          validation: null,
          schemaVersion: 2,
        })),
      },
    ];
    const response = await request(app.getHttpServer())
      .get(`${base}/custom-fields`)
      .set('authorization', 'Bearer editor')
      .expect(200);
    expect(
      response.body.data.groups[0].fields.map(
        (field: { fieldKey: string }) => field.fieldKey,
      ),
    ).toEqual(['read', 'write']);
    expect(response.body.data.entityType).toBe('article');
    expect(tx.find).not.toHaveBeenCalled();
    expect(reads).toHaveBeenCalledWith({ kind: 'self', userId: 7 }, 7);
    const document = createOpenApiDocument(app);
    expect(
      document.paths['/api/v1/admin/articles/custom-fields']?.get,
    ).toBeDefined();
    expect(
      document.components?.schemas?.ArticleFieldDefinitionVO,
    ).toMatchObject({
      required: expect.arrayContaining([
        'fieldKey',
        'dataType',
        'canRead',
        'canWrite',
      ]),
      properties: {
        dataType: { enum: expect.arrayContaining(['date', 'single_select']) },
      },
    });
    await request(app.getHttpServer())
      .get(`${base}/custom-fields`)
      .set('authorization', 'Bearer no-grant')
      .expect(403);
  });
  it('accepts write-only changes, preserves unreadable values and never echoes them', async () => {
    const response = await request(app.getHttpServer())
      .patch(`${base}/19`)
      .set('authorization', 'Bearer editor')
      .send({ ...body, customFields: { write: 'changed' } })
      .expect(200);
    expect(row.customFields).toEqual({
      read: 'visible',
      write: 'changed',
      private: 'hidden',
    });
    expect(response.body.data.customFields).toEqual({ read: 'visible' });
    expect(writes).toHaveBeenCalledWith({ kind: 'self', userId: 7 }, 7);
    expect(tx.audit).toHaveBeenCalledOnce();
  });
  it('rejects readonly/unknown writes and forged ownership without side effects', async () => {
    for (const fieldKey of ['read', 'private', 'unknown'])
      await request(app.getHttpServer())
        .patch(`${base}/19`)
        .set('authorization', 'Bearer editor')
        .send({ ...body, customFields: { [fieldKey]: 'bad' } })
        .expect(422);
    await request(app.getHttpServer())
      .post(base)
      .set('authorization', 'Bearer editor')
      .send({ ...body, actorUserId: 99 })
      .expect(400);
    expect(tx.update).not.toHaveBeenCalled();
    expect(tx.create).not.toHaveBeenCalled();
    expect(tx.appendChanged).not.toHaveBeenCalled();
    expect(tx.audit).not.toHaveBeenCalled();
  });
  it.each([null, [], 'invalid', 42, false])(
    'rejects a non-object customFields payload %j before opening a transaction',
    async (customFields) => {
      for (const method of ['post', 'patch'] as const) {
        await request(app.getHttpServer())
          [method](method === 'post' ? base : `${base}/19`)
          .set('authorization', 'Bearer editor')
          .send({ ...body, customFields })
          .expect(400);
      }
      expect(writes).not.toHaveBeenCalled();
      expect(tx.create).not.toHaveBeenCalled();
      expect(tx.update).not.toHaveBeenCalled();
      expect(tx.appendChanged).not.toHaveBeenCalled();
      expect(tx.audit).not.toHaveBeenCalled();
    },
  );
  it.each([0, 2147483648])(
    'rejects article target %s on every target route before repository access',
    async (id) => {
      for (const [method, path] of [
        ['get', `${base}/${id}`],
        ['patch', `${base}/${id}`],
        ['delete', `${base}/${id}`],
        ['patch', `${base}/${id}/publish`],
        ['patch', `${base}/${id}/withdraw`],
      ] as const) {
        const call = request(app.getHttpServer())
          [method](path)
          .set('authorization', 'Bearer editor');
        if (method === 'patch' && path === `${base}/${id}`) call.send(body);
        await call.expect(400);
      }
      expect(reads).not.toHaveBeenCalled();
      expect(writes).not.toHaveBeenCalled();
    },
  );
  it('distinguishes omission of customFields from clearing one optional writable value', async () => {
    await request(app.getHttpServer())
      .patch(`${base}/19`)
      .set('authorization', 'Bearer editor')
      .send(body)
      .expect(200);
    expect(row.customFields).toEqual({
      read: 'visible',
      write: 'stored',
      private: 'hidden',
    });
    const response = await request(app.getHttpServer())
      .patch(`${base}/19`)
      .set('authorization', 'Bearer editor')
      .send({ ...body, customFields: { write: null } })
      .expect(200);
    expect(row.customFields).toEqual({
      read: 'visible',
      write: null,
      private: 'hidden',
    });
    expect(response.body.data.customFields).toEqual({ read: 'visible' });
  });
  it('applies the same field projection to create and state command responses', async () => {
    const created = await request(app.getHttpServer())
      .post(base)
      .set('authorization', 'Bearer editor')
      .send({ ...body, customFields: { write: 'new write-only' } })
      .expect(201);
    expect(created.body.data.customFields).toEqual({});
    row = articleRecord({
      status: 'draft',
      customFields: { read: 'visible', private: 'hidden' },
    });
    for (const command of ['publish', 'withdraw']) {
      const response = await request(app.getHttpServer())
        .patch(`${base}/19/${command}`)
        .set('authorization', 'Bearer editor')
        .expect(200);
      expect(response.body.data.customFields).toEqual({ read: 'visible' });
    }
  });
  it('denies anonymous and ungranted accounts before opening a repository session', async () => {
    await request(app.getHttpServer()).get(base).expect(401);
    await request(app.getHttpServer())
      .get(base)
      .set('authorization', 'Bearer no-grant')
      .expect(403);
    expect(reads).not.toHaveBeenCalled();
    expect(writes).not.toHaveBeenCalled();
  });
});
