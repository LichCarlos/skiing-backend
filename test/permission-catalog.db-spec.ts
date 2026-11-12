import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { IdentityAccessModule } from '../src/modules/identity-access/identity-access.module.js';
import { BcryptPasswordHasher } from '../src/modules/identity-access/infrastructure/bcrypt-password-hasher.js';
import { PrismaPermissionCatalogRepository } from '../src/modules/identity-access/infrastructure/prisma-permission-catalog.repository.js';
import { registeredApiPermissions } from '../src/modules/identity-access/domain/permission-catalog.js';
import { PrismaService } from '../src/shared/persistence/prisma.service.js';
import { configureHttp } from '../src/shared/http/configure-http.js';

describe('Permission catalog HTTP / real PostgreSQL authorization and atomic writes', () => {
  const prefix = `custom:validation.${randomUUID().slice(0, 8)}`;
  const users: number[] = [];
  const roles: number[] = [];
  const nodes: number[] = [];
  const url = '/api/v1/admin/permissions';
  let sequence = 0;
  let app: INestApplication<App>;
  let http: App;
  let prisma: PrismaService;
  let repository: PrismaPermissionCatalogRepository;
  let administrator: { id: number; account: string; token: string };
  let delegated: typeof administrator;
  let member: typeof administrator;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL)
      throw new Error('Dedicated migrated DATABASE_URL required');
    vi.stubEnv(
      'JWT_ACCESS_SECRET',
      'permission-http-validation-secret-at-least-32-chars',
    );
    const module = await Test.createTestingModule({
      imports: [IdentityAccessModule],
    }).compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.init();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);
    repository = new PrismaPermissionCatalogRepository(prisma);
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
            'system:permission:list',
            'system:permission:create',
            'system:permission:update',
            'system:permission:delete',
            'system:role:list',
            'system:permission:assign',
          ],
        },
      },
    });
    expect(grants).toHaveLength(7);
    const role = await prisma.role.create({
      data: {
        RoleKey: prefix,
        RoleName: 'Permission manager',
        DataScope: 'all',
        RolePermissions: {
          create: grants.map(({ PermissionId }) => ({ PermissionId })),
        },
      },
    });
    roles.push(role.RoleId);
    administrator = await account(adminRole.RoleId);
    delegated = await account(role.RoleId);
    member = await account(userRole.RoleId);
  });

  afterAll(async () => {
    try {
      if (prisma) {
        const owned = await prisma.permission.findMany({
          where: { PermissionKey: { startsWith: prefix } },
          select: { PermissionId: true },
        });
        const ownedIds = [
          ...new Set([...nodes, ...owned.map((row) => row.PermissionId)]),
        ];
        await prisma.rolePermission.deleteMany({
          where: { RoleId: { in: roles } },
        });
        await prisma.permission.updateMany({
          where: { PermissionId: { in: ownedIds } },
          data: { ParentId: null },
        });
        await prisma.permission.deleteMany({
          where: { PermissionId: { in: ownedIds } },
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

  async function account(roleId: number) {
    const password = 'permission-validation-password';
    const user = await prisma.user.create({
      data: {
        Account: `permission_${prefix.slice(-8)}_${users.length}`,
        Nickname: 'Permission validator',
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
  function audit(traceId = 'permission-fixture-trace') {
    return {
      actorUserId: administrator.id,
      traceId,
      clientIp: null,
      userAgent: null,
    };
  }
  function input(permissionType = 'directory', parentId: number | null = null) {
    return {
      permissionKey: `${prefix}.${sequence++}`,
      permissionName: ' Validation ',
      permissionType,
      parentId,
    };
  }
  async function create(
    permissionType = 'directory',
    parentId: number | null = null,
    patch: Record<string, unknown> = {},
  ) {
    const response = await request(http)
      .post(url)
      .auth(administrator.token, { type: 'bearer' })
      .send({ ...input(permissionType, parentId), ...patch })
      .expect(201);
    const node = response.body.data as {
      permissionId: number;
      permissionKey: string;
    };
    nodes.push(node.permissionId);
    return {
      permissionId: node.permissionId,
      permissionKey: node.permissionKey,
    };
  }
  async function logs() {
    return prisma.operationLog.count({ where: { ActorUserId: { in: users } } });
  }
  async function expectAudit(traceId: string, action: string) {
    const rows = await prisma.operationLog.findMany({
      where: { TraceId: traceId },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      ActorUserId: administrator.id,
      ActorAccountSnapshot: administrator.account,
      ActionKey: action,
      ResourceKey: 'system:permission',
      Result: 'success',
    });
    return rows[0];
  }

  it('returns sorted directory/menu/button subtrees and keeps the static grant tree reachable', async () => {
    const root = await create();
    const second = await create('menu', root.permissionId, {
      sortOrder: 3,
      route: '/validation',
    });
    const first = await create('menu', root.permissionId, { sortOrder: 1 });
    const leaf = await create('button', first.permissionId);
    const response = await request(http)
      .get(`${url}/${root.permissionId}`)
      .auth(administrator.token, { type: 'bearer' })
      .expect(200);
    expect(response.body.data).toMatchObject({
      ...root,
      parentId: null,
      permissionName: 'Validation',
      source: 'custom',
      status: 'active',
    });
    expect(
      response.body.data.children.map(
        (node: { permissionId: number }) => node.permissionId,
      ),
    ).toEqual([first.permissionId, second.permissionId]);
    expect(response.body.data.children[0].children[0].permissionId).toBe(
      leaf.permissionId,
    );
    const tree = await request(http)
      .get(`${url}/tree`)
      .auth(administrator.token, { type: 'bearer' })
      .expect(200);
    expect(Array.isArray(tree.body.data)).toBe(true);
    const catalog = await request(http)
      .get(url)
      .auth(administrator.token, { type: 'bearer' })
      .expect(200);
    expect(
      catalog.body.data.find(
        (node: { permissionId: number }) =>
          node.permissionId === root.permissionId,
      ),
    ).toEqual(response.body.data);
  });

  it('returns 404 for a missing node and 400 for invalid IDs', async () => {
    for (const id of ['0', '-1', 'invalid', '9007199254740992'])
      await request(http)
        .get(`${url}/${id}`)
        .auth(administrator.token, { type: 'bearer' })
        .expect(400);
    await request(http)
      .get(`${url}/2147483647`)
      .auth(administrator.token, { type: 'bearer' })
      .expect(404);
  });

  it('checks current list/action/entry grants even for an old JWT; only system_admin may sync', async () => {
    const node = await create();
    for (const suffix of ['', `/${node.permissionId}`]) {
      await request(http)
        .get(url + suffix)
        .expect(401);
      await request(http)
        .get(url + suffix)
        .auth(member.token, { type: 'bearer' })
        .expect(403);
      await request(http)
        .get(url + suffix)
        .auth(delegated.token, { type: 'bearer' })
        .expect(200);
    }
    for (const PermissionKey of [
      'system:permission:list',
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
          .get(`${url}/${node.permissionId}`)
          .auth(delegated.token, { type: 'bearer' })
          .expect(403);
      } finally {
        await prisma.rolePermission.create({ data });
      }
    }
    await request(http)
      .post(`${url}/sync`)
      .auth(delegated.token, { type: 'bearer' })
      .expect(403);
    const permission = await prisma.permission.findUniqueOrThrow({
      where: { PermissionKey: 'system:permission:update' },
    });
    const data = { RoleId: roles[0], PermissionId: permission.PermissionId };
    await prisma.rolePermission.delete({
      where: { RoleId_PermissionId: data },
    });
    try {
      await request(http)
        .patch(`${url}/${node.permissionId}`)
        .auth(delegated.token, { type: 'bearer' })
        .send({ visible: false })
        .expect(403);
    } finally {
      await prisma.rolePermission.create({ data });
    }
  });

  it('refuses forged API capabilities, audit context and immutable key/type/source', async () => {
    const root = await create();
    const count = await logs();
    for (const patch of [
      { permissionKey: 'content:fake' },
      { permissionType: 'api' },
      { source: 'code' },
      { audit: audit() },
    ])
      await request(http)
        .patch(`${url}/${root.permissionId}`)
        .auth(administrator.token, { type: 'bearer' })
        .send(patch)
        .expect(400);
    await request(http)
      .post(url)
      .auth(administrator.token, { type: 'bearer' })
      .send(input('api'))
      .expect(400);
    expect(await logs()).toBe(count);
  });

  it('uses 409 for duplicate keys and concurrent creation, with exactly one successful write/audit', async () => {
    const body = input();
    const before = await logs();
    const responses = await Promise.all(
      [0, 1].map(() =>
        request(http)
          .post(url)
          .auth(administrator.token, { type: 'bearer' })
          .send(body),
      ),
    );
    for (const response of responses)
      if (response.status === 201) nodes.push(response.body.data.permissionId);
    expect(
      responses
        .map((response) => response.status)
        .sort((left, right) => left - right),
    ).toEqual([201, 409]);
    expect(await logs()).toBe(before + 1);
    await request(http)
      .post(url)
      .auth(administrator.token, { type: 'bearer' })
      .send(body)
      .expect(409);
    expect(await logs()).toBe(before + 1);
  });

  it('enforces active directory -> menu -> button hierarchy on creation and updates', async () => {
    const root = await create();
    const menu = await create('menu', root.permissionId);
    const button = await create('button', menu.permissionId);
    for (const [kind, parentId] of [
      ['menu', null],
      ['button', root.permissionId],
      ['directory', root.permissionId],
      ['menu', button.permissionId],
      ['menu', 2147483647],
    ] as const)
      await request(http)
        .post(url)
        .auth(administrator.token, { type: 'bearer' })
        .send(input(kind, parentId))
        .expect(409);
    for (const parentId of [menu.permissionId, button.permissionId, 2147483647])
      await request(http)
        .patch(`${url}/${menu.permissionId}`)
        .auth(administrator.token, { type: 'bearer' })
        .send({ parentId })
        .expect(409);
    const disabled = await create('menu', root.permissionId);
    await request(http)
      .delete(`${url}/${disabled.permissionId}`)
      .auth(administrator.token, { type: 'bearer' })
      .expect(204);
    await request(http)
      .post(url)
      .auth(administrator.token, { type: 'bearer' })
      .send(input('button', disabled.permissionId))
      .expect(409);
  });

  it('updates metadata, clears nullable icon/route, soft-disables and restores with one audit per change', async () => {
    const root = await create();
    const menu = await create('menu', root.permissionId, {
      route: '/validation',
      icon: 'snow',
    });
    const changed = await request(http)
      .patch(`${url}/${menu.permissionId}`)
      .auth(administrator.token, { type: 'bearer' })
      .send({
        permissionName: ' Changed ',
        route: null,
        icon: null,
        visible: false,
        sortOrder: -1,
      })
      .expect(200);
    expect(changed.body.data).toMatchObject({
      permissionName: 'Changed',
      route: null,
      icon: null,
      visible: false,
      sortOrder: -1,
    });
    await expectAudit(changed.body.traceId, 'system:permission:update');
    const disabled = await request(http)
      .delete(`${url}/${menu.permissionId}`)
      .auth(administrator.token, { type: 'bearer' })
      .expect(204);
    await expectAudit(
      disabled.headers['x-trace-id'],
      'system:permission:delete',
    );
    const detail = await request(http)
      .get(`${url}/${menu.permissionId}`)
      .auth(administrator.token, { type: 'bearer' })
      .expect(200);
    expect(detail.body.data.status).toBe('disabled');
    const count = await logs();
    await request(http)
      .delete(`${url}/${menu.permissionId}`)
      .auth(administrator.token, { type: 'bearer' })
      .expect(204);
    expect(await logs()).toBe(count);
    await request(http)
      .patch(`${url}/${menu.permissionId}`)
      .auth(administrator.token, { type: 'bearer' })
      .send({ status: 'active' })
      .expect(200);
  });

  it('preserves omitted fields on partial PATCH and rejects an empty patch', async () => {
    const root = await create();
    const menu = await create('menu', root.permissionId, {
      route: '/keep',
      icon: 'snow',
    });
    const response = await request(http)
      .patch(`${url}/${menu.permissionId}`)
      .auth(administrator.token, { type: 'bearer' })
      .send({ visible: false })
      .expect(200);
    expect(response.body.data).toMatchObject({
      parentId: root.permissionId,
      route: '/keep',
      icon: 'snow',
      status: 'active',
      visible: false,
    });
    await request(http)
      .patch(`${url}/${menu.permissionId}`)
      .auth(administrator.token, { type: 'bearer' })
      .send({})
      .expect(400);
  });

  it('returns 404 on missing updates/deletes and refuses direct registered API edits', async () => {
    await request(http)
      .patch(`${url}/2147483647`)
      .auth(administrator.token, { type: 'bearer' })
      .send({ visible: false })
      .expect(404);
    await request(http)
      .delete(`${url}/2147483647`)
      .auth(administrator.token, { type: 'bearer' })
      .expect(404);
    const api = await prisma.permission.findUniqueOrThrow({
      where: { PermissionKey: 'system:permission:list' },
    });
    await request(http)
      .patch(`${url}/${api.PermissionId}`)
      .auth(administrator.token, { type: 'bearer' })
      .send({ permissionName: 'Fake' })
      .expect(409);
  });

  it('allows an authorized custom role to edit code UI metadata without changing API capabilities', async () => {
    const saved = await prisma.permission.findUniqueOrThrow({
      where: { PermissionKey: 'menu:system:users' },
    });
    try {
      await request(http)
        .patch(`${url}/${saved.PermissionId}`)
        .auth(delegated.token, { type: 'bearer' })
        .send({ permissionName: 'Delegated UI name' })
        .expect(200);
      expect(
        await prisma.permission.findUnique({
          where: { PermissionId: saved.PermissionId },
        }),
      ).toMatchObject({
        PermissionName: 'Delegated UI name',
        PermissionKey: saved.PermissionKey,
        PermissionType: 'menu',
      });
    } finally {
      await prisma.permission.update({
        where: { PermissionId: saved.PermissionId },
        data: { PermissionName: saved.PermissionName },
      });
    }
  });

  it('rejects non-absolute menu routes on edit as on create', async () => {
    const root = await create();
    const menu = await create('menu', root.permissionId);
    await request(http)
      .post(url)
      .auth(administrator.token, { type: 'bearer' })
      .send({ ...input('menu', root.permissionId), route: 'relative' })
      .expect(422);
    await request(http)
      .patch(`${url}/${menu.permissionId}`)
      .auth(administrator.token, { type: 'bearer' })
      .send({ route: 'relative' })
      .expect(422);
  });

  it.each(['sortOrder', 'visible'] as const)(
    'rejects explicit null %s on creation',
    async (field) => {
      await request(http)
        .post(url)
        .auth(administrator.token, { type: 'bearer' })
        .send({ ...input(), [field]: null })
        .expect(400);
    },
  );
  it.each(['permissionName', 'sortOrder', 'visible', 'status'] as const)(
    'rejects explicit null %s on update',
    async (field) => {
      const node = await create();
      await request(http)
        .patch(`${url}/${node.permissionId}`)
        .auth(administrator.token, { type: 'bearer' })
        .send({ [field]: null })
        .expect(400);
    },
  );

  it('protects code nodes, custom directories, children (even disabled) and role references (even disabled roles)', async () => {
    const root = await create();
    const menu = await create('menu', root.permissionId);
    const button = await create('button', menu.permissionId);
    await request(http)
      .delete(`${url}/${button.permissionId}`)
      .auth(administrator.token, { type: 'bearer' })
      .expect(204);
    for (const id of [root.permissionId, menu.permissionId]) {
      await request(http)
        .delete(`${url}/${id}`)
        .auth(administrator.token, { type: 'bearer' })
        .expect(409);
      await request(http)
        .patch(`${url}/${id}`)
        .auth(administrator.token, { type: 'bearer' })
        .send({ status: 'disabled' })
        .expect(409);
    }
    const referenced = await create('menu', root.permissionId);
    const role = await prisma.role.create({
      data: {
        RoleKey: `${prefix}.ref`,
        RoleName: 'Disabled reference',
        DataScope: 'all',
        Status: 'disabled',
        RolePermissions: { create: { PermissionId: referenced.permissionId } },
      },
    });
    roles.push(role.RoleId);
    for (const method of ['delete', 'patch'] as const) {
      const call = request(http)
        [method](`${url}/${referenced.permissionId}`)
        .auth(administrator.token, { type: 'bearer' });
      await (
        method === 'patch' ? call.send({ status: 'disabled' }) : call
      ).expect(409);
    }
    for (const PermissionKey of [
      'menu:system:users',
      'system:permission:list',
    ]) {
      const node = await prisma.permission.findUniqueOrThrow({
        where: { PermissionKey },
      });
      await request(http)
        .delete(`${url}/${node.PermissionId}`)
        .auth(administrator.token, { type: 'bearer' })
        .expect(409);
    }
  });

  it('truncates incidental request metadata and uses server actor/trace for the audit', async () => {
    const body = input();
    const response = await request(http)
      .post(url)
      .auth(administrator.token, { type: 'bearer' })
      .set('user-agent', 'u'.repeat(700))
      .set('x-trace-id', 'untrusted-client-trace')
      .send(body);
    if (response.status === 201) nodes.push(response.body.data.permissionId);
    expect(response.status).toBe(201);
    expect(response.body.traceId).not.toBe('untrusted-client-trace');
    const log = await expectAudit(
      response.body.traceId,
      'system:permission:create',
    );
    expect(log.UserAgent).toHaveLength(500);
  });

  it('syncs only registry APIs, preserves editable UI metadata, retires obsolete APIs without deleting grants, and is repeatable', async () => {
    const menu = await prisma.permission.findUniqueOrThrow({
      where: { PermissionKey: 'menu:system:users' },
    });
    const retired = await prisma.permission.create({
      data: {
        PermissionKey: `${prefix}.retired`,
        PermissionType: 'api',
        PermissionName: 'Retired',
        ParentId: menu.PermissionId,
      },
    });
    nodes.push(retired.PermissionId);
    await prisma.rolePermission.create({
      data: { RoleId: roles[0], PermissionId: retired.PermissionId },
    });
    await prisma.permission.update({
      where: { PermissionId: menu.PermissionId },
      data: { PermissionName: 'Edited UI name', SortOrder: -77 },
    });
    try {
      const first = await request(http)
        .post(`${url}/sync`)
        .auth(administrator.token, { type: 'bearer' })
        .expect(200);
      expect(first.body.data).toEqual({
        created: 0,
        updated: registeredApiPermissions().length,
        disabled: 1,
      });
      await expectAudit(first.body.traceId, 'system:permission:sync');
      expect(
        await prisma.permission.findUnique({
          where: { PermissionId: retired.PermissionId },
        }),
      ).toMatchObject({ Status: 'disabled' });
      expect(
        await prisma.rolePermission.count({
          where: { PermissionId: retired.PermissionId },
        }),
      ).toBe(1);
      expect(
        await prisma.permission.findUnique({
          where: { PermissionId: menu.PermissionId },
        }),
      ).toMatchObject({ PermissionName: 'Edited UI name', SortOrder: -77 });
      const second = await request(http)
        .post(`${url}/sync`)
        .auth(administrator.token, { type: 'bearer' })
        .expect(200);
      expect(second.body.data.disabled).toBe(0);
    } finally {
      await prisma.permission.update({
        where: { PermissionId: menu.PermissionId },
        data: {
          PermissionName: menu.PermissionName,
          SortOrder: menu.SortOrder,
        },
      });
    }
  });

  it('recreates a missing registered API and keeps its code source', async () => {
    const definition = registeredApiPermissions().find(
      ({ parentKey }) => !!parentKey,
    )!;
    const existing = await prisma.permission.findUniqueOrThrow({
      where: { PermissionKey: definition.key },
    });
    const references = await prisma.rolePermission.findMany({
      where: { PermissionId: existing.PermissionId },
    });
    await prisma.rolePermission.deleteMany({
      where: { PermissionId: existing.PermissionId },
    });
    await prisma.permission.delete({
      where: { PermissionId: existing.PermissionId },
    });
    try {
      const response = await request(http)
        .post(`${url}/sync`)
        .auth(administrator.token, { type: 'bearer' })
        .expect(200);
      expect(response.body.data.created).toBe(1);
      const restored = await prisma.permission.findUniqueOrThrow({
        where: { PermissionKey: definition.key },
      });
      const detail = await request(http)
        .get(`${url}/${restored.PermissionId}`)
        .auth(administrator.token, { type: 'bearer' })
        .expect(200);
      expect(detail.body.data).toMatchObject({
        source: 'code',
        permissionType: 'api',
      });
    } finally {
      // Restore the original identity so the seeded grants and structural verifier remain unchanged.
      await prisma.permission.deleteMany({
        where: { PermissionKey: definition.key },
      });
      await prisma.permission.create({ data: existing });
      await prisma.rolePermission.createMany({ data: references });
    }
  });

  it.each([
    'type-conflict',
    'disabled-parent',
    'wrong-parent-type',
    'invalid-ancestor',
  ] as const)(
    'rejects sync with %s and rolls back every API change and audit',
    async (kind) => {
      const definition = registeredApiPermissions().find(
        ({ parentKey }) => !!parentKey,
      )!;
      const target = await prisma.permission.findUniqueOrThrow({
        where: { PermissionKey: definition.key },
      });
      const parent = await prisma.permission.findUniqueOrThrow({
        where: { PermissionKey: definition.parentKey! },
      });
      const saved = kind === 'type-conflict' ? target : parent;
      const data =
        kind === 'type-conflict'
          ? { PermissionType: 'menu' }
          : kind === 'disabled-parent'
            ? { Status: 'disabled' }
            : kind === 'wrong-parent-type'
              ? { PermissionType: 'button' }
              : { ParentId: target.PermissionId };
      await prisma.permission.update({
        where: { PermissionId: saved.PermissionId },
        data,
      });
      const before = await prisma.permission.findMany({
        orderBy: { PermissionId: 'asc' },
      });
      const count = await logs();
      try {
        await request(http)
          .post(`${url}/sync`)
          .auth(administrator.token, { type: 'bearer' })
          .expect(409);
        expect(
          await prisma.permission.findMany({
            orderBy: { PermissionId: 'asc' },
          }),
        ).toEqual(before);
        expect(await logs()).toBe(count);
      } finally {
        await prisma.permission.update({
          where: { PermissionId: saved.PermissionId },
          data: {
            PermissionType: saved.PermissionType,
            Status: saved.Status,
            ParentId: saved.ParentId,
          },
        });
      }
    },
  );

  it.each(['create', 'update', 'disable', 'sync'] as const)(
    'rolls back %s when the actual PostgreSQL audit INSERT fails',
    async (kind) => {
      const root = await create();
      const menu = await create('menu', root.permissionId);
      const syncTarget =
        kind === 'sync'
          ? await prisma.permission.findUniqueOrThrow({
              where: { PermissionKey: registeredApiPermissions()[0].key },
            })
          : null;
      if (syncTarget) {
        await prisma.permission.update({
          where: { PermissionId: syncTarget.PermissionId },
          data: { PermissionName: 'Keep this name on rollback' },
        });
        const retired = await prisma.permission.create({
          data: {
            PermissionKey: `${prefix}.audit-retired`,
            PermissionName: 'Keep active on rollback',
            PermissionType: 'api',
          },
        });
        nodes.push(retired.PermissionId);
      }
      const before = await prisma.permission.findMany({
        orderBy: { PermissionId: 'asc' },
      });
      const count = await logs();
      const brokenAudit = audit('x'.repeat(101));
      const permission = {
        ...input(),
        permissionType: 'directory' as const,
        route: null,
        icon: null,
        sortOrder: 0,
        visible: true,
      };
      const operation =
        kind === 'create'
          ? repository.create({ permission, audit: brokenAudit })
          : kind === 'update'
            ? repository.update({
                permissionId: menu.permissionId,
                patch: { permissionName: 'Must rollback' },
                audit: brokenAudit,
              })
            : kind === 'disable'
              ? repository.disable({
                  permissionId: menu.permissionId,
                  audit: brokenAudit,
                })
              : repository.sync({ audit: brokenAudit });
      try {
        await expect(operation).rejects.toMatchObject({ code: 'P2000' });
        expect(
          await prisma.permission.findMany({
            orderBy: { PermissionId: 'asc' },
          }),
        ).toEqual(before);
        expect(await logs()).toBe(count);
      } finally {
        if (syncTarget)
          await prisma.permission.update({
            where: { PermissionId: syncTarget.PermissionId },
            data: { PermissionName: syncTarget.PermissionName },
          });
      }
    },
  );
});
