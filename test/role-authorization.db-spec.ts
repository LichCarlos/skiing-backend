import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { IdentityAccessModule } from '../src/modules/identity-access/identity-access.module.js';
import { PlatformAdministrationModule } from '../src/modules/platform-administration/platform-administration.module.js';
import { BcryptPasswordHasher } from '../src/modules/identity-access/infrastructure/bcrypt-password-hasher.js';
import { AUTHORIZATION_RESOURCES } from '../src/modules/identity-access/domain/authorization-resources.js';
import { PrismaRoleAuthorizationRepository } from '../src/modules/platform-administration/infrastructure/prisma-role-authorization.repository.js';
import { PrismaManagedRoleRepository } from '../src/modules/platform-administration/infrastructure/prisma-managed-role.repository.js';
import { PrismaService } from '../src/shared/persistence/prisma.service.js';
import { configureHttp } from '../src/shared/http/configure-http.js';

describe('Role management and resource catalog HTTP / real PostgreSQL', () => {
  const prefix = `rauth_${randomUUID().slice(0, 8)}`;
  const users: number[] = [],
    roles: number[] = [];
  let sequence = 0;
  let app: INestApplication<App>, http: App, prisma: PrismaService;
  let authorizations: PrismaRoleAuthorizationRepository;
  let roleRepository: PrismaManagedRoleRepository;
  let administrator: { id: number; account: string; token: string };
  let delegated: typeof administrator, member: typeof administrator;
  let permissionId: number;
  const url = '/api/v1/admin/roles';
  const resourcesUrl = '/api/v1/admin/authorization/resources';
  const field = {
    entityType: 'ski_resort',
    fieldKey: prefix,
    canRead: true,
    canWrite: false,
  };
  const empty = () => ({
    permissionIds: [] as number[],
    dataScopes: [],
    fieldPolicies: [],
  });
  const audit = (traceId = 'role-authorization-test') => ({
    actorUserId: administrator.id,
    traceId,
    clientIp: null,
    userAgent: null,
  });

  beforeAll(async () => {
    if (!process.env.DATABASE_URL)
      throw new Error('Dedicated migrated DATABASE_URL required');
    vi.stubEnv(
      'JWT_ACCESS_SECRET',
      'role-authorization-validation-secret-at-least-32-chars',
    );
    const module = await Test.createTestingModule({
      imports: [IdentityAccessModule, PlatformAdministrationModule],
    }).compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.init();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);
    authorizations = new PrismaRoleAuthorizationRepository(prisma);
    roleRepository = new PrismaManagedRoleRepository(prisma);
    const adminRole = await prisma.role.findUniqueOrThrow({
      where: { SystemRoleCode: 'system_admin' },
    });
    const userRole = await prisma.role.findUniqueOrThrow({
      where: { SystemRoleCode: 'registered_user' },
    });
    const grants = await prisma.permission.findMany({
      where: {
        PermissionKey: {
          in: [
            'management:portal:enter',
            'system:role:list',
            'system:role:create',
            'system:role:update',
            'system:role:delete',
            'system:permission:assign',
          ],
        },
      },
    });
    expect(grants).toHaveLength(6);
    permissionId = grants.find(
      (item) => item.PermissionKey === 'system:role:list',
    )!.PermissionId;
    const delegatedRole = await prisma.role.create({
      data: {
        RoleKey: prefix + '_delegated',
        RoleName: 'Delegated role manager',
        DataScope: 'all',
        RolePermissions: {
          create: grants.map(({ PermissionId }) => ({ PermissionId })),
        },
      },
    });
    roles.push(delegatedRole.RoleId);
    administrator = await account(adminRole.RoleId);
    delegated = await account(delegatedRole.RoleId);
    member = await account(userRole.RoleId);
    await prisma.customFieldGroup.create({
      data: {
        EntityType: field.entityType,
        GroupKey: prefix,
        Label: 'Role policy group',
      },
    });
    await prisma.customFieldDefinition.create({
      data: {
        EntityType: field.entityType,
        GroupKey: prefix,
        FieldKey: field.fieldKey,
        Label: 'Role policy field',
        DataType: 'text',
        Status: 'active',
      },
    });
  });

  afterAll(async () => {
    try {
      if (prisma) {
        await prisma.operationLog.deleteMany({
          where: { ActorUserId: { in: users } },
        });
        await prisma.user.deleteMany({ where: { UserId: { in: users } } });
        const owned = await prisma.role.findMany({
          where: { RoleKey: { startsWith: prefix } },
          select: { RoleId: true },
        });
        await prisma.role.deleteMany({
          where: {
            RoleId: { in: [...roles, ...owned.map((item) => item.RoleId)] },
          },
        });
        await prisma.customFieldDefinition.deleteMany({
          where: { GroupKey: prefix },
        });
        await prisma.customFieldGroup.deleteMany({
          where: { GroupKey: prefix },
        });
      }
    } finally {
      await app?.close();
      vi.unstubAllEnvs();
    }
  });

  async function account(roleId: number) {
    const password = 'role-authorization-validation-password';
    const user = await prisma.user.create({
      data: {
        Account: `${prefix}_${users.length}`,
        Nickname: 'Role validator',
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
  async function role() {
    const response = await request(http)
      .post(url)
      .auth(administrator.token, { type: 'bearer' })
      .send({
        roleKey: `${prefix}_${sequence++}`,
        roleName: ' New role ',
        description: ' Description ',
        dataScope: 'self',
      })
      .expect(201);
    roles.push(response.body.data.roleId);
    return response.body.data.roleId as number;
  }
  function put(roleId: number, body: object, token = administrator.token) {
    return request(http)
      .put(`${url}/${roleId}/permissions`)
      .auth(token, { type: 'bearer' })
      .send(body);
  }
  async function logCount() {
    return prisma.operationLog.count({ where: { ActorUserId: { in: users } } });
  }
  async function legacy(roleId: number) {
    await prisma.roleDataScope.create({
      data: {
        RoleId: roleId,
        ResourceKey: 'legacy.resource',
        ScopeType: 'selected',
        ScopeConfig: { selectedIds: [9, 4] },
      },
    });
  }

  it('returns exactly the registered resource metadata behind current grants and management entry', async () => {
    await request(http).get(resourcesUrl).expect(401);
    await request(http)
      .get(resourcesUrl)
      .auth(member.token, { type: 'bearer' })
      .expect(403);
    await request(http)
      .get(resourcesUrl)
      .auth(delegated.token, { type: 'bearer' })
      .expect(200)
      .expect(({ body }) => expect(body.data).toEqual(AUTHORIZATION_RESOURCES));
    for (const PermissionKey of [
      'management:portal:enter',
      'system:role:list',
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
          .get(resourcesUrl)
          .auth(delegated.token, { type: 'bearer' })
          .expect(403);
      } finally {
        await prisma.rolePermission.create({ data });
      }
    }
  });

  it('atomically adds known resource scopes with permission and field grants, then fully replaces all three sets', async () => {
    const id = await role();
    const body = {
      permissionIds: [permissionId],
      dataScopes: [
        { resourceKey: 'role', scopeType: 'selected', selectedIds: [id, 2] },
        { resourceKey: 'article', scopeType: 'self' },
      ],
      fieldPolicies: [field],
    };
    const response = await put(id, body).expect(200);
    expect(response.body.data).toMatchObject({
      roleId: id,
      permissionIds: [permissionId],
      fieldPolicies: [field],
    });
    const log = await prisma.operationLog.findUniqueOrThrow({
      where: {
        OperationLogId: (
          await prisma.operationLog.findFirstOrThrow({
            where: { TraceId: response.body.traceId },
          })
        ).OperationLogId,
      },
    });
    expect(log).toMatchObject({
      ActorUserId: administrator.id,
      ActorAccountSnapshot: administrator.account,
      ActionKey: 'system:permission:assign',
      TargetId: String(id),
    });
    const detail = await request(http)
      .get(`${url}/${id}`)
      .auth(administrator.token, { type: 'bearer' })
      .expect(200);
    expect(detail.body.data).toMatchObject({
      permissionCount: 1,
      fieldPolicyCount: 1,
    });
    await put(id, empty()).expect(200);
    expect(await authorizations.findSnapshot(id)).toMatchObject(empty());
  });

  it.each(['unknown', 'legacy.renamed'])(
    'rejects a new unknown resource %s without changing any grants or audit',
    async (resourceKey) => {
      const id = await role();
      await legacy(id);
      const before = await authorizations.findSnapshot(id),
        count = await logCount();
      await put(id, {
        permissionIds: [permissionId],
        dataScopes: [{ resourceKey, scopeType: 'all' }],
        fieldPolicies: [field],
      }).expect(400);
      expect(await authorizations.findSnapshot(id)).toEqual(before);
      expect(await logCount()).toBe(count);
    },
  );

  it('allows historical unknown scopes to be retained unchanged with reordered IDs or removed while adding known scopes', async () => {
    const id = await role();
    await legacy(id);
    await put(id, {
      ...empty(),
      dataScopes: [
        {
          resourceKey: 'legacy.resource',
          scopeType: 'selected',
          selectedIds: [4, 9],
        },
        { resourceKey: 'asset', scopeType: 'self' },
      ],
    }).expect(200);
    const retained = await authorizations.findSnapshot(id);
    expect(retained?.dataScopes).toContainEqual({
      resourceKey: 'legacy.resource',
      scopeType: 'selected',
      selectedIds: [4, 9],
    });
    await put(id, {
      ...empty(),
      dataScopes: [{ resourceKey: 'resort', scopeType: 'merchant' }],
    }).expect(200);
    expect((await authorizations.findSnapshot(id))?.dataScopes).toEqual([
      { resourceKey: 'resort', scopeType: 'merchant' },
    ]);
    // Removing a legacy key does not allow it to be recreated on a subsequent request.
    await put(id, {
      ...empty(),
      dataScopes: [
        {
          resourceKey: 'legacy.resource',
          scopeType: 'selected',
          selectedIds: [4, 9],
        },
      ],
    }).expect(400);
  });

  it.each([
    { scopeType: 'all' },
    { scopeType: 'selected', selectedIds: [4, 9, 10] },
    { scopeType: 'selected', selectedIds: [4] },
  ])('refuses modification of historical unknown scope: %j', async (patch) => {
    const id = await role();
    await legacy(id);
    const before = await authorizations.findSnapshot(id),
      count = await logCount();
    await put(id, {
      ...empty(),
      dataScopes: [{ resourceKey: 'legacy.resource', ...patch }],
    }).expect(400);
    expect(await authorizations.findSnapshot(id)).toEqual(before);
    expect(await logCount()).toBe(count);
  });

  it('keeps only system_admin able to assign grants even when a delegated role has every action permission', async () => {
    const id = await role();
    await put(id, empty(), delegated.token).expect(403);
    const adminRole = await prisma.role.findUniqueOrThrow({
      where: { SystemRoleCode: 'system_admin' },
    });
    await put(adminRole.RoleId, empty()).expect(403);
    await request(http)
      .get(`${url}/${id}/permissions`)
      .auth(delegated.token, { type: 'bearer' })
      .expect(200);
  });

  it('uses the same selected-role scope for lists, details, edits and snapshot reads', async () => {
    const visible = await role(),
      hidden = await role();
    await prisma.roleDataScope.create({
      data: {
        RoleId: roles[0],
        ResourceKey: 'role',
        ScopeType: 'selected',
        ScopeConfig: { selectedIds: [visible] },
      },
    });
    try {
      const list = await request(http)
        .get(url)
        .auth(delegated.token, { type: 'bearer' })
        .expect(200);
      expect(list.body.data.total).toBe(1);
      expect(
        list.body.data.items.map((item: { roleId: number }) => item.roleId),
      ).toEqual([visible]);
      for (const suffix of ['', '/permissions']) {
        await request(http)
          .get(`${url}/${visible}${suffix}`)
          .auth(delegated.token, { type: 'bearer' })
          .expect(200);
        await request(http)
          .get(`${url}/${hidden}${suffix}`)
          .auth(delegated.token, { type: 'bearer' })
          .expect(403);
      }
      await request(http)
        .patch(`${url}/${hidden}`)
        .auth(delegated.token, { type: 'bearer' })
        .send({ roleName: 'No access' })
        .expect(403);
      await request(http)
        .post(url)
        .auth(delegated.token, { type: 'bearer' })
        .send({
          roleKey: prefix + '_forbidden',
          roleName: 'No create',
          dataScope: 'self',
        })
        .expect(403);
    } finally {
      await prisma.roleDataScope.deleteMany({ where: { RoleId: roles[0] } });
    }
  });

  it('rejects malformed or missing references without deleting old authorization sets', async () => {
    const id = await role();
    await put(id, {
      ...empty(),
      permissionIds: [permissionId],
      fieldPolicies: [field],
    }).expect(200);
    const before = await authorizations.findSnapshot(id),
      count = await logCount();
    for (const body of [
      { ...empty(), permissionIds: [2147483647] },
      { ...empty(), fieldPolicies: [{ ...field, fieldKey: 'missing' }] },
      {
        ...empty(),
        dataScopes: [
          { resourceKey: 'role', scopeType: 'all' },
          { resourceKey: 'role', scopeType: 'self' },
        ],
      },
      {
        ...empty(),
        dataScopes: [
          { resourceKey: 'role', scopeType: 'selected', selectedIds: [1, 1] },
        ],
      },
    ])
      await put(id, body).expect(400);
    expect(await authorizations.findSnapshot(id)).toEqual(before);
    expect(await logCount()).toBe(count);
  });

  it('rolls back permissions, scopes, fields and audit after an actual audit INSERT failure', async () => {
    const id = await role();
    await legacy(id);
    await put(id, {
      ...empty(),
      permissionIds: [permissionId],
      dataScopes: [
        {
          resourceKey: 'legacy.resource',
          scopeType: 'selected',
          selectedIds: [4, 9],
        },
      ],
      fieldPolicies: [field],
    }).expect(200);
    const before = await authorizations.findSnapshot(id),
      count = await logCount();
    await expect(
      authorizations.replaceAuthorization({
        roleId: id,
        authorization: {
          ...empty(),
          dataScopes: [{ resourceKey: 'asset', scopeType: 'all' }],
        },
        audit: audit('x'.repeat(101)),
      }),
    ).rejects.toMatchObject({ code: 'P2000' });
    expect(await authorizations.findSnapshot(id)).toEqual(before);
    expect(await logCount()).toBe(count);
  });

  it('normalizes role metadata, preserves omitted fields, and handles disable/restore', async () => {
    const id = await role();
    const changed = await request(http)
      .patch(`${url}/${id}`)
      .auth(delegated.token, { type: 'bearer' })
      .send({ roleName: ' Changed ' })
      .expect(200);
    expect(changed.body.data).toMatchObject({
      roleName: 'Changed',
      description: 'Description',
      dataScope: 'self',
    });
    await request(http)
      .patch(`${url}/${id}`)
      .auth(administrator.token, { type: 'bearer' })
      .send({ description: null })
      .expect(200);
    await request(http)
      .delete(`${url}/${id}`)
      .auth(delegated.token, { type: 'bearer' })
      .expect(204);
    await request(http)
      .patch(`${url}/${id}`)
      .auth(delegated.token, { type: 'bearer' })
      .send({ status: 'active' })
      .expect(200);
    await request(http)
      .patch(`${url}/${id}`)
      .auth(delegated.token, { type: 'bearer' })
      .send({ dataScope: 'self' })
      .expect(403);
  });

  it.each(['roleKey', 'roleName', 'dataScope', 'status'])(
    'rejects explicit null for nonnullable role %s',
    async (key) => {
      const id = await role();
      await request(http)
        .patch(`${url}/${id}`)
        .auth(administrator.token, { type: 'bearer' })
        .send({ [key]: null })
        .expect(400);
    },
  );

  it('rejects an empty PATCH without a spurious successful audit', async () => {
    const id = await role(),
      count = await logCount();
    await request(http)
      .patch(`${url}/${id}`)
      .auth(administrator.token, { type: 'bearer' })
      .send({})
      .expect(400);
    expect(await logCount()).toBe(count);
  });

  it.each(['create', 'update', 'disable'] as const)(
    'rolls back role %s when audit insertion fails',
    async (kind) => {
      const id = await role(),
        count = await logCount();
      const before = await prisma.role.findMany({ orderBy: { RoleId: 'asc' } });
      const broken = audit('x'.repeat(101));
      const operation =
        kind === 'create'
          ? roleRepository.create({
              role: {
                roleKey: `${prefix}_rollback`,
                roleName: 'Rollback',
                description: null,
                dataScope: 'self',
              },
              audit: broken,
            })
          : kind === 'update'
            ? roleRepository.update({
                roleId: id,
                patch: { roleName: 'Rollback' },
                audit: broken,
              })
            : roleRepository.disable({ roleId: id, audit: broken });
      await expect(operation).rejects.toMatchObject({ code: 'P2000' });
      expect(
        await prisma.role.findMany({ orderBy: { RoleId: 'asc' } }),
      ).toEqual(before);
      expect(await logCount()).toBe(count);
    },
  );
});
