import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { IdentityAccessModule } from '../src/modules/identity-access/identity-access.module.js';
import { BcryptPasswordHasher } from '../src/modules/identity-access/infrastructure/bcrypt-password-hasher.js';
import { PlatformAdministrationModule } from '../src/modules/platform-administration/platform-administration.module.js';
import { PrismaManagedDictionaryRepository } from '../src/modules/platform-administration/infrastructure/prisma-managed-dictionary.repository.js';
import { PrismaService } from '../src/shared/persistence/prisma.service.js';
import { configureHttp } from '../src/shared/http/configure-http.js';
import { DictionaryRagEventHandler } from '../src/modules/ai-assistant/application/dictionary-rag-event-handler.js';
import { RagDocumentIndexingService } from '../src/modules/ai-assistant/application/rag-document-indexing.service.js';
import { PrismaRagSourceReader } from '../src/modules/ai-assistant/infrastructure/prisma-rag-source.reader.js';
import { PrismaRagDocumentWriter } from '../src/modules/ai-assistant/infrastructure/prisma-rag-document-writer.js';
import { PrismaRagCandidateRetriever } from '../src/modules/ai-assistant/infrastructure/prisma-rag-candidate-retriever.js';
import { PrismaInboxExecutor } from '../src/modules/integration-events/infrastructure/prisma-inbox.executor.js';
import type { IntegrationEvent } from '../src/modules/integration-events/domain/integration-event.js';

