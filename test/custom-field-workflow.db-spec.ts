import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { IdentityAccessModule } from '../src/modules/identity-access/identity-access.module.js';
import { PlatformAdministrationModule } from '../src/modules/platform-administration/platform-administration.module.js';
import { ResortManagementModule } from '../src/modules/resort-management/resort-management.module.js';
import { PrismaService } from '../src/shared/persistence/prisma.service.js';
import { configureHttp } from '../src/shared/http/configure-http.js';

// Real modules/HTTP/JWT/guards/SQL. Only initial administrator and the still
// merchant profile are fixtures; configuration uses public APIs. The separate
// business-closure suite covers the contracted profile creation endpoint.
describe('Configured fields from administrator to merchant and public HTTP', () => {
  const prefix = `cfw_${randomUUID().slice(0, 8)}`;
  const groupKey = `${prefix}_group`,
    dictType = `${prefix}.choices`;
  const users: number[] = [],
    roles: number[] = [],
    resorts: number[] = [];
  const password = randomUUID();
  const cases = [
    {
      type: 'text',
      value: '双板',
      invalid: 'too-long-value',
      validation: { maxLength: 8 },
    },
    {
      type: 'textarea',
      value: '雪况良好',
      invalid: 'x'.repeat(21),
      validation: { maxLength: 20 },
    },
    {
      type: 'integer',
      value: 0,
      invalid: 1.5,
      validation: { min: 0, max: 100 },
    },
    {
      type: 'decimal',
      value: 12.5,
      invalid: 101,
      validation: { min: 0, max: 100 },
    },
    { type: 'boolean', value: false, invalid: 'false' },
    { type: 'date', value: '2026-11-04', invalid: '2026-02-30' },
    { type: 'single_select', value: 'one', invalid: 'unknown' },
    { type: 'multi_select', value: ['one', 'two'], invalid: ['one', 'one'] },
    {
      type: 'url',
      value: 'https://example.com/ski',
      invalid: 'javascript:alert(1)',
    },
  ];
  const key = (type: string) => `${prefix}_${type}`;
  const values = Object.fromEntries(cases.map((c) => [key(c.type), c.value]));
  const fields = new Map<string, { id: number; version: number }>();
  let initialEventIds: string[] = [];
  type Actor = { id: number; token: string };
  let app: INestApplication<App>, http: App, prisma: PrismaService;
  let admin: Actor,
    merchant: Actor,
    baseline: Awaited<ReturnType<typeof counts>>;
  const readGrants = [
    'management:portal:enter',
    'account:profile:read',
    'resort:merchant:list',
  ];
  const writeGrants = [
    'management:portal:enter',
    'resort:merchant:create',
    'resort:merchant:update',
    'resort:merchant:submit-review',
    'system:field:create',
    'system:field:update',
  ];
  let permissions: {
    permissionId: number;
    permissionKey: string;
    children: unknown[];
  }[];

  async function counts() {
    return {
      users: await prisma.user.count(),
      roles: await prisma.role.count(),
      grants: await prisma.rolePermission.count(),
      policies: await prisma.roleFieldPermission.count(),
      scopes: await prisma.roleDataScope.count(),
      merchants: await prisma.merchantProfile.count(),
      fields: await prisma.customFieldDefinition.count(),
      groups: await prisma.customFieldGroup.count(),
      types: await prisma.dictionaryType.count(),
      items: await prisma.dictionaryItem.count(),
      resorts: await prisma.skiResort.count(),
      logs: await prisma.operationLog.count(),
      events: await prisma.outboxEvent.count(),
    };
  }
  function send(
    actor: Actor,
    method: 'get' | 'post' | 'patch' | 'put' | 'delete',
    path: string,
    body?: object,
  ) {
    const call = request(http)
      [method](`/api/v1${path}`)
      .auth(actor.token, { type: 'bearer' });
    return body ? call.send(body) : call;
  }
  async function account() {
    const account = `${prefix}_${users.length}`;
    const created = await request(http)
      .post('/api/v1/auth/register')
      .send({ account, password, nickname: prefix })
      .expect(201);
    const id = created.body.data.userId as number;
    users.push(id);
    const login = await request(http)
      .post('/api/v1/auth/login')
      .send({ account, password })
      .expect(200);
    return { id, token: login.body.data.accessToken as string };
  }
  async function configure(
    roleId: number,
    grants: string[],
    read: boolean,
    write: boolean,
  ) {
    const permissionIds = grants.map((k) => {
      const p = permissions.find((p) => p.permissionKey === k);
      expect(p, k).toBeDefined();
      return p!.permissionId;
    });
    return send(admin, 'put', `/admin/roles/${roleId}/permissions`, {
      permissionIds,
      dataScopes: [{ resourceKey: 'resort', scopeType: 'merchant' }],
      fieldPolicies: cases.map((c) => ({
        entityType: 'ski_resort',
        fieldKey: key(c.type),
        canRead: read,
        canWrite: write,
      })),
    }).expect(200);
  }
  async function createResort() {
    const response = await send(merchant, 'post', '/merchant/resorts', {
      name: `${prefix}_${resorts.length}`,
      price: 100,
      openStatus: 'open',
      snowCondition: 'powder',
      description: 'Synthetic configured field workflow',
      customFields: values,
    }).expect(201);
    const id = response.body.data.resortId as number;
    resorts.push(id);
    expect(response.body.data.customFields).toEqual(values);
    return id;
  }
  async function snapshot(id: number) {
    return {
      row: await prisma.skiResort.findUniqueOrThrow({
        where: { ResortId: id },
      }),
      logs: await prisma.operationLog.count(),
      events: await prisma.outboxEvent.count(),
    };
  }
  async function fieldSchema() {
    const response = await send(
      merchant,
      'get',
      '/merchant/resorts/custom-fields',
    ).expect(200);
    return (
      response.body.data.groups as {
        fields: { fieldKey: string; canRead: boolean; canWrite: boolean }[];
      }[]
    )
      .flatMap((g) => g.fields)
      .filter((f) => f.fieldKey.startsWith(prefix));
  }
  beforeAll(async () => {
    if (!process.env.DATABASE_URL)
      throw new Error('Dedicated migrated database required');
    vi.stubEnv(
      'JWT_ACCESS_SECRET',
      'configured-fields-http-secret-at-least-32-characters',
    );
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        IdentityAccessModule,
        PlatformAdministrationModule,
        ResortManagementModule,
      ],
    }).compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.init();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);
    baseline = await counts();
    initialEventIds = (
      await prisma.outboxEvent.findMany({ select: { EventId: true } })
    ).map((e) => e.EventId);
    admin = await account();
    merchant = await account();
    const adminRole = await prisma.role.findUniqueOrThrow({
      where: { SystemRoleCode: 'system_admin' },
    });
    await prisma.userRole.deleteMany({ where: { UserId: admin.id } });
    await prisma.userRole.create({
      data: { UserId: admin.id, RoleId: adminRole.RoleId },
    });
    await prisma.merchantProfile.create({
      data: { UserId: merchant.id, BusinessName: prefix },
    });
    const tree = await send(admin, 'get', '/admin/permissions/tree').expect(
      200,
    );
    const flatten = (nodes: typeof permissions): typeof permissions =>
      nodes.flatMap((n) => [n, ...flatten(n.children as typeof permissions)]);
    permissions = flatten(tree.body.data);
    await send(admin, 'post', '/admin/dictionaries', {
      dictType,
      dictName: prefix,
      groupKey: prefix,
    }).expect(201);
    const root = await send(
      admin,
      'post',
      `/admin/dictionaries/${dictType}/items`,
      { value: 'one', label: 'One' },
    ).expect(201);
    await send(admin, 'post', `/admin/dictionaries/${dictType}/items`, {
      value: 'two',
      label: 'Two',
      parentId: root.body.data.itemId,
    }).expect(201);
    await send(admin, 'post', '/admin/custom-field-groups', {
      entityType: 'ski_resort',
      groupKey,
      label: prefix,
    }).expect(201);
    for (const c of cases) {
      const created = await send(admin, 'post', '/admin/custom-fields', {
        entityType: 'ski_resort',
        fieldKey: key(c.type),
        label: c.type,
        dataType: c.type,
        groupKey,
        defaultValue: c.value,
        ...(c.validation ? { validation: c.validation } : {}),
        ...(c.type.endsWith('select') ? { optionsDictType: dictType } : {}),
      }).expect(201);
      expect(created.body.data).toMatchObject({
        status: 'draft',
        isPublic: false,
        defaultValue: c.value,
      });
      const id = created.body.data.fieldDefinitionId as number;
      const active = await send(
        admin,
        'patch',
        `/admin/custom-fields/${id}/activate`,
        { expectedSchemaVersion: 1 },
      ).expect(200);
      expect(active.body.data).toMatchObject({
        status: 'active',
        schemaVersion: 2,
      });
      fields.set(c.type, { id, version: 2 });
    }
    const privateField = await send(admin, 'post', '/admin/custom-fields', {
      entityType: 'ski_resort',
      fieldKey: `${prefix}_private`,
      label: 'Private',
      dataType: 'text',
      groupKey,
    }).expect(201);
    await send(
      admin,
      'patch',
      `/admin/custom-fields/${privateField.body.data.fieldDefinitionId}/activate`,
      { expectedSchemaVersion: 1 },
    ).expect(200);
    for (const suffix of ['reader', 'writer']) {
      const role = await send(admin, 'post', '/admin/roles', {
        roleKey: `${prefix}_${suffix}`,
        roleName: suffix,
        dataScope: 'merchant',
      }).expect(201);
      roles.push(role.body.data.roleId as number);
    }
    await configure(roles[0], readGrants, true, false);
    await configure(roles[1], writeGrants, false, true);
    await send(admin, 'put', `/admin/users/${merchant.id}/roles`, {
      roleIds: roles,
    }).expect(200);
  }, 30_000);
  afterAll(async () => {
    try {
      if (prisma && baseline) {
        const items = await prisma.dictionaryItem.findMany({
          where: { DictType: dictType },
          select: { ItemId: true },
        });
        await prisma.outboxEvent.deleteMany({
          where: {
            OR: [
              {
                EventId: { notIn: initialEventIds },
                EventType: 'rag.dependencies.changed.v1',
                AggregateType: 'CustomFieldSchema',
                AggregateId: 'ski_resort',
              },
              { AggregateType: 'DictionaryType', AggregateId: dictType },
              {
                AggregateType: 'ski_resort',
                AggregateId: { in: resorts.map(String) },
              },
              {
                AggregateType: 'DictionaryItem',
                AggregateId: {
                  in: items.map((i) => `${dictType}:${i.ItemId}`),
                },
              },
            ],
          },
        });
        await prisma.operationLog.deleteMany({
          where: { ActorUserId: { in: users } },
        });
        await prisma.skiResort.deleteMany({
          where: { ResortId: { in: resorts } },
        });
        await prisma.roleFieldPermission.deleteMany({
          where: { RoleId: { in: roles } },
        });
        await prisma.customFieldDefinition.deleteMany({
          where: { GroupKey: groupKey },
        });
        await prisma.customFieldGroup.deleteMany({
          where: { GroupKey: groupKey },
        });
        await prisma.dictionaryItem.updateMany({
          where: { DictType: dictType },
          data: { ParentId: null },
        });
        await prisma.dictionaryItem.deleteMany({
          where: { DictType: dictType },
        });
        await prisma.dictionaryType.deleteMany({
          where: { DictType: dictType },
        });
        await prisma.merchantProfile.deleteMany({
          where: { UserId: { in: users } },
        });
        await prisma.user.deleteMany({ where: { UserId: { in: users } } });
        await prisma.role.deleteMany({ where: { RoleId: { in: roles } } });
        expect(await counts()).toEqual(baseline);
      }
    } finally {
      await app?.close();
      vi.unstubAllEnvs();
    }
  });

  it('combines independent read/write role policies in the live field schema', async () => {
    const schema = await fieldSchema();
    expect(schema).toHaveLength(9);
    for (const c of cases)
      expect(schema.find((f) => f.fieldKey === key(c.type))).toMatchObject({
        canRead: true,
        canWrite: true,
      });
  });
  it.each(cases)(
    'persists $type with eight companion types and rejects invalid values atomically',
    async (c) => {
      const id = await createResort();
      expect((await snapshot(id)).row.CustomFields).toEqual(values);
      const before = await snapshot(id);
      await send(merchant, 'patch', `/merchant/resorts/${id}`, {
        customFields: { [key(c.type)]: c.invalid },
      }).expect(422);
      expect(await snapshot(id)).toEqual(before);
      const cleared = await send(merchant, 'patch', `/merchant/resorts/${id}`, {
        customFields: { [key(c.type)]: null },
      }).expect(200);
      expect(cleared.body.data.customFields).toEqual({
        ...values,
        [key(c.type)]: null,
      });
      expect((await snapshot(id)).row.CustomFields).toEqual(
        cleared.body.data.customFields,
      );
    },
  );
  it('rejects unknown write keys and nonadministrator public exposure without persisted effects', async () => {
    const id = await createResort(),
      before = await snapshot(id);
    await send(merchant, 'patch', `/merchant/resorts/${id}`, {
      customFields: { [`${prefix}_unknown`]: 'secret' },
    }).expect(422);
    await send(merchant, 'patch', `/merchant/resorts/${id}`, {
      customFields: { [`${prefix}_private`]: 'secret' },
    }).expect(422);
    const field = fields.get('text')!;
    await send(merchant, 'patch', `/admin/custom-fields/${field.id}`, {
      expectedSchemaVersion: field.version,
      isPublic: true,
    }).expect(403);
    await send(merchant, 'post', '/admin/custom-fields', {
      entityType: 'ski_resort',
      fieldKey: `${prefix}_expose`,
      label: 'Expose',
      dataType: 'text',
      groupKey,
      isPublic: true,
    }).expect(403);
    expect(await snapshot(id)).toEqual(before);
    expect(
      await prisma.customFieldDefinition.count({
        where: { FieldKey: `${prefix}_expose` },
      }),
    ).toBe(0);
  });
  it('applies replacement role policies immediately to an existing token while preserving stored values', async () => {
    const id = await createResort();
    try {
      await configure(roles[1], writeGrants, false, false);
      expect((await fieldSchema()).every((f) => f.canRead && !f.canWrite)).toBe(
        true,
      );
      const before = await snapshot(id);
      await send(merchant, 'patch', `/merchant/resorts/${id}`, {
        customFields: { [key('text')]: '越权修改' },
      }).expect(422);
      expect(await snapshot(id)).toEqual(before);
      await configure(roles[1], writeGrants, false, true);
      await configure(roles[0], readGrants, false, false);
      const schema = await fieldSchema();
      expect(schema).toHaveLength(9);
      expect(schema.every((f) => !f.canRead && f.canWrite)).toBe(true);
      const response = await send(
        merchant,
        'patch',
        `/merchant/resorts/${id}`,
        { customFields: { [key('text')]: '更新' } },
      ).expect(200);
      expect(response.body.data.customFields).toEqual({});
      expect((await snapshot(id)).row.CustomFields).toEqual({
        ...values,
        [key('text')]: '更新',
      });
    } finally {
      await configure(roles[0], readGrants, true, false);
      await configure(roles[1], writeGrants, false, true);
    }
  });
  it('publishes only explicitly public fields and removes them immediately after metadata retraction', async () => {
    const id = await createResort();
    await send(
      merchant,
      'patch',
      `/merchant/resorts/${id}/submit-review`,
    ).expect(200);
    await send(admin, 'patch', `/admin/resorts/${id}/publish`).expect(200);
    const get = () => request(http).get(`/api/v1/resorts/${id}`).expect(200);
    expect((await get()).body.data.customFields).toEqual([]);
    const field = fields.get('text')!;
    const changed = await send(
      admin,
      'patch',
      `/admin/custom-fields/${field.id}`,
      { expectedSchemaVersion: field.version, isPublic: true },
    ).expect(200);
    field.version = changed.body.data.schemaVersion as number;
    expect((await get()).body.data.customFields).toEqual([
      { fieldKey: key('text'), label: 'text', value: '双板' },
    ]);
    const hidden = await send(
      admin,
      'patch',
      `/admin/custom-fields/${field.id}`,
      { expectedSchemaVersion: field.version, isPublic: false },
    ).expect(200);
    field.version = hidden.body.data.schemaVersion as number;
    expect((await get()).body.data.customFields).toEqual([]);
    expect((await snapshot(id)).row.CustomFields).toEqual(values);
  });
});
