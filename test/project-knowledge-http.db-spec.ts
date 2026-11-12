import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { IdentityAccessModule } from '../src/modules/identity-access/identity-access.module.js';
import { BcryptPasswordHasher } from '../src/modules/identity-access/infrastructure/bcrypt-password-hasher.js';
import { PrismaService } from '../src/shared/persistence/prisma.service.js';
import { configureHttp } from '../src/shared/http/configure-http.js';
import { ProjectKnowledgeService } from '../src/modules/knowledge-content/application/project-knowledge.service.js';
import { PROJECT_KNOWLEDGE_REPOSITORY } from '../src/modules/knowledge-content/application/ports/project-knowledge-repository.js';
import { PrismaProjectKnowledgeRepository } from '../src/modules/knowledge-content/infrastructure/prisma-project-knowledge.repository.js';
import { ProjectKnowledgeController } from '../src/modules/knowledge-content/presentation/http/project-knowledge.controller.js';
import { PrismaOutboxStore } from '../src/modules/integration-events/infrastructure/prisma-outbox.store.js';
import { OUTBOX_STORE } from '../src/modules/integration-events/application/ports/outbox-store.js';

describe('Project knowledge real HTTP / transaction authorization / atomic writes', () => {
  const prefix = `pkhttp_${randomUUID().slice(0, 8)}`;
  const users: number[] = [],
    roles: number[] = [],
    documents: number[] = [];
  const base = '/api/v1/admin/project-knowledge';
  const body = {
    title: prefix,
    content: 'Public platform instructions',
    category: 'platform',
  };
  type Actor = { id: number; token: string };
  type Operation = 'create' | 'update' | 'publish' | 'withdraw' | 'delete';
  let app: INestApplication<App>,
    http: App,
    prisma: PrismaService,
    repository: PrismaProjectKnowledgeRepository;
  let adminRoleId: number, owner: Actor;
  beforeAll(async () => {
    if (!process.env.DATABASE_URL)
      throw new Error('Dedicated migrated database required');
    vi.stubEnv(
      'JWT_ACCESS_SECRET',
      'project-knowledge-http-validation-at-least-32-characters',
    );
    const module = await Test.createTestingModule({
      imports: [IdentityAccessModule],
      controllers: [ProjectKnowledgeController],
      providers: [
        ProjectKnowledgeService,
        {
          provide: PROJECT_KNOWLEDGE_REPOSITORY,
          useClass: PrismaProjectKnowledgeRepository,
        },
        { provide: OUTBOX_STORE, useClass: PrismaOutboxStore },
      ],
    }).compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.init();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);
    repository = app.get(PROJECT_KNOWLEDGE_REPOSITORY);
    adminRoleId = (
      await prisma.role.findUniqueOrThrow({
        where: { SystemRoleCode: 'system_admin' },
      })
    ).RoleId;
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
            AggregateType: 'project_doc',
            AggregateId: { in: documents.map(String) },
          },
        });
        await prisma.projectKnowledge.deleteMany({
          where: { ProjectKnowledgeId: { in: documents } },
        });
        await prisma.user.deleteMany({ where: { UserId: { in: users } } });
        await prisma.role.deleteMany({ where: { RoleId: { in: roles } } });
      }
    } finally {
      await app?.close();
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
    }
  });
  async function account(roleId = adminRoleId): Promise<Actor> {
    const password = 'project-http-validation-password';
    const user = await prisma.user.create({
      data: {
        Account: `${prefix}_${users.length}`,
        Nickname: prefix,
        PasswordHash: await new BcryptPasswordHasher().hash(password),
        UserRoles: { create: { RoleId: roleId } },
      },
    });
    users.push(user.UserId);
    const response = await request(http)
      .post('/api/v1/auth/login')
      .send({ account: user.Account, password })
      .expect(200);
    return { id: user.UserId, token: response.body.data.accessToken as string };
  }
  async function document(status = 'draft', version = 1) {
    const row = await prisma.projectKnowledge.create({
      data: {
        Title: prefix,
        Content: body.content,
        Category: body.category,
        Status: status,
        Version: version,
        ...(status === 'published' ? { PublishTime: new Date() } : {}),
      },
    });
    documents.push(row.ProjectKnowledgeId);
    return row.ProjectKnowledgeId;
  }
  function patch(id: number, data: object, actor = owner) {
    return request(http)
      .patch(`${base}/${id}`)
      .auth(actor.token, { type: 'bearer' })
      .send(data);
  }
  async function execute(operation: Operation, id: number, actor = owner) {
    if (operation === 'create') {
      const response = await request(http)
        .post(base)
        .auth(actor.token, { type: 'bearer' })
        .send(body);
      if (response.body.data?.projectKnowledgeId)
        documents.push(response.body.data.projectKnowledgeId as number);
      return response;
    }
    if (operation === 'update')
      return patch(
        id,
        { ...body, content: 'Updated platform instructions', version: 1 },
        actor,
      );
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
      count: await prisma.projectKnowledge.count({
        where: { Title: { startsWith: prefix } },
      }),
      logs: await prisma.operationLog.count({
        where: { ActorUserId: { in: users } },
      }),
      events: await prisma.outboxEvent.count({
        where: {
          AggregateType: 'project_doc',
          AggregateId: { in: documents.map(String) },
        },
      }),
    };
  }
  function audit(actor = owner, traceId: string = randomUUID()) {
    return { actorUserId: actor.id, traceId, clientIp: null, userAgent: null };
  }
  const operations = [
    'create',
    'update',
    'publish',
    'withdraw',
    'delete',
  ] as const;
  it.each(operations)(
    'rechecks built-in administrator binding for %s after the HTTP Guard',
    async (operation) => {
      const actor = await account(),
        id = await document(operation === 'withdraw' ? 'published' : 'draft'),
        before = await effects();
      const original = repository.runWrite.bind(repository);
      const spy = vi
        .spyOn(repository, 'runWrite')
        .mockImplementationOnce(async (work) => {
          await prisma.userRole.delete({
            where: { UserId_RoleId: { UserId: actor.id, RoleId: adminRoleId } },
          });
          return original(work);
        });
      try {
        expect((await execute(operation, id, actor)).status).toBe(403);
      } finally {
        spy.mockRestore();
      }
      expect(await effects()).toEqual(before);
      expect(
        await prisma.projectKnowledge.findUniqueOrThrow({
          where: { ProjectKnowledgeId: id },
        }),
      ).toMatchObject({ Content: body.content, Version: 1, DeletedAt: null });
    },
  );
  it.each(['disabled account', 'extra active role'] as const)(
    'rejects %s committed before the write transaction',
    async (change) => {
      const actor = await account(),
        id = await document(),
        before = await effects();
      const original = repository.runWrite.bind(repository);
      const spy = vi
        .spyOn(repository, 'runWrite')
        .mockImplementationOnce(async (work) => {
          if (change === 'disabled account')
            await prisma.user.update({
              where: { UserId: actor.id },
              data: { Status: 'disabled' },
            });
          else {
            const role = await prisma.role.create({
              data: {
                RoleKey: `${prefix}_${roles.length}`,
                RoleName: prefix,
                DataScope: 'self',
              },
            });
            roles.push(role.RoleId);
            await prisma.userRole.create({
              data: { UserId: actor.id, RoleId: role.RoleId },
            });
          }
          return original(work);
        });
      try {
        await patch(id, { ...body, version: 1 }, actor).expect(403);
      } finally {
        spy.mockRestore();
      }
      expect(await effects()).toEqual(before);
    },
  );
  it('does not accept a custom role with all grants as the protected administrator identity', async () => {
    const permissions = await prisma.permission.findMany({
      where: {
        OR: [
          { PermissionKey: 'management:portal:enter' },
          { PermissionKey: { startsWith: 'content:project-knowledge:' } },
        ],
      },
    });
    const role = await prisma.role.create({
      data: {
        RoleKey: `${prefix}_${roles.length}`,
        RoleName: prefix,
        DataScope: 'all',
        RolePermissions: {
          create: permissions.map((p) => ({ PermissionId: p.PermissionId })),
        },
      },
    });
    roles.push(role.RoleId);
    const actor = await account(role.RoleId),
      id = await document(),
      before = await effects();
    await request(http).get(base).expect(401);
    await request(http)
      .get(base)
      .auth(actor.token, { type: 'bearer' })
      .expect(403);
    for (const operation of operations)
      expect((await execute(operation, id, actor)).status).toBe(403);
    await expect(
      app.get(ProjectKnowledgeService).create(body, audit(actor)),
    ).rejects.toMatchObject({ status: 403 });
    expect(await effects()).toEqual(before);
  });
  it.each([
    { title: 'password=private-value' },
    { category: 'editor@example.com' },
    {
      content:
        '-----BEGIN PRIVATE KEY-----\nprivate material\n-----END PRIVATE KEY-----',
    },
    { sourceUrl: 'https://example.org/docs?%74oken=private-value' },
    { sourceUrl: 'https://user:private-value@example.org/docs' },
  ])(
    'rejects prohibited metadata or body before persisting: %j',
    async (extra) => {
      const id = await document(),
        before = await effects();
      await patch(id, { ...body, ...extra, version: 1 }).expect(422);
      expect(await effects()).toEqual(before);
    },
  );
  it.each(['0', '2147483648'])(
    'rejects out-of-range identifier %s before PostgreSQL execution',
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
  it('rejects impossible version input and exhausted persisted versions without SQL overflow', async () => {
    const id = await document(),
      exhausted = await document('draft', 2147483647),
      before = await effects();
    await patch(id, { ...body, version: 2147483648 }).expect(400);
    await request(http)
      .patch(`${base}/${exhausted}/publish`)
      .auth(owner.token, { type: 'bearer' })
      .send({})
      .expect(409);
    expect(await effects()).toEqual(before);
  });
  it.each(operations)(
    'rolls back %s and its Outbox when the real audit INSERT fails',
    async (operation) => {
      const id = await document(
          operation === 'withdraw' ? 'published' : 'draft',
        ),
        before = await effects();
      const service = app.get(ProjectKnowledgeService),
        context = audit(owner, 'x'.repeat(101));
      const work =
        operation === 'create'
          ? service.create(body, context)
          : operation === 'update'
            ? service.update(
                id,
                { ...body, content: 'Must roll back', version: 1 },
                context,
              )
            : operation === 'publish'
              ? service.publish(id, context)
              : operation === 'withdraw'
                ? service.withdraw(id, context)
                : service.remove(id, context);
      await expect(work).rejects.toMatchObject({ code: 'P2000' });
      expect(await effects()).toEqual(before);
      expect(
        await prisma.projectKnowledge.findUniqueOrThrow({
          where: { ProjectKnowledgeId: id },
        }),
      ).toMatchObject({
        Version: 1,
        Content: body.content,
        DeletedAt: null,
        Status: operation === 'withdraw' ? 'published' : 'draft',
      });
    },
  );
  it('allows only one of two concurrent updates with the same version', async () => {
    const id = await document();
    const responses = await Promise.all([
      patch(id, { ...body, content: 'Edit one', version: 1 }),
      patch(id, { ...body, content: 'Edit two', version: 1 }),
    ]);
    expect(responses.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      200, 409,
    ]);
    expect(
      (
        await prisma.projectKnowledge.findUniqueOrThrow({
          where: { ProjectKnowledgeId: id },
        })
      ).Version,
    ).toBe(2);
    expect(
      await prisma.outboxEvent.count({
        where: { AggregateType: 'project_doc', AggregateId: String(id) },
      }),
    ).toBe(1);
    expect(
      await prisma.operationLog.count({
        where: { TargetType: 'ProjectKnowledge', TargetId: String(id) },
      }),
    ).toBe(1);
  });
  it('refuses publication of prohibited legacy metadata without an event or audit', async () => {
    const id = await document();
    await prisma.projectKnowledge.update({
      where: { ProjectKnowledgeId: id },
      data: { SourceUrl: 'https://example.org/?token=private-value' },
    });
    const before = await effects();
    await request(http)
      .patch(`${base}/${id}/publish`)
      .auth(owner.token, { type: 'bearer' })
      .send({})
      .expect(422);
    expect(await effects()).toEqual(before);
    expect(
      await prisma.projectKnowledge.findUniqueOrThrow({
        where: { ProjectKnowledgeId: id },
      }),
    ).toMatchObject({ Status: 'draft', Version: 1, PublishTime: null });
  });
  it('keeps first publication, explicit status commands and the six-step lifecycle audit', async () => {
    const created = await execute('create', 0);
    expect(created.status).toBe(201);
    const id = created.body.data.projectKnowledgeId as number;
    expect(created.body.data).toMatchObject({
      status: 'draft',
      publishTime: null,
      version: 1,
    });
    const published = await execute('publish', id);
    expect(published.status).toBe(200);
    expect(published.body.data.publishTime).toEqual(expect.any(String));
    await request(http)
      .patch(`${base}/${id}/publish`)
      .auth(owner.token, { type: 'bearer' })
      .send({})
      .expect(409);
    const edited = await patch(id, {
      ...body,
      content: 'Public updated instructions',
      version: 2,
    }).expect(200);
    expect(edited.body.data).toMatchObject({
      status: 'published',
      version: 3,
      publishTime: published.body.data.publishTime,
    });
    expect((await execute('withdraw', id)).status).toBe(200);
    expect((await execute('publish', id)).body.data.publishTime).toBe(
      published.body.data.publishTime,
    );
    expect((await execute('delete', id)).status).toBe(204);
    await request(http)
      .get(`${base}/${id}`)
      .auth(owner.token, { type: 'bearer' })
      .expect(404);
    expect(
      await prisma.outboxEvent.count({
        where: { AggregateType: 'project_doc', AggregateId: String(id) },
      }),
    ).toBe(6);
    expect(
      await prisma.operationLog.count({
        where: { TargetType: 'ProjectKnowledge', TargetId: String(id) },
      }),
    ).toBe(6);
  });
});