describe('Managed dictionary HTTP / real PostgreSQL hierarchy, RBAC and atomic writes', () => {
  const prefix = `dict_${randomUUID().slice(0, 8)}`;
  const users: number[] = [];
  const roles: number[] = [];
  const articles: number[] = [];
  const specialItems: number[] = [];
  let tagTypeCreated = false;
  const resorts: number[] = [];
  const ragEventIds: string[] = [];
  const merchantProfiles: number[] = [];
  const dynamics: number[] = [];
  let sequence = 0;
  let app: INestApplication<App>;
  let http: App;
  let prisma: PrismaService;
  let repository: PrismaManagedDictionaryRepository;
  let administrator: { id: number; account: string; token: string };
  let member: typeof administrator;
  let delegated: typeof administrator;
  const url = '/api/v1/admin/dictionaries';

  beforeAll(async () => {
    if (!process.env.DATABASE_URL)
      throw new Error('Dedicated migrated DATABASE_URL required');
    vi.stubEnv(
      'JWT_ACCESS_SECRET',
      'dictionary-http-validation-secret-at-least-32-chars',
    );
    const module = await Test.createTestingModule({
      imports: [IdentityAccessModule, PlatformAdministrationModule],
    }).compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.init();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);
    repository = new PrismaManagedDictionaryRepository(prisma);
    const adminRole = await prisma.role.findUniqueOrThrow({
      where: { SystemRoleCode: 'system_admin' },
    });
    const memberRole = await prisma.role.findUniqueOrThrow({
      where: { SystemRoleCode: 'registered_user' },
    });
    const grants = await prisma.permission.findMany({
      where: {
        PermissionKey: {
          in: [
            'management:portal:enter',
            'system:dict:list',
            'system:dict:create',
            'system:dict:update',
            'system:dict:delete',
          ],
        },
      },
    });
    expect(grants).toHaveLength(5);
    const role = await prisma.role.create({
      data: {
        RoleKey: prefix,
        RoleName: 'Dictionary manager',
        DataScope: 'all',
        RolePermissions: {
          create: grants.map(({ PermissionId }) => ({ PermissionId })),
        },
      },
    });
    roles.push(role.RoleId);
    administrator = await account(adminRole.RoleId);
    member = await account(memberRole.RoleId);
    delegated = await account(role.RoleId);
  });
  afterAll(async () => {
    try {
      if (prisma) {
        await prisma.consumedEvent.deleteMany({
          where: { EventId: { in: ragEventIds } },
        });
        await prisma.ragDocument.deleteMany({
          where: { SourceKey: { startsWith: 'dictionary:' + prefix + '_' } },
        });
        await prisma.article.deleteMany({
          where: { ArticleId: { in: articles } },
        });
        await prisma.dynamic.deleteMany({
          where: { DynamicId: { in: dynamics } },
        });
        await prisma.merchantProfile.deleteMany({
          where: { MerchantId: { in: merchantProfiles } },
        });
        await prisma.customFieldDefinition.deleteMany({
          where: { GroupKey: prefix },
        });
        await prisma.customFieldGroup.deleteMany({
          where: { GroupKey: prefix },
        });
        await prisma.skiResort.deleteMany({
          where: { ResortId: { in: resorts } },
        });
        await prisma.dictionaryItem.deleteMany({
          where: { ItemId: { in: specialItems } },
        });
        if (tagTypeCreated)
          await prisma.dictionaryType.delete({
            where: { DictType: 'resort.fit_tag' },
          });
        await prisma.dictionaryItem.updateMany({
          where: { DictType: { startsWith: prefix } },
          data: { ParentId: null },
        });
        await prisma.dictionaryItem.deleteMany({
          where: { DictType: { startsWith: prefix } },
        });
        await prisma.dictionaryType.deleteMany({
          where: { DictType: { startsWith: prefix } },
        });
        await prisma.operationLog.deleteMany({
          where: { ActorUserId: { in: users } },
        });
        await prisma.outboxEvent.deleteMany({
          where: {
            AggregateType: 'DictionaryItem',
            AggregateId: { startsWith: prefix + ':' },
          },
        });
        // Type names contain suffixes; include the broader, suite-owned prefix.
        await prisma.outboxEvent.deleteMany({
          where: {
            AggregateType: 'DictionaryItem',
            AggregateId: { startsWith: prefix + '_' },
          },
        });
        await prisma.outboxEvent.deleteMany({
          where: {
            AggregateType: 'DictionaryItem',
            AggregateId: {
              in: specialItems.map((id) => `resort.fit_tag:${id}`),
            },
          },
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
    const password = 'dictionary-validation-password';
    const user = await prisma.user.create({
      data: {
        Account: `${prefix}_${users.length}`,
        Nickname: 'Dictionary validator',
        PasswordHash: await new BcryptPasswordHasher().hash(password),
        UserRoles: { create: { RoleId: roleId } },
      },
    });
    users.push(user.UserId);
    const response = await request(http)
      .post('/api/v1/auth/login')
      .send({ account: user.Account, password })
      .expect(200);
    return {
      id: user.UserId,
      account: user.Account,
      token: response.body.data.accessToken as string,
    };
  }
  function audit(traceId = 'dictionary-fixture-trace') {
    return {
      actorUserId: administrator.id,
      traceId,
      clientIp: null,
      userAgent: null,
    };
  }
  function typeInput() {
    return {
      dictType: `${prefix}_${sequence++}`,
      dictName: ' Dictionary ',
      groupKey: prefix,
    };
  }
  async function type() {
    const input = typeInput();
    const response = await request(http)
      .post(url)
      .auth(administrator.token, { type: 'bearer' })
      .send(input)
      .expect(201);
    expect(response.body.data).toMatchObject({
      dictName: 'Dictionary',
      publiclyReadable: false,
      status: 'active',
      items: [],
    });
    return input.dictType;
  }
  async function item(dictType: string, patch: Record<string, unknown> = {}) {
    const response = await request(http)
      .post(`${url}/${dictType}/items`)
      .auth(administrator.token, { type: 'bearer' })
      .send({ label: ' Skill ', value: `value_${sequence++}`, ...patch })
      .expect(201);
    return response.body.data as {
      itemId: number;
      value: string;
      parentId: number | null;
    };
  }
  function events(dictType: string) {
    return prisma.outboxEvent.findMany({
      where: {
        AggregateType: 'DictionaryItem',
        AggregateId: { startsWith: dictType + ':' },
      },
      orderBy: { CreatedAt: 'asc' },
    });
  }
  async function log(traceId: string, actionKey: string) {
    const records = await prisma.operationLog.findMany({
      where: { TraceId: traceId },
    });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      ActorUserId: administrator.id,
      ActorAccountSnapshot: administrator.account,
      ActionKey: actionKey,
      ResourceKey: 'system:dict',
      Result: 'success',
    });
    return records[0];
  }

  it('reads exactly one item with its sorted subtree, including disabled management records', async () => {
    const dictType = await type();
    const root = await item(dictType);
    const child = await item(dictType, { parentId: root.itemId });
    const leaf = await item(dictType, { parentId: child.itemId });
    const sibling = await item(dictType);
    const response = await request(http)
      .get(`${url}/${dictType}/items/${child.itemId}`)
      .auth(delegated.token, { type: 'bearer' })
      .expect(200);
    expect(response.body.data).toMatchObject({
      itemId: child.itemId,
      parentId: root.itemId,
      children: [{ itemId: leaf.itemId, children: [] }],
    });
    expect(JSON.stringify(response.body.data)).not.toContain(
      `"itemId":${sibling.itemId}`,
    );
    await request(http)
      .delete(`${url}/${dictType}/items/${child.itemId}`)
      .auth(administrator.token, { type: 'bearer' })
      .expect(204);
    const disabled = await request(http)
      .get(`${url}/${dictType}/items/${child.itemId}`)
      .auth(delegated.token, { type: 'bearer' })
      .expect(200);
    expect(disabled.body.data.status).toBe('disabled');
  });

  it('returns 404 for a missing type or an item from another type without changing audit/outbox', async () => {
    const first = await type(),
      second = await type();
    const entry = await item(first);
    const beforeLogs = await prisma.operationLog.count();
    const beforeEvents = await prisma.outboxEvent.count();
    for (const path of [
      `${second}/items/${entry.itemId}`,
      `${prefix}_missing/items/${entry.itemId}`,
      `${first}/items/2147483647`,
    ]) {
      await request(http)
        .get(`${url}/${path}`)
        .auth(delegated.token, { type: 'bearer' })
        .expect(404);
    }
    expect(await prisma.operationLog.count()).toBe(beforeLogs);
    expect(await prisma.outboxEvent.count()).toBe(beforeEvents);
  });

  it.each([
    '0',
    '-1',
    '1.5',
    '2147483648',
    '9007199254740991',
    'Infinity',
    'abc',
  ])('rejects invalid item path %s with 400', async (id) => {
    const dictType = await type();
    await request(http)
      .get(`${url}/${dictType}/items/${id}`)
      .auth(delegated.token, { type: 'bearer' })
      .expect(400);
  });

  it('protects single-item reads with current entry/list grants, without hardcoding a role', async () => {
    const dictType = await type();
    const entry = await item(dictType);
    const path = `${url}/${dictType}/items/${entry.itemId}`;
    await request(http).get(path).expect(401);
    await request(http)
      .get(path)
      .auth(member.token, { type: 'bearer' })
      .expect(403);
    await request(http)
      .get(path)
      .auth(delegated.token, { type: 'bearer' })
      .expect(200);
    for (const PermissionKey of [
      'system:dict:list',
      'management:portal:enter',
    ]) {
      const permission = await prisma.permission.findUniqueOrThrow({
        where: { PermissionKey },
      });
      const data = { RoleId: roles[0], PermissionId: permission.PermissionId };
      await prisma.rolePermission.delete({
        where: { RoleId_PermissionId: data },
      });
      try {
        await request(http)
          .get(path)
          .auth(delegated.token, { type: 'bearer' })
          .expect(403);
      } finally {
        await prisma.rolePermission.create({ data });
      }
    }
  });

  it('persists a sorted three-level tree, nullable parent/color updates, and soft disable/restore', async () => {
    const dictType = await type();
    const root = await item(dictType, {
      value: 'root',
      sortOrder: 2,
      isDefault: true,
    });
    const first = await item(dictType, { value: 'first', sortOrder: 1 });
    const child = await item(dictType, {
      value: 'child',
      parentId: root.itemId,
      color: '#CCFFCC',
    });
    const leaf = await item(dictType, {
      value: 'leaf',
      parentId: child.itemId,
    });
    const tree = await request(http)
      .get(`${url}/${dictType}/items`)
      .auth(administrator.token, { type: 'bearer' })
      .expect(200);
    expect(
      tree.body.data.map((entry: { itemId: number }) => entry.itemId),
    ).toEqual([first.itemId, root.itemId]);
    expect(tree.body.data[1].children[0].children[0].itemId).toBe(leaf.itemId);
    const detach = await request(http)
      .patch(`${url}/${dictType}/items/${child.itemId}`)
      .auth(administrator.token, { type: 'bearer' })
      .send({ parentId: null, color: null })
      .expect(200);
    expect(detach.body.data).toMatchObject({ parentId: null, color: null });
    await log(detach.body.traceId, 'system:dict:item:update');
    const disabled = await request(http)
      .delete(`${url}/${dictType}/items/${root.itemId}`)
      .auth(administrator.token, { type: 'bearer' })
      .expect(204);
    await log(disabled.headers['x-trace-id'], 'system:dict:item:delete');
    expect(
      (await repository.findType(dictType))?.items.find(
        (entry) => entry.itemId === root.itemId,
      )?.status,
    ).toBe('disabled');
    await request(http)
      .patch(`${url}/${dictType}/items/${root.itemId}`)
      .auth(administrator.token, { type: 'bearer' })
      .send({ status: 'active' })
      .expect(200);
    await request(http)
      .delete(`${url}/${dictType}`)
      .auth(administrator.token, { type: 'bearer' })
      .expect(204);
    await request(http)
      .post(`${url}/${dictType}/items`)
      .auth(administrator.token, { type: 'bearer' })
      .send({ label: 'Rejected', value: 'disabled' })
      .expect(400);
    const restored = await request(http)
      .patch(`${url}/${dictType}`)
      .auth(administrator.token, { type: 'bearer' })
      .send({ status: 'active', publiclyReadable: true })
      .expect(200);
    await log(restored.body.traceId, 'system:dict:update');
    expect(restored.body.data.items).toHaveLength(3);
  });

  it('uses the same filters and stable ordering for list and total', async () => {
    const keys = [await type(), await type(), await type()];
    // Filter by a unique group so fixtures from other tests cannot affect count.
    const groupKey = `${prefix}_filter`;
    for (const key of keys)
      await request(http)
        .patch(`${url}/${key}`)
        .auth(administrator.token, { type: 'bearer' })
        .send({ groupKey })
        .expect(200);
    await request(http)
      .delete(`${url}/${keys[0]}`)
      .auth(administrator.token, { type: 'bearer' })
      .expect(204);
    const response = await request(http)
      .get(url)
      .auth(administrator.token, { type: 'bearer' })
      .query({ groupKey, status: 'active', pageSize: 1, page: 2 })
      .expect(200);
    expect(response.body.data).toMatchObject({
      total: 2,
      pageSize: 1,
      page: 2,
      hasNext: false,
    });
    expect(response.body.data.items[0].dictType).toBe(
      keys.slice(1).sort((a, b) => a.localeCompare(b))[1],
    );
  });

  it('enforces management entry plus current action grants and rejects ordinary/anonymous accounts', async () => {
    await request(http).get(url).expect(401);
    await request(http)
      .get(url)
      .auth(member.token, { type: 'bearer' })
      .expect(403);
    await request(http)
      .get(url)
      .auth(delegated.token, { type: 'bearer' })
      .expect(200);
    const roleId = roles[0];
    for (const PermissionKey of [
      'system:dict:list',
      'management:portal:enter',
    ]) {
      const permission = await prisma.permission.findUniqueOrThrow({
        where: { PermissionKey },
      });
      const data = { RoleId: roleId, PermissionId: permission.PermissionId };
      await prisma.rolePermission.delete({
        where: { RoleId_PermissionId: data },
      });
      try {
        await request(http)
          .get(url)
          .auth(delegated.token, { type: 'bearer' })
          .expect(403);
      } finally {
        await prisma.rolePermission.create({ data });
      }
    }
    const input = typeInput();
    await request(http)
      .post(url)
      .auth(delegated.token, { type: 'bearer' })
      .send(input)
      .expect(201);
  });

  it('rejects forged context, immutable keys and duplicate values without side effects', async () => {
    const dictType = await type();
    await item(dictType, { value: 'unique' });
    const count = await prisma.operationLog.count({
      where: { ActorUserId: { in: users } },
    });
    const eventCount = (await events(dictType)).length;
    await request(http)
      .patch(`${url}/${dictType}`)
      .auth(administrator.token, { type: 'bearer' })
      .send({ dictType: 'forged' })
      .expect(400);
    await request(http)
      .post(url)
      .auth(administrator.token, { type: 'bearer' })
      .send({ ...typeInput(), audit: audit() })
      .expect(400);
    await request(http)
      .post(`${url}/${dictType}/items`)
      .auth(administrator.token, { type: 'bearer' })
      .send({ label: 'Duplicate', value: 'unique' })
      .expect(409);
    expect(
      await prisma.operationLog.count({
        where: { ActorUserId: { in: users } },
      }),
    ).toBe(count);
    expect((await events(dictType)).length).toBe(eventCount);
  });

  it('rejects missing, cross-type, self and ancestor parents; URL type scopes updates and deletes', async () => {
    const dictType = await type();
    const other = await type();
    const root = await item(dictType);
    const child = await item(dictType, { parentId: root.itemId });
    const foreign = await item(other);
    for (const parentId of [
      root.itemId,
      child.itemId,
      foreign.itemId,
      2147483647,
    ]) {
      await request(http)
        .patch(`${url}/${dictType}/items/${root.itemId}`)
        .auth(administrator.token, { type: 'bearer' })
        .send({ parentId })
        .expect(400);
    }
    await request(http)
      .patch(`${url}/${other}/items/${root.itemId}`)
      .auth(administrator.token, { type: 'bearer' })
      .send({ label: 'Wrong type' })
      .expect(404);
    await request(http)
      .delete(`${url}/${other}/items/${root.itemId}`)
      .auth(administrator.token, { type: 'bearer' })
      .expect(404);
    await expect(
      prisma.dictionaryItem.create({
        data: {
          DictType: dictType,
          Label: 'Invalid parent',
          Value: 'invalid_parent',
          ParentId: foreign.itemId,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('prevents a cycle when two parent assignments are submitted concurrently', async () => {
    const dictType = await type();
    const a = await item(dictType),
      b = await item(dictType);
    const responses = await Promise.all(
      [
        [a, b],
        [b, a],
      ].map(([source, parent]) =>
        request(http)
          .patch(`${url}/${dictType}/items/${source.itemId}`)
          .auth(administrator.token, { type: 'bearer' })
          .send({ parentId: parent.itemId }),
      ),
    );
    expect(
      responses.filter((response) => response.status === 200),
    ).toHaveLength(1);
    expect(
      responses.every((response) => [200, 400, 409].includes(response.status)),
    ).toBe(true);
    const rows = await prisma.dictionaryItem.findMany({
      where: { DictType: dictType },
    });
    expect(rows.some((row) => row.ParentId === null)).toBe(true);
    expect((await repository.findType(dictType))?.items).toHaveLength(1);
  });

  it.each(['article', 'resort'] as const)(
    'protects an existing %s reference against value renaming and physical deletion',
    async (kind) => {
      let dictType = await type();
      if (kind === 'resort') {
        dictType = 'resort.fit_tag';
        if (
          !(await prisma.dictionaryType.findUnique({
            where: { DictType: dictType },
          }))
        ) {
          await prisma.dictionaryType.create({
            data: {
              DictType: dictType,
              DictName: 'Fit tags',
              GroupKey: prefix,
            },
          });
          tagTypeCreated = true;
        }
      }
      const entry = await item(dictType, { value: prefix + '_reference' });
      if (kind === 'resort') specialItems.push(entry.itemId);
      if (kind === 'article') {
        const record = await prisma.article.create({
          data: {
            Title: 'Validation',
            Summary: 'Summary',
            Body: 'Body',
            CategoryDictType: dictType,
            CategoryValue: entry.value,
          },
        });
        articles.push(record.ArticleId);
      } else {
        const record = await prisma.skiResort.create({
          data: {
            Name: 'Dictionary reference validation',
            LegacyDistance: 0,
            Price: 0,
            SnowCondition: 'unknown',
            Description: 'Validation',
          },
        });
        resorts.push(record.ResortId);
        await prisma.resortFitTag.create({
          data: {
            ResortId: record.ResortId,
            DictType: dictType,
            ItemId: entry.itemId,
          },
        });
      }
      await request(http)
        .patch(`${url}/${dictType}/items/${entry.itemId}`)
        .auth(administrator.token, { type: 'bearer' })
        .send({ value: 'renamed' })
        .expect(409);
      await expect(
        prisma.dictionaryItem.delete({ where: { ItemId: entry.itemId } }),
      ).rejects.toMatchObject({ code: 'P2003' });
      await request(http)
        .delete(`${url}/${dictType}/items/${entry.itemId}`)
        .auth(administrator.token, { type: 'bearer' })
        .expect(204);
      expect(
        await prisma.dictionaryItem.findUnique({
          where: { ItemId: entry.itemId },
        }),
      ).toMatchObject({ Value: entry.value, Status: 'disabled' });
    },
  );

  it('commits dictionary item and type changes with audit and RAG outbox payloads', async () => {
    const dictType = await type();
    const parent = await item(dictType, { value: 'old_parent' });
    const child = await item(dictType, { parentId: parent.itemId });
    expect(await events(dictType)).toHaveLength(2);
    const rename = await request(http)
      .patch(`${url}/${dictType}/items/${parent.itemId}`)
      .auth(administrator.token, { type: 'bearer' })
      .set('x-trace-id', 'untrusted-client-trace')
      .send({ value: 'new_parent' })
      .expect(200);
    expect(rename.body.traceId).not.toBe('untrusted-client-trace');
    await log(rename.body.traceId, 'system:dict:item:update');
    expect(
      (await events(dictType)).map((event) => event.Payload),
    ).toContainEqual({
      dictType,
      itemId: parent.itemId,
      previousValue: 'old_parent',
    });
    await request(http)
      .patch(`${url}/${dictType}`)
      .auth(administrator.token, { type: 'bearer' })
      .send({ publiclyReadable: true })
      .expect(200);
    expect(await events(dictType)).toHaveLength(6);
    await request(http)
      .delete(`${url}/${dictType}`)
      .auth(administrator.token, { type: 'bearer' })
      .expect(204);
    const final = await events(dictType);
    expect(final).toHaveLength(8);
    expect(
      final
        .slice(-2)
        .map((event) => event.AggregateId)
        .sort((a, b) => a.localeCompare(b)),
    ).toEqual(
      [`${dictType}:${parent.itemId}`, `${dictType}:${child.itemId}`].sort(
        (a, b) => a.localeCompare(b),
      ),
    );
    expect(
      final.every(
        (event) =>
          event.EventType === 'dictionary.changed.v1' &&
          event.Status === 'pending',
      ),
    ).toBe(true);
  });

  it.each([
    'createType',
    'updateType',
    'disableType',
    'createItem',
    'updateItem',
    'disableItem',
  ] as const)(
    'rolls back %s when the actual operation log INSERT fails',
    async (operation) => {
      const dictType = await type();
      const entry = await item(dictType);
      const snapshot = async () => ({
        types: await prisma.dictionaryType.findMany({
          where: { DictType: { startsWith: prefix } },
          orderBy: { DictType: 'asc' },
        }),
        items: await prisma.dictionaryItem.findMany({
          where: { DictType: { startsWith: prefix } },
          orderBy: { ItemId: 'asc' },
        }),
        logs: await prisma.operationLog.count({
          where: { ActorUserId: administrator.id },
        }),
        outbox: await prisma.outboxEvent.count({
          where: {
            AggregateType: 'DictionaryItem',
            AggregateId: { startsWith: prefix + '_' },
          },
        }),
      });
      const before = await snapshot();
      const badAudit = audit('x'.repeat(101));
      const mutations = {
        createType: () =>
          repository.createType({
            ...typeInput(),
            publiclyReadable: true,
            audit: badAudit,
          }),
        updateType: () =>
          repository.updateType({
            dictType,
            patch: { publiclyReadable: true },
            audit: badAudit,
          }),
        disableType: () =>
          repository.disableType({ dictType, audit: badAudit }),
        createItem: () =>
          repository.createItem({
            dictType,
            item: {
              label: 'New',
              value: 'new',
              parentId: null,
              color: null,
              sortOrder: 0,
              isDefault: false,
            },
            audit: badAudit,
          }),
        updateItem: () =>
          repository.updateItem({
            dictType,
            itemId: entry.itemId,
            patch: { value: 'new' },
            audit: badAudit,
          }),
        disableItem: () =>
          repository.disableItem({
            dictType,
            itemId: entry.itemId,
            audit: badAudit,
          }),
      };
      await expect(mutations[operation]()).rejects.toThrow();
      expect(await snapshot()).toEqual(before);
    },
  );

  it('schedules every affected descendant after a parent label, move or status change', async () => {
    const dictType = await type();
    const root = await item(dictType, { value: 'root' });
    const child = await item(dictType, {
      value: 'child',
      parentId: root.itemId,
    });
    const leaf = await item(dictType, {
      value: 'leaf',
      parentId: child.itemId,
    });
    const unrelated = await item(dictType, { value: 'unrelated' });
    for (const patch of [
      { label: 'Updated path' },
      { parentId: unrelated.itemId },
      { status: 'disabled' },
      { status: 'active' },
    ]) {
      const count = (await events(dictType)).length;
      await request(http)
        .patch(`${url}/${dictType}/items/${root.itemId}`)
        .auth(administrator.token, { type: 'bearer' })
        .send(patch)
        .expect(200);
      const added = (await events(dictType)).slice(count);
      expect(
        added
          .map((event) => (event.Payload as { itemId: number }).itemId)
          .sort((a, b) => a - b),
      ).toEqual([root.itemId, child.itemId, leaf.itemId].sort((a, b) => a - b));
    }
    const count = (await events(dictType)).length;
    await request(http)
      .delete(`${url}/${dictType}/items/${root.itemId}`)
      .auth(administrator.token, { type: 'bearer' })
      .expect(204);
    expect((await events(dictType)).slice(count)).toHaveLength(3);
  });

  it('rebuilds descendant pgvector content and restores it after a parent is disabled and reactivated', async () => {
    const dictType = await type();
    await request(http)
      .patch(`${url}/${dictType}`)
      .auth(administrator.token, { type: 'bearer' })
      .send({ publiclyReadable: true })
      .expect(200);
    const parent = await item(dictType, { label: 'Old path', value: 'parent' });
    const child = await item(dictType, {
      label: 'Child skill',
      value: 'child',
      parentId: parent.itemId,
    });
    const vector = Array.from({ length: 1024 }, (_, index) =>
      index === 0 ? 1 : 0,
    );
    const writer = new PrismaRagDocumentWriter(prisma);
    const reader = new PrismaRagSourceReader(prisma);
    const handler = new DictionaryRagEventHandler(
      reader,
      new PrismaInboxExecutor(prisma),
      new RagDocumentIndexingService(
        new ConfigService({ EMBEDDING_MODEL: 'BAAI/bge-m3' }),
        { embed: async (texts) => texts.map(() => vector) },
        writer,
      ),
      writer,
    );
    const seen = new Set<string>();
    async function consume() {
      for (const event of await events(dictType)) {
        if (seen.has(event.EventId)) continue;
        const input: IntegrationEvent = {
          eventId: event.EventId,
          eventType: event.EventType,
          aggregateType: event.AggregateType,
          aggregateId: event.AggregateId,
          occurredAt: event.CreatedAt,
          payload: event.Payload as IntegrationEvent['payload'],
        };
        ragEventIds.push(event.EventId);
        expect(await handler.handle(input)).toBe(true);
        expect(await handler.handle(input)).toBe(false);
        seen.add(event.EventId);
      }
    }
    const sourceKey = `dictionary:${dictType}:${child.value}`;
    const document = () =>
      prisma.ragDocument.findUniqueOrThrow({ where: { SourceKey: sourceKey } });
    const retriever = new PrismaRagCandidateRetriever(prisma);
    const visible = async () =>
      (
        await retriever.search(
          {
            embedding: vector,
            embeddingModel: 'BAAI/bge-m3',
            limit: 100,
          },
          { public: true, merchant: { kind: 'none' }, admin: false },
        )
      ).some((entry) => entry.sourceKey === sourceKey);
    await consume();
    expect((await document()).Content).toContain('Old path / Child skill');
    expect(await visible()).toBe(true);
    await request(http)
      .patch(`${url}/${dictType}/items/${parent.itemId}`)
      .auth(administrator.token, { type: 'bearer' })
      .send({ label: 'New path' })
      .expect(200);
    expect(await visible()).toBe(false);
    await consume();
    expect((await document()).Content).toContain('New path / Child skill');
    expect(await visible()).toBe(true);
    await request(http)
      .delete(`${url}/${dictType}/items/${parent.itemId}`)
      .auth(administrator.token, { type: 'bearer' })
      .expect(204);
    expect(await visible()).toBe(false);
    await consume();
    expect((await document()).Status).toBe('disabled');
    await request(http)
      .patch(`${url}/${dictType}/items/${parent.itemId}`)
      .auth(administrator.token, { type: 'bearer' })
      .send({ status: 'active' })
      .expect(200);
    await consume();
    expect((await document()).Status).toBe('indexed');
    expect(await visible()).toBe(true);
  });

  it('rolls back configuration and the already inserted audit when the actual Outbox INSERT fails', async () => {
    const dictType = await type();
    const entry = await item(dictType);
    const before = await prisma.dictionaryItem.findUniqueOrThrow({
      where: { ItemId: entry.itemId },
    });
    const logCount = await prisma.operationLog.count({
      where: { ActorUserId: administrator.id },
    });
    const eventCount = (await events(dictType)).length;
    // SQL contains only suite-generated identifiers, never HTTP or fixture content.
    if (!/^[a-z0-9_]+$/.test(dictType)) throw new Error('Unsafe test identity');
    const functionName = `${prefix}_outbox_failure`;
    const triggerName = `${prefix}_outbox_trigger`;
    await prisma.$executeRawUnsafe(`CREATE FUNCTION "${functionName}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW."AggregateId" = '${dictType}:${entry.itemId}' THEN RAISE EXCEPTION 'validation outbox unavailable'; END IF;
      RETURN NEW; END $$`);
    try {
      await prisma.$executeRawUnsafe(
        `CREATE TRIGGER "${triggerName}" BEFORE INSERT ON "OutboxEvent" FOR EACH ROW EXECUTE FUNCTION "${functionName}"()`,
      );
      await expect(
        repository.updateItem({
          dictType,
          itemId: entry.itemId,
          patch: { label: 'Must roll back' },
          audit: audit(),
        }),
      ).rejects.toThrow();
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS "${triggerName}" ON "OutboxEvent"`,
      );
      await prisma.$executeRawUnsafe(
        `DROP FUNCTION IF EXISTS "${functionName}"()`,
      );
    }
    expect(
      await prisma.dictionaryItem.findUniqueOrThrow({
        where: { ItemId: entry.itemId },
      }),
    ).toEqual(before);
    expect(
      await prisma.operationLog.count({
        where: { ActorUserId: administrator.id },
      }),
    ).toBe(logCount);
    expect((await events(dictType)).length).toBe(eventCount);
  });

  it.each([
    'ski_resort',
    'article',
    'dynamic',
    'merchant_profile',
    'default',
  ] as const)(
    'protects dictionary values referenced by %s custom fields, including disabled definitions',
    async (entityType) => {
      const dictType = await type();
      const entry = await item(dictType);
      const resource = entityType === 'default' ? 'article' : entityType;
      await prisma.customFieldGroup.upsert({
        where: {
          EntityType_GroupKey: { EntityType: resource, GroupKey: prefix },
        },
        create: {
          EntityType: resource,
          GroupKey: prefix,
          Label: 'Dictionary reference',
        },
        update: {},
      });
      const fieldKey = `selection_${sequence++}`;
      await prisma.customFieldDefinition.create({
        data: {
          EntityType: resource,
          FieldKey: fieldKey,
          Label: 'Selection',
          DataType: entityType === 'article' ? 'multi_select' : 'single_select',
          GroupKey: prefix,
          OptionsDictType: dictType,
          Status: 'disabled',
          ...(entityType === 'default' ? { DefaultValue: entry.value } : {}),
        },
      });
      const CustomFields = {
        [fieldKey]: entityType === 'article' ? [entry.value] : entry.value,
      };
      if (entityType === 'ski_resort') {
        const record = await prisma.skiResort.create({
          data: {
            Name: 'Custom reference',
            LegacyDistance: 0,
            Price: 0,
            SnowCondition: 'unknown',
            Description: 'Validation',
            CustomFields,
            DeletedAt: new Date(),
          },
        });
        resorts.push(record.ResortId);
      } else if (entityType === 'article') {
        const record = await prisma.article.create({
          data: {
            Title: 'Custom reference',
            Summary: 'Summary',
            Body: 'Body',
            CategoryDictType: dictType,
            CategoryValue: (await item(dictType, { value: 'other_category' }))
              .value,
            CustomFields,
            DeletedAt: new Date(),
          },
        });
        articles.push(record.ArticleId);
      } else if (entityType === 'dynamic') {
        const record = await prisma.dynamic.create({
          data: {
            AuthorId: administrator.id,
            Content: 'Custom reference',
            CustomFields,
            DeletedAt: new Date(),
          },
        });
        dynamics.push(record.DynamicId);
      } else if (entityType === 'merchant_profile') {
        const record = await prisma.merchantProfile.create({
          data: {
            UserId: delegated.id,
            BusinessName: 'Custom reference',
            CustomFields,
            Status: 'disabled',
          },
        });
        merchantProfiles.push(record.MerchantId);
      }
      const count = (await events(dictType)).length;
      await request(http)
        .patch(`${url}/${dictType}/items/${entry.itemId}`)
        .auth(administrator.token, { type: 'bearer' })
        .send({ value: 'renamed_reference' })
        .expect(409);
      expect((await events(dictType)).length).toBe(count);
      expect(
        await prisma.dictionaryItem.findUnique({
          where: { ItemId: entry.itemId },
        }),
      ).toMatchObject({ Value: entry.value });
    },
  );

  it('does not let an oversized request User-Agent break a valid configuration write', async () => {
    const response = await request(http)
      .post(url)
      .auth(administrator.token, { type: 'bearer' })
      .set('User-Agent', 'x'.repeat(600))
      .send(typeInput())
      .expect(201);
    expect(
      (await log(response.body.traceId, 'system:dict:create')).UserAgent,
    ).toHaveLength(500);
  });

  it.each(['dictName', 'publiclyReadable'] as const)(
    'rejects null for non-nullable type property %s',
    async (property) => {
      const dictType = await type();
      await request(http)
        .patch(`${url}/${dictType}`)
        .auth(administrator.token, { type: 'bearer' })
        .send({ [property]: null })
        .expect(400);
    },
  );
  it.each(['label', 'value', 'sortOrder', 'isDefault', 'status'] as const)(
    'rejects null for non-nullable item property %s',
    async (property) => {
      const dictType = await type();
      const entry = await item(dictType);
      await request(http)
        .patch(`${url}/${dictType}/items/${entry.itemId}`)
        .auth(administrator.token, { type: 'bearer' })
        .send({ [property]: null })
        .expect(400);
    },
  );
  it('rejects null optional create flags while allowing omitted defaults', async () => {
    const dictType = await type();
    await request(http)
      .post(url)
      .auth(administrator.token, { type: 'bearer' })
      .send({ ...typeInput(), publiclyReadable: null })
      .expect(400);
    for (const property of ['sortOrder', 'isDefault'])
      await request(http)
        .post(`${url}/${dictType}/items`)
        .auth(administrator.token, { type: 'bearer' })
        .send({
          label: 'Invalid default',
          value: 'invalid_' + property,
          [property]: null,
        })
        .expect(400);
  });
  it('rejects an unsafe computed pagination offset', async () => {
    await request(http)
      .get(url)
      .auth(administrator.token, { type: 'bearer' })
      .query({ page: Number.MAX_SAFE_INTEGER, pageSize: 100 })
      .expect(400);
  });
});
