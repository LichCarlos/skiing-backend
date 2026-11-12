import { randomUUID } from 'node:crypto';
import { createServer, type Socket } from 'node:net';
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AssetsModule } from '../src/modules/assets/assets.module.js';
import { ASSET_STORAGE } from '../src/modules/assets/application/ports/asset-storage.js';
import { ASSET_SCANNER } from '../src/modules/assets/application/ports/asset-scanner.js';
import { IdentityAccessModule } from '../src/modules/identity-access/identity-access.module.js';
import { BcryptPasswordHasher } from '../src/modules/identity-access/infrastructure/bcrypt-password-hasher.js';
import { PrismaService } from '../src/shared/persistence/prisma.service.js';
import { configureHttp } from '../src/shared/http/configure-http.js';
import { PrismaAssetRepository } from '../src/modules/assets/infrastructure/prisma-asset.repository.js';
import { ClamAvAssetScanner } from '../src/modules/assets/infrastructure/clamav-asset-scanner.js';
import { S3AssetStorage } from '../src/modules/assets/infrastructure/s3-asset-storage.js';

// Only external storage/scanning are replaced. Authentication, guards, multipart,
// application services and database repository use their production implementations.
describe('Asset HTTP / PostgreSQL ownership, references and audit', () => {
  const prefix = `asset-http-${randomUUID().slice(0, 8)}`;
  const password = 'assets-database-validation-password';
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9ioAAAAASUVORK5CYII=',
    'base64',
  );
  const users: number[] = [];
  const roles: number[] = [];
  const resorts: number[] = [];
  const objects = new Map<string, Buffer>();
  const scan = vi.fn(
    async (_bytes: Buffer): Promise<'clean' | 'infected'> => 'clean',
  );
  const put = vi.fn(
    async (input: { key: string; body: Buffer; contentType: string }) => {
      objects.set(input.key, Buffer.from(input.body));
    },
  );
  const remove = vi.fn(async (key: string) => {
    objects.delete(key);
  });
  const createReadUrl = vi.fn(async (key: string, ttl: number) => {
    expect(ttl).toBe(900);
    return `https://asset-validation.example/${key}?expires=${ttl}`;
  });
  let app: INestApplication<App>;
  let http: App;
  let prisma: PrismaService;
  let memberRole: number;
  let adminRole: number;
  let owner: { id: number; token: string };
  let other: typeof owner;
  let administrator: typeof owner;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL)
      throw new Error('Dedicated migrated DATABASE_URL is required');
    vi.stubEnv(
      'JWT_ACCESS_SECRET',
      'asset-http-validation-secret-at-least-32-chars',
    );
    const module = await Test.createTestingModule({
      imports: [IdentityAccessModule, AssetsModule],
    })
      .overrideProvider(ASSET_STORAGE)
      .useValue({ put, remove, createReadUrl })
      .overrideProvider(ASSET_SCANNER)
      .useValue({ scan })
      .compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.init();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);
    memberRole = (
      await prisma.role.findUniqueOrThrow({
        where: { SystemRoleCode: 'registered_user' },
      })
    ).RoleId;
    adminRole = (
      await prisma.role.findUniqueOrThrow({
        where: { SystemRoleCode: 'system_admin' },
      })
    ).RoleId;
    owner = await account([memberRole]);
    other = await account([memberRole]);
    administrator = await account([adminRole]);
  });

  beforeEach(() => {
    scan.mockReset().mockResolvedValue('clean');
    put.mockClear();
    remove.mockClear();
    createReadUrl.mockClear();
  });

  afterAll(async () => {
    try {
      if (prisma) {
        await prisma.operationLog.deleteMany({
          where: { ActorUserId: { in: users } },
        });
        await prisma.skiResort.deleteMany({
          where: { ResortId: { in: resorts } },
        });
        await prisma.asset.deleteMany({
          where: { OwnerUserId: { in: users } },
        });
        await prisma.user.deleteMany({ where: { UserId: { in: users } } });
        await prisma.role.deleteMany({ where: { RoleId: { in: roles } } });
      }
    } finally {
      await app?.close();
      vi.unstubAllEnvs();
    }
  });

  async function account(roleIds: number[]) {
    const user = await prisma.user.create({
      data: {
        Account: `${prefix}-${users.length}`,
        Nickname: 'Asset validation',
        PasswordHash: await new BcryptPasswordHasher().hash(password),
        UserRoles: { create: roleIds.map((RoleId) => ({ RoleId })) },
      },
    });
    users.push(user.UserId);
    const result = await request(http)
      .post('/api/v1/auth/login')
      .send({ account: user.Account, password })
      .expect(200);
    return { id: user.UserId, token: result.body.data.accessToken as string };
  }

  async function upload(actor = owner, filename = `${prefix}-image.png`) {
    const result = await request(http)
      .post('/api/v1/assets')
      .auth(actor.token, { type: 'bearer' })
      .attach('file', png, filename)
      .expect(201);
    return result.body.data as { assetId: string; url: string; status: string };
  }

  async function s3Fixture(
    handle: (request: IncomingMessage, response: ServerResponse) => void,
  ) {
    const requests: Array<{ method: string; path: string }> = [];
    let closed = 0;
    const server = createHttpServer((request, response) => {
      requests.push({
        method: request.method ?? '',
        path: new URL(request.url ?? '/', 'http://fixture').pathname,
      });
      response.once('close', () => closed++);
      request.resume();
      handle(request, response);
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Missing fixture port');
    vi.stubEnv('S3_ENDPOINT', `http://127.0.0.1:${address.port}`);
    vi.stubEnv('S3_PUBLIC_ENDPOINT', 'https://assets.example.test');
    vi.stubEnv('S3_ACCESS_KEY_ID', 'test-only-access');
    vi.stubEnv('S3_SECRET_ACCESS_KEY', 'test-only-secret');
    vi.stubEnv('S3_BUCKET', 'test-assets');
    vi.stubEnv('S3_REGION', 'us-east-1');
    vi.stubEnv('S3_REQUEST_TIMEOUT_MS', '250');
    return {
      requests,
      get closed() {
        return closed;
      },
      async close() {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      },
    };
  }

  it('uploads with server owner, scans before storage and reads only for the actual owner', async () => {
    const asset = await upload();
    expect(asset.status).toBe('ready');
    expect(asset.url).toContain('expires=900');
    const row = await prisma.asset.findUniqueOrThrow({
      where: { AssetId: BigInt(asset.assetId) },
    });
    expect(row).toMatchObject({
      OwnerUserId: owner.id,
      MimeType: 'image/png',
      SizeBytes: BigInt(png.length),
      Status: 'ready',
    });
    expect(objects.get(row.StorageKey)).toEqual(png);
    expect(scan.mock.invocationCallOrder[0]!).toBeLessThan(
      put.mock.invocationCallOrder[0]!,
    );
    await request(http)
      .get(`/api/v1/assets/${asset.assetId}`)
      .auth(owner.token, { type: 'bearer' })
      .expect(200);
    await request(http)
      .get(`/api/v1/assets/${asset.assetId}`)
      .auth(other.token, { type: 'bearer' })
      .expect(404);
    await request(http)
      .delete(`/api/v1/assets/${asset.assetId}`)
      .auth(other.token, { type: 'bearer' })
      .expect(404);
    expect(objects.has(row.StorageKey)).toBe(true);
  });

  it('rejects anonymous/invalid/oversize uploads before creating a pending asset', async () => {
    const before = await prisma.asset.count({
      where: { OwnerUserId: owner.id },
    });
    await request(http)
      .post('/api/v1/assets')
      .attach('file', png, 'anon.png')
      .expect(401);
    await request(http)
      .post('/api/v1/assets')
      .auth(owner.token, { type: 'bearer' })
      .attach('file', Buffer.from('<svg/>'), 'fake.png')
      .expect(400);
    await request(http)
      .post('/api/v1/assets')
      .auth(owner.token, { type: 'bearer' })
      .attach('file', Buffer.alloc(10 * 1024 * 1024 + 1), 'huge.png')
      .expect(413);
    expect(await prisma.asset.count({ where: { OwnerUserId: owner.id } })).toBe(
      before,
    );
    expect(scan).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it('persists rejected scanning state and never uploads infected bytes', async () => {
    scan.mockResolvedValue('infected');
    const filename = `${prefix}-infected.png`;
    await request(http)
      .post('/api/v1/assets')
      .auth(owner.token, { type: 'bearer' })
      .attach('file', png, filename)
      .expect(422);
    expect(
      await prisma.asset.findFirstOrThrow({
        where: { OriginalName: filename, OwnerUserId: owner.id },
      }),
    ).toMatchObject({ Status: 'rejected' });
    expect(put).not.toHaveBeenCalled();
    expect(createReadUrl).not.toHaveBeenCalled();
  });

  it('fails closed and persists rejected state on scanning unavailability', async () => {
    scan.mockRejectedValue(new Error('scanner unavailable'));
    const filename = `${prefix}-unavailable.png`;
    await request(http)
      .post('/api/v1/assets')
      .auth(owner.token, { type: 'bearer' })
      .attach('file', png, filename)
      .expect(503);
    const row = await prisma.asset.findFirstOrThrow({
      where: { OriginalName: filename, OwnerUserId: owner.id },
    });
    expect(row.Status).toBe('rejected');
    expect(objects.has(row.StorageKey)).toBe(false);
    expect(put).not.toHaveBeenCalled();
  });

  it.each(['stream: OK\0', 'stream: Late-Test-Signature FOUND\0'])(
    'rejects real slow scanner TCP response %j through authenticated multipart and persists no ready capability',
    async (reply) => {
      const sockets = new Set<Socket>();
      const server = createServer({ allowHalfOpen: true }, (socket) => {
        sockets.add(socket);
        socket.on('error', () => undefined);
        socket.resume();
        socket.on('end', () => {
          let index = 0;
          const timer = setInterval(() => {
            if (index < reply.length) socket.write(reply[index++]!);
            else {
              clearInterval(timer);
              socket.end();
            }
          }, 40);
          socket.once('close', () => clearInterval(timer));
        });
      });
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
      );
      const address = server.address();
      if (!address || typeof address === 'string')
        throw new Error('No test port');
      vi.stubEnv('CLAMAV_HOST', '127.0.0.1');
      vi.stubEnv('CLAMAV_PORT', String(address.port));
      vi.stubEnv('CLAMAV_TIMEOUT_MS', '250');
      scan.mockImplementationOnce((bytes) =>
        new ClamAvAssetScanner().scan(bytes),
      );
      const filename = `${prefix}-deadline-${randomUUID()}.png`;
      try {
        const result = await request(http)
          .post('/api/v1/assets')
          .auth(owner.token, { type: 'bearer' })
          .attach('file', png, filename)
          .expect(503);
        expect(result.body.data?.url).toBeUndefined();
        const row = await prisma.asset.findFirstOrThrow({
          where: { OwnerUserId: owner.id, OriginalName: filename },
        });
        expect(row.Status).toBe('rejected');
        expect(put).not.toHaveBeenCalled();
        expect(createReadUrl).not.toHaveBeenCalled();
        expect(objects.has(row.StorageKey)).toBe(false);
        await request(http)
          .get(`/api/v1/assets/${row.AssetId}`)
          .auth(owner.token, { type: 'bearer' })
          .expect(404);
        await request(http)
          .get(`/api/v1/assets/${row.AssetId}`)
          .auth(other.token, { type: 'bearer' })
          .expect(404);
      } finally {
        for (const socket of sockets) socket.destroy();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    },
  );

  it('still makes an asset ready when the real TCP protocol returns clean within its total deadline', async () => {
    const received: Buffer[] = [],
      sockets = new Set<Socket>();
    const server = createServer({ allowHalfOpen: true }, (socket) => {
      sockets.add(socket);
      socket.on('error', () => undefined);
      socket.on('data', (chunk) => received.push(Buffer.from(chunk)));
      socket.on('end', () => socket.end('stream: OK\0'));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('No test port');
    vi.stubEnv('CLAMAV_HOST', '127.0.0.1');
    vi.stubEnv('CLAMAV_PORT', String(address.port));
    vi.stubEnv('CLAMAV_TIMEOUT_MS', '2000');
    scan.mockImplementationOnce((bytes) =>
      new ClamAvAssetScanner().scan(bytes),
    );
    try {
      const asset = await upload(owner, `${prefix}-tcp-clean.png`);
      expect(asset.status).toBe('ready');
      const row = await prisma.asset.findUniqueOrThrow({
        where: { AssetId: BigInt(asset.assetId) },
      });
      expect(row.Status).toBe('ready');
      expect(objects.get(row.StorageKey)).toEqual(png);
      const wire = Buffer.concat(received);
      expect(wire.subarray(0, 10).toString()).toBe('zINSTREAM\0');
      expect(wire.readUInt32BE(10)).toBe(png.length);
      expect(wire.subarray(14, 14 + png.length)).toEqual(png);
      expect(wire.subarray(14 + png.length)).toEqual(Buffer.alloc(4));
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it('persists rejected after a real S3 PUT timeout and removes a fixture object committed before the response stalled', async () => {
    const remoteObjects = new Set<string>();
    const api = await s3Fixture((request, response) => {
      request.once('end', () => {
        const key = new URL(request.url ?? '/', 'http://fixture').pathname;
        if (request.method === 'PUT') {
          remoteObjects.add(key);
          response.writeHead(500, { 'content-type': 'application/xml' });
          response.write('<Error>');
          const timer = setInterval(() => response.write(' '), 20);
          response.once('close', () => clearInterval(timer));
        } else if (request.method === 'DELETE') {
          remoteObjects.delete(key);
          response.writeHead(204);
          response.end();
        } else {
          response.writeHead(405);
          response.end();
        }
      });
    });
    const storage = new S3AssetStorage();
    put.mockImplementationOnce((input) => storage.put(input));
    remove.mockImplementationOnce((key) => storage.remove(key));
    const filename = `${prefix}-s3-timeout.png`;
    try {
      const result = await request(http)
        .post('/api/v1/assets')
        .auth(owner.token, { type: 'bearer' })
        .attach('file', png, filename)
        .expect(503);
      expect(result.body.data?.url).toBeUndefined();
      const row = await prisma.asset.findFirstOrThrow({
        where: { OwnerUserId: owner.id, OriginalName: filename },
      });
      expect(row.Status).toBe('rejected');
      expect(createReadUrl).not.toHaveBeenCalled();
      expect(put).toHaveBeenCalledTimes(1);
      expect(remove).toHaveBeenCalledExactlyOnceWith(row.StorageKey);
      expect(api.requests).toEqual([
        { method: 'PUT', path: `/test-assets/${row.StorageKey}` },
        { method: 'DELETE', path: `/test-assets/${row.StorageKey}` },
      ]);
      expect(remoteObjects.size).toBe(0);
      await vi.waitFor(() => expect(api.closed).toBe(2));
      for (const actor of [owner, other])
        await request(http)
          .get(`/api/v1/assets/${row.AssetId}`)
          .auth(actor.token, { type: 'bearer' })
          .expect(404);
    } finally {
      await api.close();
    }
  });

  it.each(['owner', 'administrator'] as const)(
    'bounds a real S3 deletion timeout through the %s endpoint while preserving logical deletion semantics',
    async (kind) => {
      const asset = await upload(owner, `${prefix}-s3-delete-${kind}.png`);
      const row = await prisma.asset.findUniqueOrThrow({
        where: { AssetId: BigInt(asset.assetId) },
      });
      const api = await s3Fixture(() => undefined);
      const storage = new S3AssetStorage();
      remove.mockImplementationOnce((key) => storage.remove(key));
      try {
        await request(http)
          .delete(
            `/api/v1/${kind === 'administrator' ? 'admin/assets' : 'assets'}/${asset.assetId}`,
          )
          .auth((kind === 'administrator' ? administrator : owner).token, {
            type: 'bearer',
          })
          .expect(kind === 'administrator' ? 204 : 503);
        expect(
          (
            await prisma.asset.findUniqueOrThrow({
              where: { AssetId: row.AssetId },
            })
          ).Status,
        ).toBe('deleted');
        expect(remove).toHaveBeenCalledExactlyOnceWith(row.StorageKey);
        expect(api.requests).toEqual([
          { method: 'DELETE', path: `/test-assets/${row.StorageKey}` },
        ]);
        await vi.waitFor(() => expect(api.closed).toBe(1));
        await request(http)
          .get(`/api/v1/assets/${row.AssetId}`)
          .auth(owner.token, { type: 'bearer' })
          .expect(404);
        if (kind === 'administrator')
          expect(
            await prisma.operationLog.count({
              where: {
                TargetId: asset.assetId,
                ActionKey: 'content:asset:delete',
              },
            }),
          ).toBe(1);
      } finally {
        await api.close();
      }
    },
  );

  it('protects real content references and deletes the object only after unlinking', async () => {
    const asset = await upload();
    const row = await prisma.asset.findUniqueOrThrow({
      where: { AssetId: BigInt(asset.assetId) },
    });
    const resort = await prisma.skiResort.create({
      data: {
        Name: 'Asset test resort',
        LegacyDistance: 0,
        Price: 100,
        SnowCondition: 'powder',
        Description: 'Test',
        CoverAssetId: row.AssetId,
      },
    });
    resorts.push(resort.ResortId);
    await request(http)
      .delete(`/api/v1/assets/${asset.assetId}`)
      .auth(owner.token, { type: 'bearer' })
      .expect(422);
    await request(http)
      .delete(`/api/v1/admin/assets/${asset.assetId}`)
      .auth(administrator.token, { type: 'bearer' })
      .expect(422);
    const detail = await request(http)
      .get(`/api/v1/admin/assets/${asset.assetId}`)
      .auth(administrator.token, { type: 'bearer' })
      .expect(200);
    expect(detail.body.data.references.coverResorts).toBe(1);
    expect(remove).not.toHaveBeenCalled();
    expect(objects.has(row.StorageKey)).toBe(true);
    await prisma.skiResort.update({
      where: { ResortId: resort.ResortId },
      data: { CoverAssetId: null },
    });
    await request(http)
      .delete(`/api/v1/assets/${asset.assetId}`)
      .auth(owner.token, { type: 'bearer' })
      .expect(204);
    expect(
      await prisma.asset.findUniqueOrThrow({ where: { AssetId: row.AssetId } }),
    ).toMatchObject({ Status: 'deleted' });
    expect(objects.has(row.StorageKey)).toBe(false);
    await request(http)
      .get(`/api/v1/assets/${asset.assetId}`)
      .auth(owner.token, { type: 'bearer' })
      .expect(404);
  });

  it('filters the global inventory and commits the authenticated administrator audit with deletion', async () => {
    const asset = await upload();
    const result = await request(http)
      .get('/api/v1/admin/assets')
      .query({
        ownerUserId: owner.id,
        status: 'ready',
        keyword: prefix,
        pageSize: 1,
      })
      .auth(administrator.token, { type: 'bearer' })
      .expect(200);
    expect(result.body.data.items).toHaveLength(1);
    expect(result.body.data.items[0].ownerUserId).toBe(owner.id);
    await request(http)
      .get('/api/v1/admin/assets')
      .auth(owner.token, { type: 'bearer' })
      .expect(403);
    await request(http)
      .delete(`/api/v1/admin/assets/${asset.assetId}`)
      .auth(administrator.token, { type: 'bearer' })
      .expect(204);
    const log = await prisma.operationLog.findFirstOrThrow({
      where: {
        ActorUserId: administrator.id,
        TargetId: asset.assetId,
        ActionKey: 'content:asset:delete',
      },
    });
    expect(log).toMatchObject({ ResourceKey: 'asset', Result: 'success' });
    expect(log.TraceId).toBeTruthy();
    const row = await prisma.asset.findUniqueOrThrow({
      where: { AssetId: BigInt(asset.assetId) },
    });
    expect(objects.has(row.StorageKey)).toBe(false);
    expect(row.Status).toBe('deleted');
  });

  async function scopedAccount(scopeType: string, selectedIds: number[] = []) {
    const permissionKeys = [
      'management:portal:enter',
      'content:asset:list',
      'content:asset:delete',
    ];
    const permissions = await prisma.permission.findMany({
      where: { PermissionKey: { in: permissionKeys } },
    });
    expect(permissions).toHaveLength(3);
    const role = await prisma.role.create({
      data: {
        RoleKey: `${prefix}-scoped-${roles.length}`,
        RoleName: 'Asset scoped validator',
        DataScope: 'self',
        RolePermissions: {
          create: permissions.map(({ PermissionId }) => ({ PermissionId })),
        },
        DataScopes: {
          create: {
            ResourceKey: 'asset',
            ScopeType: scopeType,
            ...(scopeType === 'selected'
              ? { ScopeConfig: { selectedIds } }
              : {}),
          },
        },
      },
    });
    roles.push(role.RoleId);
    return {
      ...(await account([memberRole, role.RoleId])),
      roleId: role.RoleId,
    };
  }

  it('intersects self scope with filters and pagination/count, hides other owners and permits own deletion', async () => {
    const scoped = await scopedAccount('self');
    const keyword = `${prefix}-self`;
    const first = await upload(scoped, `${keyword}-1.png`);
    const second = await upload(scoped, `${keyword}-2.png`);
    const outside = await upload(owner, `${keyword}-outside.png`);
    createReadUrl.mockClear();
    const result = await request(http)
      .get('/api/v1/admin/assets')
      .query({ keyword, pageSize: 1 })
      .auth(scoped.token, { type: 'bearer' })
      .expect(200);
    expect(result.body.data).toMatchObject({ total: 2, hasNext: true });
    expect(
      result.body.data.items.map((item: { assetId: string }) => item.assetId),
    ).toEqual([second.assetId]);
    const next = await request(http)
      .get('/api/v1/admin/assets')
      .query({ keyword, pageSize: 1, page: 2 })
      .auth(scoped.token, { type: 'bearer' })
      .expect(200);
    expect(next.body.data).toMatchObject({ total: 2, hasNext: false });
    expect(next.body.data.items[0].assetId).toBe(first.assetId);
    const filtered = await request(http)
      .get('/api/v1/admin/assets')
      .query({ keyword, ownerUserId: owner.id })
      .auth(scoped.token, { type: 'bearer' })
      .expect(200);
    expect(filtered.body.data).toMatchObject({ items: [], total: 0 });
    await request(http)
      .get(`/api/v1/admin/assets/${outside.assetId}`)
      .auth(scoped.token, { type: 'bearer' })
      .expect(404);
    await request(http)
      .delete(`/api/v1/admin/assets/${outside.assetId}`)
      .auth(scoped.token, { type: 'bearer' })
      .expect(404);
    expect(createReadUrl).toHaveBeenCalledTimes(2);
    expect(remove).not.toHaveBeenCalled();
    expect(
      await prisma.operationLog.count({ where: { ActorUserId: scoped.id } }),
    ).toBe(0);
    await request(http)
      .get(`/api/v1/admin/assets/${first.assetId}`)
      .auth(scoped.token, { type: 'bearer' })
      .expect(200);
    await request(http)
      .delete(`/api/v1/admin/assets/${first.assetId}`)
      .auth(scoped.token, { type: 'bearer' })
      .expect(204);
    expect(
      await prisma.operationLog.count({
        where: {
          ActorUserId: scoped.id,
          TargetId: first.assetId,
          Result: 'success',
        },
      }),
    ).toBe(1);
  });

  it('restricts selected scope to exact asset IDs across owners and ignores forged filter widening', async () => {
    const keyword = `${prefix}-selected`;
    const a = await upload(owner, `${keyword}-a.png`);
    const b = await upload(other, `${keyword}-b.png`);
    const outside = await upload(owner, `${keyword}-outside.png`);
    const scoped = await scopedAccount('selected', [
      Number(a.assetId),
      Number(b.assetId),
    ]);
    createReadUrl.mockClear();
    const result = await request(http)
      .get('/api/v1/admin/assets')
      .query({ keyword, pageSize: 1 })
      .auth(scoped.token, { type: 'bearer' })
      .expect(200);
    expect(result.body.data).toMatchObject({ total: 2, hasNext: true });
    expect(result.body.data.items[0].assetId).toBe(b.assetId);
    const filtered = await request(http)
      .get('/api/v1/admin/assets')
      .query({ keyword, ownerUserId: owner.id })
      .auth(scoped.token, { type: 'bearer' })
      .expect(200);
    expect(filtered.body.data.total).toBe(1);
    expect(filtered.body.data.items[0].assetId).toBe(a.assetId);
    for (const method of ['get', 'delete'] as const)
      await request(http)
        [method](`/api/v1/admin/assets/${outside.assetId}`)
        .auth(scoped.token, { type: 'bearer' })
        .expect(404);
    expect(createReadUrl).toHaveBeenCalledTimes(2);
    expect(remove).not.toHaveBeenCalled();
    expect(
      await prisma.operationLog.count({ where: { ActorUserId: scoped.id } }),
    ).toBe(0);
    await request(http)
      .get(`/api/v1/admin/assets/${b.assetId}`)
      .auth(scoped.token, { type: 'bearer' })
      .expect(200);
    await request(http)
      .delete(`/api/v1/admin/assets/${a.assetId}`)
      .auth(scoped.token, { type: 'bearer' })
      .expect(204);
    expect(
      await prisma.operationLog.count({
        where: { ActorUserId: scoped.id, TargetId: a.assetId },
      }),
    ).toBe(1);
  });

  it('denies conflicting grants and merchant scope with no storage or audit side effects', async () => {
    const scoped = await scopedAccount('self');
    const conflicting = await scopedAccount('all');
    await prisma.userRole.create({
      data: { UserId: scoped.id, RoleId: conflicting.roleId },
    });
    const merchant = await scopedAccount('merchant');
    const asset = await upload();
    createReadUrl.mockClear();
    for (const actor of [scoped, merchant]) {
      await request(http)
        .get('/api/v1/admin/assets')
        .auth(actor.token, { type: 'bearer' })
        .expect(403);
      for (const method of ['get', 'delete'] as const)
        await request(http)
          [method](`/api/v1/admin/assets/${asset.assetId}`)
          .auth(actor.token, { type: 'bearer' })
          .expect(403);
      expect(
        await prisma.operationLog.count({ where: { ActorUserId: actor.id } }),
      ).toBe(0);
    }
    expect(createReadUrl).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('reapplies scope inside deletion even if ownership changes after the application preflight', async () => {
    const { PrismaAssetRepository } =
      await import('../src/modules/assets/infrastructure/prisma-asset.repository.js');
    const { ManageAdminAssets } =
      await import('../src/modules/assets/application/manage-admin-assets.js');
    const scoped = await scopedAccount('self');
    const asset = await upload(scoped);
    const repository = new PrismaAssetRepository(prisma);
    const find = vi.spyOn(repository, 'findById');
    // Use the original prototype to avoid recursing through the spy.
    find.mockImplementation(async (id, access) => {
      const snapshot = await PrismaAssetRepository.prototype.findById.call(
        repository,
        id,
        access,
      );
      await prisma.asset.update({
        where: { AssetId: BigInt(id) },
        data: { OwnerUserId: other.id },
      });
      return snapshot;
    });
    const service = new ManageAdminAssets(repository, {
      put,
      remove,
      createReadUrl,
    });
    await expect(
      service.remove(
        asset.assetId,
        {
          actorUserId: scoped.id,
          traceId: prefix,
          clientIp: null,
          userAgent: null,
        },
        { kind: 'self', userId: scoped.id },
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(remove).not.toHaveBeenCalled();
    expect(
      await prisma.asset.findUniqueOrThrow({
        where: { AssetId: BigInt(asset.assetId) },
      }),
    ).toMatchObject({ OwnerUserId: other.id, Status: 'ready' });
    expect(
      await prisma.operationLog.count({ where: { TargetId: asset.assetId } }),
    ).toBe(0);
  });

  it.each([
    'account disabled',
    'role disabled',
    'portal removed',
    'delete grant removed',
    'role unbound',
    'scope narrowed',
    'selected changed',
    'unsupported merchant scope',
    'scope conflict',
  ] as const)(
    'refuses admin asset deletion when %s commits after Guard and preflight',
    async (change) => {
      const scoped = await scopedAccount('all');
      const asset = await upload();
      const row = await prisma.asset.findUniqueOrThrow({
        where: { AssetId: BigInt(asset.assetId) },
      });
      const repository = app.get(PrismaAssetRepository);
      const original = repository.deleteIfUnreferencedAdmin.bind(repository);
      const hook = vi
        .spyOn(repository, 'deleteIfUnreferencedAdmin')
        .mockImplementationOnce(async (input) => {
          if (change === 'account disabled')
            await prisma.user.update({
              where: { UserId: scoped.id },
              data: { Status: 'disabled' },
            });
          if (change === 'role disabled')
            await prisma.role.update({
              where: { RoleId: scoped.roleId },
              data: { Status: 'disabled' },
            });
          if (
            change === 'portal removed' ||
            change === 'delete grant removed'
          ) {
            const permission = await prisma.permission.findUniqueOrThrow({
              where: {
                PermissionKey:
                  change === 'portal removed'
                    ? 'management:portal:enter'
                    : 'content:asset:delete',
              },
            });
            await prisma.rolePermission.delete({
              where: {
                RoleId_PermissionId: {
                  RoleId: scoped.roleId,
                  PermissionId: permission.PermissionId,
                },
              },
            });
          }
          if (change === 'role unbound')
            await prisma.userRole.delete({
              where: {
                UserId_RoleId: { UserId: scoped.id, RoleId: scoped.roleId },
              },
            });
          if (
            change === 'scope narrowed' ||
            change === 'selected changed' ||
            change === 'unsupported merchant scope'
          )
            await prisma.roleDataScope.update({
              where: {
                RoleId_ResourceKey: {
                  RoleId: scoped.roleId,
                  ResourceKey: 'asset',
                },
              },
              data: {
                ScopeType:
                  change === 'scope narrowed'
                    ? 'self'
                    : change === 'selected changed'
                      ? 'selected'
                      : 'merchant',
                ...(change === 'selected changed'
                  ? { ScopeConfig: { selectedIds: [Number(asset.assetId)] } }
                  : {}),
              },
            });
          if (change === 'scope conflict') {
            const extra = await scopedAccount('self');
            await prisma.userRole.create({
              data: { UserId: scoped.id, RoleId: extra.roleId },
            });
          }
          return original(input);
        });
      try {
        await request(http)
          .delete(`/api/v1/admin/assets/${asset.assetId}`)
          .auth(scoped.token, { type: 'bearer' })
          .expect(403);
        expect(hook).toHaveBeenCalledTimes(1);
        expect(
          await prisma.asset.findUniqueOrThrow({
            where: { AssetId: row.AssetId },
          }),
        ).toMatchObject({ Status: 'ready' });
        expect(
          await prisma.operationLog.count({
            where: { ActorUserId: scoped.id, TargetId: asset.assetId },
          }),
        ).toBe(0);
        expect(remove).not.toHaveBeenCalled();
        expect(objects.has(row.StorageKey)).toBe(true);
      } finally {
        hook.mockRestore();
      }
    },
  );

  it('preserves a newly committed avatar reference after an owned delete waits on the asset lock', async () => {
    const asset = await upload();
    const row = await prisma.asset.findUniqueOrThrow({
      where: { AssetId: BigInt(asset.assetId) },
    });
    let ready!: () => void, release!: () => void;
    const locked = new Promise<void>((yes) => {
      ready = yes;
    });
    const released = new Promise<void>((yes) => {
      release = yes;
    });
    const holding = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "AssetId" FROM "Asset" WHERE "AssetId"=${row.AssetId} FOR SHARE`;
        await tx.user.update({
          where: { UserId: owner.id },
          data: { AvatarAssetId: row.AssetId },
        });
        ready();
        await released;
      },
      { timeout: 15_000 },
    );
    void holding.catch(() => ready());
    let deleting: Promise<request.Response> | undefined;
    try {
      try {
        await locked;
        deleting = request(http)
          .delete(`/api/v1/assets/${asset.assetId}`)
          .auth(owner.token, { type: 'bearer' })
          .then((response) => response);
        let waiting = 0;
        for (let i = 0; i < 150; i++) {
          const rows = await prisma.$queryRaw<Array<{ count: number }>>`
            SELECT count(*)::int AS count FROM pg_stat_activity
            WHERE datname=current_database() AND wait_event_type='Lock'
              AND query LIKE '%FROM "Asset"%' AND query LIKE '%FOR UPDATE%'`;
          waiting = rows[0]!.count;
          if (waiting) break;
          await new Promise((yes) => setTimeout(yes, 20));
        }
        expect(waiting).toBeGreaterThan(0);
      } finally {
        release();
        await holding;
      }
      expect((await deleting!).status).toBe(422);
      expect(
        await prisma.asset.findUniqueOrThrow({
          where: { AssetId: row.AssetId },
        }),
      ).toMatchObject({ Status: 'ready' });
      expect(
        await prisma.user.findUniqueOrThrow({ where: { UserId: owner.id } }),
      ).toMatchObject({ AvatarAssetId: row.AssetId });
      expect(remove).not.toHaveBeenCalled();
      expect(objects.get(row.StorageKey)).toEqual(png);
    } finally {
      release();
      await deleting?.catch(() => undefined);
      await prisma.user.update({
        where: { UserId: owner.id },
        data: { AvatarAssetId: null },
      });
    }
  });

  it('maps a real concurrent asset row change to 409 without deletion, audit or object removal', async () => {
    const asset = await upload();
    const row = await prisma.asset.findUniqueOrThrow({
      where: { AssetId: BigInt(asset.assetId) },
    });
    let ready!: () => void, release!: () => void;
    const locked = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holding = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "AssetId" FROM "Asset" WHERE "AssetId" = ${row.AssetId} FOR UPDATE`;
        await tx.asset.update({
          where: { AssetId: row.AssetId },
          data: { Status: 'rejected' },
        });
        ready();
        await released;
      },
      { timeout: 15000 },
    );
    // Observe rejection immediately so fixture setup failures cannot become unhandled.
    void holding.catch(() => ready());
    let deleting: Promise<request.Response> | undefined;
    try {
      await locked;
      deleting = request(http)
        .delete(`/api/v1/admin/assets/${asset.assetId}`)
        .auth(administrator.token, { type: 'bearer' })
        .then((response) => response);
      let waiting = 0;
      for (let i = 0; i < 150; i++) {
        const rows = await prisma.$queryRaw<
          { count: number }[]
        >`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM "Asset"%' AND query LIKE '%FOR UPDATE%'`;
        waiting = rows[0]!.count;
        if (waiting) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(waiting).toBeGreaterThan(0);
    } finally {
      release();
      await holding;
    }
    expect((await deleting!).status).toBe(409);
    expect(
      await prisma.asset.findUniqueOrThrow({ where: { AssetId: row.AssetId } }),
    ).toMatchObject({ Status: 'rejected' });
    expect(
      await prisma.operationLog.count({
        where: { TargetId: asset.assetId, ActionKey: 'content:asset:delete' },
      }),
    ).toBe(0);
    expect(remove).not.toHaveBeenCalled();
    expect(objects.has(row.StorageKey)).toBe(true);
  });

  it('returns 400 for out-of-range IDs and pagination instead of database failures', async () => {
    for (const path of [
      '/assets/9223372036854775808',
      '/admin/assets/9223372036854775808',
    ])
      await request(http)
        .get(`/api/v1${path}`)
        .auth(administrator.token, { type: 'bearer' })
        .expect(400);
    await request(http)
      .get('/api/v1/admin/assets')
      .query({ page: Number.MAX_SAFE_INTEGER, pageSize: 100 })
      .auth(administrator.token, { type: 'bearer' })
      .expect(400);
    await request(http)
      .get('/api/v1/admin/assets')
      .query({ ownerUserId: 2_147_483_648 })
      .auth(administrator.token, { type: 'bearer' })
      .expect(400);
  });

  it('rolls back asset deletion and preserves its object when the audit insert fails', async () => {
    const asset = await upload();
    const row = await prisma.asset.findUniqueOrThrow({
      where: { AssetId: BigInt(asset.assetId) },
    });
    const trigger = `asset_audit_${randomUUID().replaceAll('-', '')}`;
    // Identifier and numeric target originate only from this test's generated fixture.
    await prisma.$executeRawUnsafe(`CREATE FUNCTION "${trigger}"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW."ActionKey" = 'content:asset:delete' AND NEW."TargetId" = '${asset.assetId}' THEN
          RAISE EXCEPTION 'injected asset audit failure';
        END IF;
        RETURN NEW;
      END $$`);
    try {
      await prisma.$executeRawUnsafe(
        `CREATE TRIGGER "${trigger}" BEFORE INSERT ON "OperationLog" FOR EACH ROW EXECUTE FUNCTION "${trigger}"()`,
      );
      await request(http)
        .delete(`/api/v1/admin/assets/${asset.assetId}`)
        .auth(administrator.token, { type: 'bearer' })
        .expect(500);
      expect(
        await prisma.asset.findUniqueOrThrow({
          where: { AssetId: row.AssetId },
        }),
      ).toMatchObject({ Status: 'ready' });
      expect(objects.has(row.StorageKey)).toBe(true);
      expect(remove).not.toHaveBeenCalled();
      expect(
        await prisma.operationLog.count({
          where: { TargetId: asset.assetId, ActionKey: 'content:asset:delete' },
        }),
      ).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS "${trigger}" ON "OperationLog"`,
      );
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${trigger}"()`);
    }
  });
});
