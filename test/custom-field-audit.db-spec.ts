import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { IdentityAccessModule } from '../src/modules/identity-access/identity-access.module.js';
import { BcryptPasswordHasher } from '../src/modules/identity-access/infrastructure/bcrypt-password-hasher.js';
import { PlatformAdministrationModule } from '../src/modules/platform-administration/platform-administration.module.js';
import { PrismaCustomFieldRepository } from '../src/modules/platform-administration/infrastructure/prisma-custom-field.repository.js';
import { PrismaService } from '../src/shared/persistence/prisma.service.js';
import { configureHttp } from '../src/shared/http/configure-http.js';

describe('Custom field configuration / real HTTP, PostgreSQL and atomic audit', () => {
  const prefix = `cf_${randomUUID().slice(0, 8)}`;
  const users: number[] = [];
  const roles: number[] = [];
  let app: INestApplication<App>;
  let http: App;
  let prisma: PrismaService;
  let repository: PrismaCustomFieldRepository;
  let administrator: { id: number; account: string; token: string };
  let member: typeof administrator;
  let delegated: typeof administrator;
  let delegatedRoleId: number;
  let groupReadPermissionId: number;
  let portalPermissionId: number;
  let sequence = 0;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL)
      throw new Error('Dedicated migrated DATABASE_URL required');
    vi.stubEnv(
      'JWT_ACCESS_SECRET',
      'custom-field-validation-secret-at-least-32-chars',
    );
    const module = await Test.createTestingModule({
      imports: [IdentityAccessModule, PlatformAdministrationModule],
    }).compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.init();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);
    repository = new PrismaCustomFieldRepository(prisma);
    administrator = await account('system_admin');
    member = await account('registered_user');
    const grants = await prisma.permission.findMany({
      where: {
        PermissionKey: {
          in: ['management:portal:enter', 'system:field-group:list'],
        },
      },
    });
    expect(grants).toHaveLength(2);
    groupReadPermissionId = grants.find(
      (grant) => grant.PermissionKey === 'system:field-group:list',
    )!.PermissionId;
    portalPermissionId = grants.find(
      (grant) => grant.PermissionKey === 'management:portal:enter',
    )!.PermissionId;
    const role = await prisma.role.create({
      data: {
        RoleKey: `${prefix}_reader`,
        RoleName: 'Field group reader',
        DataScope: 'all',
        RolePermissions: {
          create: grants.map(({ PermissionId }) => ({ PermissionId })),
        },
      },
    });
    roles.push(role.RoleId);
    delegatedRoleId = role.RoleId;
    delegated = await account(role.RoleId);
  });

  afterAll(async () => {
    try {
      if (prisma) {
        await prisma.customFieldDefinition.deleteMany({
          where: { GroupKey: { startsWith: prefix } },
        });
        await prisma.customFieldGroup.deleteMany({
          where: { GroupKey: { startsWith: prefix } },
        });
        await prisma.operationLog.deleteMany({
          where: { ActorUserId: { in: users } },
        });
        await prisma.user.deleteMany({ where: { UserId: { in: users } } });
        await prisma.role.deleteMany({ where: { RoleId: { in: roles } } });
      }
    } finally {
      await app?.close();
      vi.unstubAllEnvs();
    }
  });

  async function account(code: string | number) {
    const role = await prisma.role.findUniqueOrThrow({
      where:
        typeof code === 'number' ? { RoleId: code } : { SystemRoleCode: code },
    });
    const password = 'custom-field-validation-password';
    const user = await prisma.user.create({
      data: {
        Account: `${prefix}_${users.length}`,
        Nickname: 'Field validator',
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
      account: user.Account,
      token: response.body.data.accessToken as string,
    };
  }
  function audit(traceId = 'valid-field-trace') {
    return {
      actorUserId: administrator.id,
      traceId,
      clientIp: null,
      userAgent: null,
    };
  }
  async function fixture() {
    const groupKey = `${prefix}_${sequence++}`;
    const group = {
      entityType: 'ski_resort',
      groupKey,
      label: 'confidential-group-label',
      sortOrder: 0,
    };
    await request(http)
      .post('/api/v1/admin/custom-field-groups')
      .auth(administrator.token, { type: 'bearer' })
      .send(group)
      .expect(201);
    const input = {
      entityType: 'ski_resort',
      groupKey,
      fieldKey: groupKey,
      label: 'confidential-field-label',
      dataType: 'text',
      defaultValue: 'confidential-default',
      validation: { maxLength: 100 },
      sortOrder: 0,
      required: false,
      searchable: false,
      filterable: false,
      sortable: false,
      isPublic: false,
    };
    const response = await request(http)
      .post('/api/v1/admin/custom-fields')
      .auth(administrator.token, { type: 'bearer' })
      .send(input)
      .expect(201);
    return {
      group,
      input,
      definition: response.body.data as {
        fieldDefinitionId: number;
        schemaVersion: number;
      },
    };
  }
  async function logFor(traceId: string, action: string) {
    const logs = await prisma.operationLog.findMany({
      where: { TraceId: traceId },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      ActorUserId: administrator.id,
      ActorAccountSnapshot: administrator.account,
      ActionKey: action,
      Result: 'success',
    });
    expect(JSON.stringify(logs[0].Metadata)).not.toMatch(/confidential-/);
    return logs[0];
  }

  it.each([
    ['integer', 0],
    ['boolean', false],
  ] as const)(
    'preserves a %s default through HTTP, PostgreSQL and the response',
    async (dataType, defaultValue) => {
      const { input } = await fixture();
      const response = await request(http)
        .post('/api/v1/admin/custom-fields')
        .auth(administrator.token, { type: 'bearer' })
        .send({
          ...input,
          fieldKey: `${prefix}_${sequence++}`,
          dataType,
          defaultValue,
          validation: null,
        })
        .expect(201);
      expect(response.body.data.defaultValue).toBe(defaultValue);
      expect(
        (
          await repository.findDefinitionById(
            response.body.data.fieldDefinitionId,
          )
        )?.defaultValue,
      ).toBe(defaultValue);
    },
  );

  it('distinguishes omitted defaults from explicit null when editing a field', async () => {
    const { definition } = await fixture();
    const path = `/api/v1/admin/custom-fields/${definition.fieldDefinitionId}`;
    const kept = await request(http)
      .patch(path)
      .auth(administrator.token, { type: 'bearer' })
      .send({ expectedSchemaVersion: 1, label: 'Renamed' })
      .expect(200);
    expect(kept.body.data.defaultValue).toBe('confidential-default');
    expect(kept.body.data.validation).toEqual({ maxLength: 100 });
    const cleared = await request(http)
      .patch(path)
      .auth(administrator.token, { type: 'bearer' })
      .send({
        expectedSchemaVersion: 2,
        defaultValue: null,
        validation: null,
        optionsDictType: null,
      })
      .expect(200);
    expect(cleared.body.data).toMatchObject({
      defaultValue: null,
      validation: null,
      optionsDictType: null,
      schemaVersion: 3,
    });
    expect(
      await repository.findDefinitionById(definition.fieldDefinitionId),
    ).toMatchObject({
      defaultValue: null,
      validation: null,
      optionsDictType: null,
      schemaVersion: 3,
    });
  });

  it('reads the exact group identity and existing VO without audit or Outbox writes', async () => {
    const { group } = await fixture();
    const before = {
      logs: await prisma.operationLog.count(),
      events: await prisma.outboxEvent.count(),
    };
    const response = await request(http)
      .get(`/api/v1/admin/custom-field-groups/ski_resort/${group.groupKey}`)
      .auth(administrator.token, { type: 'bearer' })
      .expect(200);
    expect(response.body.data).toEqual({
      ...group,
      status: 'active',
      visibilityRule: null,
      createTime: expect.any(String),
      updateTime: expect.any(String),
    });
    expect(await prisma.operationLog.count()).toBe(before.logs);
    expect(await prisma.outboxEvent.count()).toBe(before.events);
  });

  it('keeps the same group key isolated between supported entity types', async () => {
    const { group } = await fixture();
    const path = `/api/v1/admin/custom-field-groups/article/${group.groupKey}`;
    await request(http)
      .get(path)
      .auth(administrator.token, { type: 'bearer' })
      .expect(404);
    await prisma.customFieldGroup.create({
      data: {
        EntityType: 'article',
        GroupKey: group.groupKey,
        Label: 'Article only',
      },
    });
    const response = await request(http)
      .get(path)
      .auth(administrator.token, { type: 'bearer' })
      .expect(200);
    expect(response.body.data).toMatchObject({
      entityType: 'article',
      label: 'Article only',
      groupKey: group.groupKey,
    });
  });

  it('keeps disabled groups readable for management', async () => {
    const { group } = await fixture();
    const path = `/api/v1/admin/custom-field-groups/ski_resort/${group.groupKey}`;
    await request(http)
      .delete(path)
      .auth(administrator.token, { type: 'bearer' })
      .expect(204);
    const response = await request(http)
      .get(path)
      .auth(administrator.token, { type: 'bearer' })
      .expect(200);
    expect(response.body.data.status).toBe('disabled');
  });

  it('rejects anonymous and unprivileged readers before exposing group data', async () => {
    const { group } = await fixture();
    const path = `/api/v1/admin/custom-field-groups/ski_resort/${group.groupKey}`;
    await request(http).get(path).expect(401);
    await request(http)
      .get(path)
      .auth(member.token, { type: 'bearer' })
      .expect(403);
  });

  it.each(['portal', 'group-read'] as const)(
    'uses configurable grants and immediately honors revoked %s permission',
    async (permission) => {
      const { group } = await fixture();
      const path = `/api/v1/admin/custom-field-groups/ski_resort/${group.groupKey}`;
      await request(http)
        .get(path)
        .auth(delegated.token, { type: 'bearer' })
        .expect(200);
      const PermissionId =
        permission === 'portal' ? portalPermissionId : groupReadPermissionId;
      await prisma.rolePermission.deleteMany({
        where: { RoleId: delegatedRoleId, PermissionId },
      });
      try {
        await request(http)
          .get(path)
          .auth(delegated.token, { type: 'bearer' })
          .expect(403);
      } finally {
        await prisma.rolePermission.create({
          data: { RoleId: delegatedRoleId, PermissionId },
        });
      }
      await request(http)
        .get(path)
        .auth(delegated.token, { type: 'bearer' })
        .expect(200);
    },
  );

  it('returns 404 for a valid missing group', async () => {
    await request(http)
      .get(`/api/v1/admin/custom-field-groups/ski_resort/${prefix}_absent`)
      .auth(administrator.token, { type: 'bearer' })
      .expect(404);
  });

  it.each([
    ['unknown', 'facilities'],
    ['ski_resort', 'Uppercase'],
    ['ski_resort', 'bad.key'],
    ['ski_resort', 'has space'],
    ['ski_resort', 'a'.repeat(101)],
  ])(
    'rejects malformed identity %s / %s with 400',
    async (entityType, groupKey) => {
      await request(http)
        .get(
          `/api/v1/admin/custom-field-groups/${entityType}/${encodeURIComponent(groupKey)}`,
        )
        .auth(administrator.token, { type: 'bearer' })
        .expect(400);
    },
  );

  it('audits every HTTP mutation with the authenticated actor and server trace; logs remain redacted on read', async () => {
    const { group, definition } = await fixture();
    const fieldUrl = `/api/v1/admin/custom-fields/${definition.fieldDefinitionId}`;
    const groupUrl = `/api/v1/admin/custom-field-groups/ski_resort/${group.groupKey}`;
    const creation = await prisma.operationLog.findMany({
      where: {
        ActorUserId: administrator.id,
        TargetId: {
          in: [
            String(definition.fieldDefinitionId),
            `ski_resort:${group.groupKey}`,
          ],
        },
      },
    });
    expect(
      creation
        .map((log) => log.ActionKey)
        .sort((left, right) => left.localeCompare(right)),
    ).toEqual(['system:field-group:create', 'system:field:create']);
    expect(JSON.stringify(creation.map((log) => log.Metadata))).not.toMatch(
      /confidential-/,
    );
    const update = await request(http)
      .patch(fieldUrl)
      .auth(administrator.token, { type: 'bearer' })
      .set('User-Agent', 'field-audit-agent')
      .send({
        expectedSchemaVersion: 1,
        label: 'confidential-update',
        isPublic: true,
      })
      .expect(200);
    const log = await logFor(update.body.traceId, 'system:field:update');
    expect(log.UserAgent).toBe('field-audit-agent');
    expect(log.Metadata).toMatchObject({
      before: { schemaVersion: 1, isPublic: false },
      after: { schemaVersion: 2, isPublic: true },
    });
    const activate = await request(http)
      .patch(`${fieldUrl}/activate`)
      .auth(administrator.token, { type: 'bearer' })
      .send({ expectedSchemaVersion: 2 })
      .expect(200);
    expect(
      (await logFor(activate.body.traceId, 'system:field:update')).Metadata,
    ).toMatchObject({ after: { status: 'active', schemaVersion: 3 } });
    await request(http)
      .delete(groupUrl)
      .auth(administrator.token, { type: 'bearer' })
      .expect(409);
    const disable = await request(http)
      .delete(fieldUrl)
      .auth(administrator.token, { type: 'bearer' })
      .expect(204);
    await logFor(disable.headers['x-trace-id'], 'system:field:delete');
    const updateGroup = await request(http)
      .patch(groupUrl)
      .auth(administrator.token, { type: 'bearer' })
      .send({ label: 'confidential-group-update', sortOrder: 2 })
      .expect(200);
    await logFor(updateGroup.body.traceId, 'system:field-group:update');
    const disableGroup = await request(http)
      .delete(groupUrl)
      .auth(administrator.token, { type: 'bearer' })
      .expect(204);
    await logFor(
      disableGroup.headers['x-trace-id'],
      'system:field-group:delete',
    );
    const read = await request(http)
      .get('/api/v1/admin/operation-logs')
      .query({ traceId: update.body.traceId })
      .auth(administrator.token, { type: 'bearer' })
      .expect(200);
    expect(read.body.data.total).toBe(1);
    expect(read.body.data.items[0]).not.toHaveProperty('metadata');
    expect(read.body.data.items[0]).not.toHaveProperty('userAgent');
  });

  it('rejects unauthorized and forged audit input without changes or success logs', async () => {
    const { input, definition } = await fixture();
    const count = await prisma.operationLog.count({
      where: { ActorUserId: { in: users } },
    });
    await request(http)
      .patch(`/api/v1/admin/custom-fields/${definition.fieldDefinitionId}`)
      .auth(member.token, { type: 'bearer' })
      .send({ expectedSchemaVersion: 1, label: 'forbidden' })
      .expect(403);
    await request(http)
      .post('/api/v1/admin/custom-fields')
      .auth(administrator.token, { type: 'bearer' })
      .send({
        ...input,
        fieldKey: `${prefix}_forged`,
        audit: { actorUserId: member.id },
      })
      .expect(400);
    expect(
      await prisma.operationLog.count({
        where: { ActorUserId: { in: users } },
      }),
    ).toBe(count);
    expect(
      (await repository.findDefinitionById(definition.fieldDefinitionId))
        ?.schemaVersion,
    ).toBe(1);
  });

  it('allows exactly one same-version concurrent update and writes only its audit', async () => {
    const { definition } = await fixture();
    const count = await prisma.operationLog.count({
      where: {
        TargetType: 'CustomFieldDefinition',
        TargetId: String(definition.fieldDefinitionId),
      },
    });
    const results = await Promise.all(
      ['first', 'second'].map((label) =>
        request(http)
          .patch(`/api/v1/admin/custom-fields/${definition.fieldDefinitionId}`)
          .auth(administrator.token, { type: 'bearer' })
          .send({ expectedSchemaVersion: 1, label }),
      ),
    );
    expect(
      results
        .map((result) => result.status)
        .sort((left, right) => left - right),
    ).toEqual([200, 409]);
    expect(
      (await repository.findDefinitionById(definition.fieldDefinitionId))
        ?.schemaVersion,
    ).toBe(2);
    expect(
      await prisma.operationLog.count({
        where: {
          TargetType: 'CustomFieldDefinition',
          TargetId: String(definition.fieldDefinitionId),
        },
      }),
    ).toBe(count + 1);
  });

  it('keeps activation and group disabling consistent under concurrent requests', async () => {
    const { definition, group } = await fixture();
    const responses = await Promise.all([
      request(http)
        .patch(
          `/api/v1/admin/custom-fields/${definition.fieldDefinitionId}/activate`,
        )
        .auth(administrator.token, { type: 'bearer' })
        .send({ expectedSchemaVersion: 1 }),
      request(http)
        .delete(
          `/api/v1/admin/custom-field-groups/ski_resort/${group.groupKey}`,
        )
        .auth(administrator.token, { type: 'bearer' }),
    ]);
    expect(responses.filter((response) => response.status < 300)).toHaveLength(
      1,
    );
    expect(
      responses.every((response) =>
        [200, 204, 400, 409].includes(response.status),
      ),
    ).toBe(true);
    const field = await repository.findDefinitionById(
      definition.fieldDefinitionId,
    );
    const currentGroup = await repository.findGroup(
      'ski_resort',
      group.groupKey,
    );
    expect(
      field?.status === 'active' && currentGroup?.status === 'disabled',
    ).toBe(false);
  });

  it.each([
    'createDefinition',
    'updateDefinition',
    'setDefinitionStatus',
    'createGroup',
    'updateGroup',
    'disableGroup',
  ] as const)(
    'rolls back %s when the actual audit INSERT fails',
    async (operation) => {
      const { group, input, definition } = await fixture();
      const snapshots = async () => ({
        definitions: await prisma.customFieldDefinition.findMany({
          where: { GroupKey: { startsWith: prefix } },
          orderBy: { FieldDefinitionId: 'asc' },
        }),
        groups: await prisma.customFieldGroup.findMany({
          where: { GroupKey: { startsWith: prefix } },
          orderBy: { GroupKey: 'asc' },
        }),
        logCount: await prisma.operationLog.count({
          where: { ActorUserId: administrator.id },
        }),
      });
      const before = await snapshots();
      // The audit column is varchar(100): the real INSERT fails, after the real
      // configuration write, without replacing Prisma or using a mock database.
      const badAudit = audit('x'.repeat(101));
      const mutate = {
        createDefinition: () =>
          repository.createDefinition(
            { ...input, fieldKey: `${prefix}_rollback` },
            badAudit,
          ),
        updateDefinition: () =>
          repository.updateDefinition(
            {
              fieldDefinitionId: definition.fieldDefinitionId,
              expectedSchemaVersion: 1,
              patch: { isPublic: true, defaultValue: 'confidential-change' },
            },
            badAudit,
          ),
        setDefinitionStatus: () =>
          repository.setDefinitionStatus(
            {
              fieldDefinitionId: definition.fieldDefinitionId,
              expectedSchemaVersion: 1,
              status: 'active',
            },
            badAudit,
          ),
        createGroup: () =>
          repository.createGroup(
            { ...group, groupKey: `${prefix}_rollback_group` },
            badAudit,
          ),
        updateGroup: () =>
          repository.updateGroup(
            { ...group, label: 'confidential-change' },
            badAudit,
          ),
        disableGroup: () =>
          repository.disableGroup('ski_resort', group.groupKey, badAudit),
      };
      await expect(mutate[operation]()).rejects.toThrow();
      expect(await snapshots()).toEqual(before);
    },
  );

  it('rechecks group references inside the write transaction and leaves no partial field', async () => {
    const { group, input } = await fixture();
    await repository.disableGroup('ski_resort', group.groupKey, audit());
    await expect(
      repository.createDefinition(
        { ...input, fieldKey: `${prefix}_stale_group` },
        audit(),
      ),
    ).rejects.toThrow('An active field group is required');
    expect(
      await prisma.customFieldDefinition.count({
        where: { FieldKey: `${prefix}_stale_group` },
      }),
    ).toBe(0);
  });
});
