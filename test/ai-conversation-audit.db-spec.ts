import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { IdentityAccessModule } from '../src/modules/identity-access/identity-access.module.js';
import { AiAssistantModule } from '../src/modules/ai-assistant/ai-assistant.module.js';
import { BcryptPasswordHasher } from '../src/modules/identity-access/infrastructure/bcrypt-password-hasher.js';
import { PrismaAiConversationAuditRepository } from '../src/modules/ai-assistant/infrastructure/prisma-ai-conversation-audit.repository.js';
import { configureHttp } from '../src/shared/http/configure-http.js';
import { PrismaService } from '../src/shared/persistence/prisma.service.js';

// No auth, authorization, repository or transaction mock. No model is called.
describe('D-47 audit HTTP / PostgreSQL authorization and atomic reads', () => {
  const prefix = `audit-${randomUUID().slice(0, 8)}`;
  const password = 'isolated-audit-validation-password';
  const portal = 'management:portal:enter';
  const list = 'system:ai-conversation:list';
  const content = 'system:ai-conversation:read-content';
  const base = '/api/v1/admin/ai/conversations';
  const time = new Date('2026-11-02T01:00:00Z');
  const users: number[] = [],
    roles: number[] = [],
    conversations: string[] = [];
  const grants = new Map<string, number>();
  type Actor = { id: number; token: string; roleId: number };
  let app: INestApplication<App>, http: App, prisma: PrismaService;
  let repository: PrismaAiConversationAuditRepository, hash: string;
  let auditor: Actor, owner: Actor, foreign: Actor;
  let activeId: string, deletedId: string, foreignId: string, guestId: string;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL)
      throw new Error('Dedicated migrated database required');
    vi.stubEnv(
      'JWT_ACCESS_SECRET',
      'audit-database-validation-secret-at-least-32-characters',
    );
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        IdentityAccessModule,
        AiAssistantModule,
      ],
    }).compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.init();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);
    repository = app.get(PrismaAiConversationAuditRepository);
    const rows = await prisma.permission.findMany({
      where: { PermissionKey: { in: [portal, list, content] } },
    });
    expect(rows).toHaveLength(3);
    for (const row of rows) grants.set(row.PermissionKey, row.PermissionId);
    hash = await new BcryptPasswordHasher().hash(password);
    auditor = await actor('all');
    owner = await actor('self', []);
    foreign = await actor('self', []);
    activeId = await conversation(owner.id);
    deletedId = await conversation(owner.id, true);
    foreignId = await conversation(foreign.id);
    guestId = await conversation(null);
    await prisma.aiMessage.createMany({
      data: [
        {
          ConversationId: activeId,
          SenderRole: 'user',
          Content: `${prefix}-private-question`,
          CreateTime: time,
        },
        {
          ConversationId: activeId,
          SenderRole: 'assistant',
          Content: `${prefix}-private-answer`,
          GenerationStatus: 'completed',
          Citations: [{ sourceKey: 'article:17', title: 'Reference' }],
          CreateTime: time,
        },
      ],
    });
  });
  afterAll(async () => {
    try {
      if (prisma) {
        await prisma.operationLog.deleteMany({
          where: { ActorUserId: { in: users } },
        });
        await prisma.aiConversation.deleteMany({
          where: { ConversationId: { in: conversations } },
        });
        await prisma.merchantProfile.deleteMany({
          where: { UserId: { in: users } },
        });
        await prisma.user.deleteMany({ where: { UserId: { in: users } } });
        await prisma.role.deleteMany({ where: { RoleId: { in: roles } } });
      }
    } finally {
      await app?.close();
      vi.unstubAllEnvs();
    }
  });
  async function actor(
    scope: string,
    keys = [portal, list, content],
    selectedIds?: number[],
  ): Promise<Actor> {
    const role = await prisma.role.create({
      data: {
        RoleKey: `${prefix}-${roles.length}`,
        RoleName: prefix,
        DataScope: 'self',
        RolePermissions: {
          create: keys.map((key) => ({ PermissionId: grants.get(key)! })),
        },
        DataScopes: {
          create: {
            ResourceKey: 'user',
            ScopeType: scope,
            ...(selectedIds ? { ScopeConfig: { selectedIds } } : {}),
          },
        },
      },
    });
    roles.push(role.RoleId);
    const user = await prisma.user.create({
      data: {
        Account: `${prefix}-${users.length}`,
        Nickname: prefix,
        PasswordHash: hash,
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
      token: response.body.data.accessToken as string,
      roleId: role.RoleId,
    };
  }
  async function conversation(userId: number | null, deleted = false) {
    const row = await prisma.aiConversation.create({
      data: {
        UserId: userId,
        GuestSessionId: userId === null ? `${prefix}-guest` : null,
        Title: `${prefix}-secret-title`,
        CreateTime: time,
        UpdateTime: time,
        DeletedAt: deleted ? time : null,
      },
    });
    conversations.push(row.ConversationId);
    return row.ConversationId;
  }
  function read(actor: Actor, id = activeId, reason = 'Support investigation') {
    return request(http)
      .post(`${base}/${id}/content-access`)
      .auth(actor.token, { type: 'bearer' })
      .send({ reason });
  }
  function logs() {
    return prisma.operationLog.findMany({
      where: {
        ActorUserId: { in: users },
        ActionKey: 'ai:conversation:read-content',
      },
    });
  }

  it('paginates an owner-filtered snapshot with exact metadata, stable UUID ties and matching count', async () => {
    const sorted = [activeId, deletedId].sort().reverse();
    for (const page of [1, 2]) {
      const result = await request(http)
        .get(base)
        .auth(auditor.token, { type: 'bearer' })
        .query({
          userId: owner.id,
          page,
          pageSize: 1,
          fromTime: time.toISOString(),
          toTime: time.toISOString(),
        })
        .expect(200);
      expect(result.body.data).toMatchObject({ page, pageSize: 1, total: 2 });
      expect(result.body.data.items[0].conversationId).toBe(sorted[page - 1]);
      expect(Object.keys(result.body.data.items[0]).sort()).toEqual(
        [
          'conversationId',
          'userId',
          'status',
          'createdAt',
          'updatedAt',
          'deletedAt',
          'messageCount',
        ].sort(),
      );
      expect(result.text).not.toContain(`${prefix}-secret`);
      expect(result.text).not.toContain('private-question');
      expect(result.headers['cache-control']).toBe('no-store');
    }
    const result = await request(http)
      .get(`${base}/${activeId}`)
      .auth(auditor.token, { type: 'bearer' })
      .expect(200);
    expect(result.body.data.messageCount).toBe(2);
  });

  it('filters retained deleted conversations and never exposes guest metadata or messages', async () => {
    const response = await request(http)
      .get(base)
      .auth(auditor.token, { type: 'bearer' })
      .query({ userId: owner.id, status: 'deleted' })
      .expect(200);
    expect(response.body.data).toMatchObject({
      total: 1,
      items: [{ conversationId: deletedId, status: 'deleted' }],
    });
    await request(http)
      .get(`${base}/${guestId}`)
      .auth(auditor.token, { type: 'bearer' })
      .expect(404);
    await read(auditor, guestId).expect(404);
    expect(
      (
        await repository.list(auditor.id, { page: 1, pageSize: 100 })
      ).items.some((row) => row.conversationId === guestId),
    ).toBe(false);
  });

  it('enforces self on list/count/detail/content even when an explicit user filter requests another owner', async () => {
    const self = await actor('self');
    const own = await conversation(self.id);
    const response = await request(http)
      .get(base)
      .auth(self.token, { type: 'bearer' })
      .expect(200);
    expect(response.body.data).toMatchObject({
      total: 1,
      items: [{ conversationId: own }],
    });
    const hidden = await request(http)
      .get(base)
      .auth(self.token, { type: 'bearer' })
      .query({ userId: owner.id })
      .expect(200);
    expect(hidden.body.data).toMatchObject({ items: [], total: 0 });
    await request(http)
      .get(`${base}/${activeId}`)
      .auth(self.token, { type: 'bearer' })
      .expect(404);
    await read(self).expect(404);
    await read(self, own).expect(200);
  });

  it('intersects selected user IDs with filters for list/count, detail and content', async () => {
    const selected = await actor(
      'selected',
      [portal, list, content],
      [owner.id],
    );
    const response = await request(http)
      .get(base)
      .auth(selected.token, { type: 'bearer' })
      .expect(200);
    expect(response.body.data.total).toBe(2);
    expect(
      response.body.data.items.every(
        (row: { userId: number }) => row.userId === owner.id,
      ),
    ).toBe(true);
    await request(http)
      .get(`${base}/${foreignId}`)
      .auth(selected.token, { type: 'bearer' })
      .expect(404);
    await read(selected, foreignId).expect(404);
    await read(selected).expect(200);
  });

  it('intersects independently granted list and content scopes instead of widening either', async () => {
    const scoped = await actor('all', [portal, list]);
    const narrow = await actor('selected', [content], [owner.id]);
    await prisma.userRole.create({
      data: { UserId: scoped.id, RoleId: narrow.roleId },
    });
    await read(scoped).expect(200);
    await read(scoped, foreignId).expect(404);
  });

  it('rejects conflicting role scopes before returning content or adding a success audit', async () => {
    const conflicting = await actor('all');
    const second = await actor('self');
    await prisma.userRole.create({
      data: { UserId: conflicting.id, RoleId: second.roleId },
    });
    const before = (await logs()).length;
    await read(conflicting).expect(403);
    await expect(
      repository.readContent(conflicting.id, activeId, {
        reason: 'scope test',
        traceId: prefix,
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(await logs()).toHaveLength(before);
  });

  it('rejects merchant user scope even for an actor with an active merchant profile', async () => {
    const merchant = await actor('merchant');
    await prisma.merchantProfile.create({
      data: { UserId: merchant.id, BusinessName: prefix },
    });
    await read(merchant).expect(403);
    await expect(repository.find(merchant.id, activeId)).rejects.toMatchObject({
      status: 403,
    });
  });

  it('rechecks revoked grants and disabled identities inside the repository transaction', async () => {
    const revoked = await actor('all');
    await prisma.rolePermission.delete({
      where: {
        RoleId_PermissionId: {
          RoleId: revoked.roleId,
          PermissionId: grants.get(content)!,
        },
      },
    });
    await expect(
      repository.readContent(revoked.id, activeId, {
        reason: 'revocation',
        traceId: prefix,
      }),
    ).rejects.toMatchObject({ status: 403 });
    const inactive = await actor('all');
    await prisma.user.update({
      where: { UserId: inactive.id },
      data: { Status: 'disabled' },
    });
    await expect(
      repository.readContent(inactive.id, activeId, {
        reason: 'disabled',
        traceId: prefix,
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      await prisma.operationLog.count({
        where: { ActorUserId: { in: [revoked.id, inactive.id] } },
      }),
    ).toBe(0);
  });

  it('reads ordered stored messages only with a committed minimal audit and trimmed reason', async () => {
    const before = await prisma.aiConversation.findUniqueOrThrow({
      where: { ConversationId: activeId },
    });
    const response = await read(
      auditor,
      activeId,
      '  approved support reason  ',
    ).expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(
      response.body.data.messages.map(
        (row: { content: string }) => row.content,
      ),
    ).toEqual([`${prefix}-private-question`, `${prefix}-private-answer`]);
    const audit = await prisma.operationLog.findFirstOrThrow({
      where: { TraceId: response.body.traceId },
    });
    expect(audit).toMatchObject({
      ActorUserId: auditor.id,
      Reason: 'approved support reason',
      TargetId: activeId,
      Metadata: { userId: owner.id },
    });
    const serializedAudit = JSON.stringify(audit, (_key, value: unknown) =>
      typeof value === 'bigint' ? value.toString() : value,
    );
    expect(serializedAudit).not.toContain(`${prefix}-private`);
    expect(serializedAudit).not.toContain('article:17');
    expect(
      await prisma.aiConversation.findUniqueOrThrow({
        where: { ConversationId: activeId },
      }),
    ).toEqual(before);
  });

  it('returns no content and commits no audit when the actual audit INSERT fails', async () => {
    const before = (await logs()).length;
    // TraceId is varchar(100); deliberately violate that constraint in the real transaction.
    await expect(
      repository.readContent(auditor.id, activeId, {
        reason: 'failure proof',
        traceId: 'x'.repeat(101),
      }),
    ).rejects.toMatchObject({ code: 'P2000' });
    expect(await logs()).toHaveLength(before);
    expect(
      await prisma.aiMessage.count({ where: { ConversationId: activeId } }),
    ).toBe(2);
  });

  it('returns uniform not-found results for missing and out-of-scope UUIDs without audit side effects', async () => {
    const selected = await actor(
      'selected',
      [portal, list, content],
      [owner.id],
    );
    const before = (await logs()).length;
    const missing = await read(selected, randomUUID()).expect(404);
    const hidden = await read(selected, foreignId).expect(404);
    expect(missing.body.msg).toBe(hidden.body.msg);
    expect(missing.body.data).toBeNull();
    expect(hidden.body.data).toBeNull();
    expect(await logs()).toHaveLength(before);
  });
});
