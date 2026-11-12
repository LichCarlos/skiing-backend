import { LOGIN_ATTEMPT_STORE } from '../src/modules/identity-access/application/ports/login-attempt-store.js';
import {
  ForbiddenException,
  NotFoundException,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureHttp } from '../src/shared/http/configure-http.js';
import { createOpenApiDocument } from '../src/shared/http/openapi-document.js';
import { AUTH_TOKEN_SERVICE } from '../src/modules/identity-access/application/ports/auth-token-service.js';
import { AUTH_SESSION_REPOSITORY } from '../src/modules/identity-access/application/ports/auth-session-repository.js';
import {
  AUTHORIZATION_PRINCIPAL_READER,
  type AuthorizationPrincipalRecord,
} from '../src/modules/identity-access/application/ports/authorization-principal-reader.js';
import {
  AI_CONVERSATION_AUDIT_REPOSITORY,
  type AiConversationAuditRepository,
} from '../src/modules/ai-assistant/application/ports/ai-conversation-audit.repository.js';

// Real Nest routing, authentication/authorization guards, DTO transformation,
// application service and error/response middleware; persistence is replaced.
describe('AI conversation audit HTTP privacy contract', () => {
  const base = '/api/v1/admin/ai/conversations';
  const id = '078edc04-0d24-4f83-a509-54c472869e70';
  const time = '2026-11-01T00:00:00.000Z';
  const portal = 'management:portal:enter';
  const list = 'system:ai-conversation:list';
  const content = 'system:ai-conversation:read-content';
  const metadata = {
    conversationId: id,
    userId: 7,
    status: 'deleted' as const,
    createdAt: time,
    updatedAt: time,
    deletedAt: time,
    messageCount: 1,
  };
  const messages = [
    {
      messageId: '9007199254740993',
      sender: 'user',
      content: 'private-message-marker',
      generationStatus: null,
      createdAt: time,
      citations: [{ sourceKey: 'article:17' }],
    },
  ];
  const repository = {
    list: vi.fn<AiConversationAuditRepository['list']>(),
    find: vi.fn<AiConversationAuditRepository['find']>(),
    readContent: vi.fn<AiConversationAuditRepository['readContent']>(),
  };
  let app: INestApplication;
  let principal: AuthorizationPrincipalRecord;

  function actor(
    permissions = [portal, list, content],
  ): AuthorizationPrincipalRecord {
    return {
      userId: 11,
      status: 'active',
      merchant: null,
      roles: [
        {
          key: 'custom-auditor',
          status: 'active',
          dataScope: 'self',
          permissions: permissions.map((key) => ({ key, status: 'active' })),
          dataScopes: [
            { resourceKey: 'user', scopeType: 'all', scopeConfig: null },
          ],
        },
      ],
    };
  }

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LOGIN_ATTEMPT_STORE)
      .useValue({ consume: async () => ({ allowed: true }) })
      .overrideProvider(AUTH_TOKEN_SERVICE)
      .useValue({
        verifyAccessToken: (token: string) =>
          token === 'auditor'
            ? { userId: 11, sessionId: 'audit-http-session' }
            : null,
      })
      .overrideProvider(AUTH_SESSION_REPOSITORY)
      .useValue({ isActive: async () => true })
      .overrideProvider(AUTHORIZATION_PRINCIPAL_READER)
      .useValue({ findByUserId: async () => principal })
      .overrideProvider(AI_CONVERSATION_AUDIT_REPOSITORY)
      .useValue(repository)
      .compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.init();
  });
  afterAll(async () => app?.close());
  beforeEach(() => {
    vi.resetAllMocks();
    principal = actor();
    repository.list.mockResolvedValue({ items: [metadata], total: 1 });
    repository.find.mockResolvedValue(metadata);
    repository.readContent.mockResolvedValue({ messages });
  });

  it('requires authentication before listing or reading content', async () => {
    await request(app.getHttpServer()).get(base).expect(401);
    await request(app.getHttpServer())
      .post(`${base}/${id}/content-access`)
      .send({ reason: 'Support request' })
      .expect(401);
    expect(repository.list).not.toHaveBeenCalled();
    expect(repository.readContent).not.toHaveBeenCalled();
  });

  it.each([
    [list, content],
    [portal, content],
    [portal, list],
  ])(
    'requires both grants and the management entrance: %j',
    async (...permissions) => {
      principal = actor(permissions);
      await request(app.getHttpServer())
        .post(`${base}/${id}/content-access`)
        .set('authorization', 'Bearer auditor')
        .send({ reason: 'Support request' })
        .expect(403);
      expect(repository.readContent).not.toHaveBeenCalled();
    },
  );

  it('allows a custom role to read minimum metadata without a content grant', async () => {
    principal = actor([portal, list]);
    const response = await request(app.getHttpServer())
      .get(base)
      .set('authorization', 'Bearer auditor')
      .expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.data).toEqual({
      items: [metadata],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    expect(Object.keys(response.body.data.items[0]).sort()).toEqual(
      Object.keys(metadata).sort(),
    );
    expect(repository.list).toHaveBeenCalledWith(
      11,
      expect.objectContaining({ page: 1, pageSize: 20 }),
    );
    expect(repository.readContent).not.toHaveBeenCalled();
    expect(response.text).not.toContain('private-message-marker');
  });

  it('returns retained soft-deleted metadata with no-store and no content access', async () => {
    const response = await request(app.getHttpServer())
      .get(`${base}/${id}`)
      .set('authorization', 'Bearer auditor')
      .expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.data).toEqual(metadata);
    expect(repository.find).toHaveBeenCalledWith(11, id);
    expect(repository.readContent).not.toHaveBeenCalled();
  });

  it('passes validated filters while taking the actor solely from authentication', async () => {
    await request(app.getHttpServer())
      .get(base)
      .set('authorization', 'Bearer auditor')
      .query({
        page: 2,
        pageSize: 10,
        userId: 7,
        status: 'deleted',
        fromTime: time,
        toTime: time,
      })
      .expect(200);
    expect(repository.list).toHaveBeenCalledWith(
      11,
      expect.objectContaining({
        page: 2,
        pageSize: 10,
        userId: 7,
        status: 'deleted',
        fromTime: time,
        toTime: time,
      }),
    );
  });

  it.each([
    { page: 0 },
    { pageSize: 101 },
    { page: 2147483647, pageSize: 100 },
    { userId: 2147483648 },
    { status: 'all' },
    { actorUserId: 99 },
    { fromTime: '2026-02-30T00:00:00Z' },
    { fromTime: '2026-11-01T00:00:00' },
    { fromTime: '2026-11-02T00:00:00Z', toTime: time },
  ])(
    'rejects invalid/untrusted filters before persistence: %j',
    async (query) => {
      await request(app.getHttpServer())
        .get(base)
        .set('authorization', 'Bearer auditor')
        .query(query)
        .expect(400);
      expect(repository.list).not.toHaveBeenCalled();
    },
  );

  it.each([
    {},
    { reason: null },
    { reason: '' },
    { reason: '  ' },
    { reason: 'x'.repeat(501) },
    { reason: 'Support request', userId: 99 },
    { reason: ['Support request'] },
  ])('rejects invalid reasons and identity fields: %j', async (body) => {
    await request(app.getHttpServer())
      .post(`${base}/${id}/content-access`)
      .set('authorization', 'Bearer auditor')
      .send(body)
      .expect(400);
    expect(repository.readContent).not.toHaveBeenCalled();
  });

  it('reads only through the audited command and propagates trimmed reason and trace', async () => {
    const response = await request(app.getHttpServer())
      .post(`${base}/${id}/content-access`)
      .set('authorization', 'Bearer auditor')
      .send({ reason: '  Support request  ' })
      .expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.data).toEqual({ messages });
    expect(repository.readContent).toHaveBeenCalledWith(11, id, {
      reason: 'Support request',
      traceId: response.body.traceId,
    });
    expect(repository.find).not.toHaveBeenCalled();
  });

  it('never returns message bodies or internal errors when the audit transaction fails', async () => {
    repository.readContent.mockRejectedValue(
      new Error('audit-insert-secret private-message-marker'),
    );
    const response = await request(app.getHttpServer())
      .post(`${base}/${id}/content-access`)
      .set('authorization', 'Bearer auditor')
      .send({ reason: 'Support request' })
      .expect(500);
    expect(response.body.data).toBeNull();
    expect(response.text).not.toContain('private-message-marker');
    expect(response.text).not.toContain('audit-insert-secret');
  });

  it('propagates transaction-time revocation without returning messages', async () => {
    repository.readContent.mockRejectedValue(new ForbiddenException());
    const response = await request(app.getHttpServer())
      .post(`${base}/${id}/content-access`)
      .set('authorization', 'Bearer auditor')
      .send({ reason: 'Support request' })
      .expect(403);
    expect(response.text).not.toContain('private-message-marker');
  });

  it('returns the same 404 envelope for missing metadata and content targets', async () => {
    repository.find.mockResolvedValue(null);
    repository.readContent.mockRejectedValue(
      new NotFoundException('Conversation not found'),
    );
    const detail = await request(app.getHttpServer())
      .get(`${base}/${id}`)
      .set('authorization', 'Bearer auditor')
      .expect(404);
    const body = await request(app.getHttpServer())
      .post(`${base}/${id}/content-access`)
      .set('authorization', 'Bearer auditor')
      .send({ reason: 'Support request' })
      .expect(404);
    expect(detail.body.msg).toBe(body.body.msg);
    expect(detail.body.data).toBeNull();
    expect(body.body.data).toBeNull();
  });

  it('rejects non-UUID identifiers before accessing metadata or content', async () => {
    await request(app.getHttpServer())
      .get(`${base}/not-a-uuid`)
      .set('authorization', 'Bearer auditor')
      .expect(400);
    await request(app.getHttpServer())
      .post(`${base}/not-a-uuid/content-access`)
      .set('authorization', 'Bearer auditor')
      .send({ reason: 'Support request' })
      .expect(400);
    expect(repository.find).not.toHaveBeenCalled();
    expect(repository.readContent).not.toHaveBeenCalled();
  });

  it('exposes no administrator deletion, restoration or export operation', async () => {
    await request(app.getHttpServer())
      .delete(`${base}/${id}`)
      .set('authorization', 'Bearer auditor')
      .expect(404);
    await request(app.getHttpServer())
      .post(`${base}/${id}/restore`)
      .set('authorization', 'Bearer auditor')
      .expect(404);
    const spec = createOpenApiDocument(app);
    const paths = Object.entries(spec.paths).filter(([path]) =>
      path.startsWith(base),
    );
    expect(
      paths.map(([path, item]) => [
        path,
        Object.keys(item ?? {}).filter((key) =>
          ['get', 'post', 'put', 'patch', 'delete'].includes(key),
        ),
      ]),
    ).toEqual([
      [base, ['get']],
      [`${base}/{conversationId}`, ['get']],
      [`${base}/{conversationId}/content-access`, ['post']],
    ]);
  });
  it('documents stored JSON citations without an object-only constraint', () => {
    const spec = createOpenApiDocument(app);
    const schema = spec.components?.schemas?.AiConversationAuditMessageVO;
    if (!schema || !('properties' in schema))
      throw new Error('Missing audit message schema');
    const citations = schema.properties?.citations;
    expect(spec.info.version).toBe('1.55.0');
    expect(citations).toEqual({
      description:
        'Stored JSON citations; object, array, scalar or null; no provider credentials',
      anyOf: [
        { type: 'object', additionalProperties: true, nullable: true },
        { type: 'array', items: {}, nullable: true },
        { type: 'string', nullable: true },
        { type: 'number', nullable: true },
        { type: 'boolean', nullable: true },
      ],
    });
    expect(schema.required).toContain('citations');
  });
  it.each(
    [
      [{ sourceKey: 'article:17', historical: { labels: ['初级'] } }],
      { sourceKey: 'article:17', extra: [true, null, 1.25] },
      'legacy-citation',
      1.25,
      true,
      null,
    ].map((citations) => ({ citations })),
  )('returns stored JSON citations unchanged: %j', async ({ citations }) => {
    repository.readContent.mockResolvedValue({
      messages: [{ ...messages[0]!, citations }],
    });
    const response = await request(app.getHttpServer())
      .post(`${base}/${id}/content-access`)
      .set('authorization', 'Bearer auditor')
      .send({ reason: 'Historical citation compatibility' })
      .expect(200);
    expect(response.body.data.messages[0].citations).toEqual(citations);
  });
});
