import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout } from 'node:timers/promises';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AssetsModule } from '../src/modules/assets/assets.module.js';
import { IdentityAccessModule } from '../src/modules/identity-access/identity-access.module.js';
import { PrismaService } from '../src/shared/persistence/prisma.service.js';
import { configureHttp } from '../src/shared/http/configure-http.js';
import { ClamAvAssetScanner } from '../src/modules/assets/infrastructure/clamav-asset-scanner.js';
import { S3AssetStorage } from '../src/modules/assets/infrastructure/s3-asset-storage.js';
import { PrismaAssetRepository } from '../src/modules/assets/infrastructure/prisma-asset.repository.js';

// All module providers, JWT/guards, PostgreSQL, MinIO and ClamAV are real.
describe('Asset HTTP with private MinIO signatures and actual antivirus scanning', () => {
  const prefix = `storage-${randomUUID().slice(0, 8)}`,
    users: number[] = [],
    roles: number[] = [];
  const password = randomUUID(),
    bucket = process.env.S3_BUCKET ?? '';
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9ioAAAAASUVORK5CYII=',
    'base64',
  );
  const markedPng = Buffer.concat([
    png,
    Buffer.from('LINJI-HARMLESS-SCANNER-VALIDATION-20261102'),
  ]);
  let app: INestApplication<App>,
    prisma: PrismaService,
    http: App,
    s3: S3Client;
  let owner: { id: number; token: string }, other: typeof owner;
  let asset: { assetId: string; url: string; status: string }, key: string;
  beforeAll(async () => {
    const db = new URL(process.env.DATABASE_URL ?? ''),
      endpoint = new URL(process.env.S3_ENDPOINT ?? '');
    if (
      db.pathname !== '/linji_asset_storage_validation' ||
      !['127.0.0.1', 'localhost'].includes(db.hostname) ||
      process.env.ASSET_STORAGE_INTEGRATION_CONFIRM !==
        'linji_asset_storage_validation' ||
      !['127.0.0.1', 'localhost'].includes(endpoint.hostname) ||
      bucket !== 'linji-asset-storage-validation' ||
      process.env.S3_PUBLIC_ENDPOINT !== process.env.S3_ENDPOINT ||
      !process.env.CLAMAV_PORT
    )
      throw new Error(
        'Dedicated loopback asset storage database, private test bucket and explicit confirmation required',
      );
    s3 = new S3Client({
      endpoint: endpoint.toString(),
      forcePathStyle: true,
      region: process.env.S3_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID!,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
      },
    });
    expect(
      (await s3.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 })))
        .Contents ?? [],
    ).toEqual([]);
    const module = await Test.createTestingModule({
      imports: [IdentityAccessModule, AssetsModule],
    }).compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.init();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);
    // The dedicated scanner loads fixtures/linji-test-only.ndb, never a production definition.
    const scanner = app.get(ClamAvAssetScanner);
    for (let attempt = 0; ; attempt++) {
      if ((await scanner.scan(markedPng)) === 'infected') break;
      if (attempt >= 90)
        throw new Error('Dedicated ClamAV test-only signature has not loaded');
      await setTimeout(500);
    }
    owner = await account();
    other = await account();
  });
  afterAll(async () => {
    try {
      if (prisma && users.length) {
        const records = await prisma.asset.findMany({
          where: { OwnerUserId: { in: users } },
        });
        for (const row of records)
          await s3.send(
            new DeleteObjectCommand({ Bucket: bucket, Key: row.StorageKey }),
          );
        await prisma.user.updateMany({
          where: { UserId: { in: users } },
          data: { AvatarAssetId: null },
        });
        await prisma.operationLog.deleteMany({
          where: { ActorUserId: { in: users } },
        });
        await prisma.asset.deleteMany({
          where: { OwnerUserId: { in: users } },
        });
        await prisma.merchantProfile.deleteMany({
          where: { UserId: { in: users } },
        });
        await prisma.user.deleteMany({ where: { UserId: { in: users } } });
        await prisma.role.deleteMany({ where: { RoleId: { in: roles } } });
        expect(
          (await s3.send(new ListObjectsV2Command({ Bucket: bucket })))
            .Contents ?? [],
        ).toEqual([]);
      }
    } finally {
      s3?.destroy();
      await app?.close();
    }
  });

  let nextFixtureLoginAt = 0;
  async function account() {
    const account = `${prefix}-${users.length}`;
    const registered = await request(http)
      .post('/api/v1/auth/register')
      .send({ account, password, nickname: 'Storage validation' })
      .expect(201);
    const id = registered.body.data.userId as number;
    users.push(id);
    // This suite uses one real loopback IP. Pace synthetic setup below the
    // production 30/60s limit; never disable the limiter or retry a 429 login.
    const wait = nextFixtureLoginAt - performance.now();
    if (wait > 0) await setTimeout(wait);
    nextFixtureLoginAt = performance.now() + 2100;
    const loggedIn = await request(http)
      .post('/api/v1/auth/login')
      .send({ account, password })
      .expect(200);
    return { id, token: loggedIn.body.data.accessToken as string };
  }
  async function operator(
    scopeType: string,
    selectedIds: number[] = [],
    portal = true,
  ) {
    const actor = await account();
    const permissionKeys = [
      'content:asset:list',
      'content:asset:delete',
      ...(portal ? ['management:portal:enter'] : []),
    ];
    const permissions = await prisma.permission.findMany({
      where: { PermissionKey: { in: permissionKeys } },
    });
    expect(permissions).toHaveLength(permissionKeys.length);
    const role = await prisma.role.create({
      data: {
        RoleKey: `${prefix}-role-${roles.length}`,
        RoleName: 'Storage operator',
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
        UserRoles: { create: { UserId: actor.id } },
      },
    });
    roles.push(role.RoleId);
    if (scopeType === 'merchant') {
      await prisma.merchantProfile.create({
        data: { UserId: actor.id, BusinessName: 'Storage scope fixture' },
      });
    }
    return { ...actor, roleId: role.RoleId };
  }
  async function upload(actor: typeof owner, name: string) {
    const result = await request(http)
      .post('/api/v1/assets')
      .auth(actor.token, { type: 'bearer' })
      .attach('file', png, `${prefix}-${name}.png`)
      .expect(201);
    return result.body.data as typeof asset;
  }
  async function objectState(id: string, status: string, readableUrl?: string) {
    const row = await prisma.asset.findUniqueOrThrow({
      where: { AssetId: BigInt(id) },
    });
    expect(row.Status).toBe(status);
    if (status === 'ready') {
      await expect(
        s3.send(new HeadObjectCommand({ Bucket: bucket, Key: row.StorageKey })),
      ).resolves.toMatchObject({ ContentLength: png.length });
      if (readableUrl) {
        const response = await fetch(readableUrl);
        expect(response.status).toBe(200);
        expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
      }
    } else {
      await expect(
        s3.send(new HeadObjectCommand({ Bucket: bucket, Key: row.StorageKey })),
      ).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
      if (readableUrl) expect((await fetch(readableUrl)).status).toBe(404);
    }
  }
  async function noAudit(actorId: number) {
    expect(
      await prisma.operationLog.count({ where: { ActorUserId: actorId } }),
    ).toBe(0);
  }

  async function uploadActor() {
    const actor = await account();
    const permissions = await prisma.permission.findMany({
      where: {
        PermissionKey: {
          in: ['asset:upload', 'asset:read-own', 'asset:delete-own'],
        },
      },
    });
    expect(permissions).toHaveLength(3);
    const uploadPermissionId = permissions.find(
      (p) => p.PermissionKey === 'asset:upload',
    )!.PermissionId;
    const role = await prisma.role.create({
      data: {
        RoleKey: `${prefix}-upload-${roles.length}`,
        RoleName: 'Configurable upload writer',
        DataScope: 'self',
        RolePermissions: {
          create: permissions.map(({ PermissionId }) => ({ PermissionId })),
        },
      },
    });
    roles.push(role.RoleId);
    await prisma.userRole.deleteMany({ where: { UserId: actor.id } });
    await prisma.userRole.create({
      data: { UserId: actor.id, RoleId: role.RoleId },
    });
    return { ...actor, roleId: role.RoleId, uploadPermissionId };
  }

  it('denies owned reads when the read grant was revoked after Guard but before repository lookup', async () => {
    const actor = await uploadActor(),
      image = await upload(actor, 'read-before-lookup');
    const repository = app.get(PrismaAssetRepository),
      storage = app.get(S3AssetStorage);
    const original = repository.findOwnedReady.bind(repository);
    const sign = vi.spyOn(storage, 'createReadUrl'),
      remove = vi.spyOn(storage, 'remove');
    const find = vi
      .spyOn(repository, 'findOwnedReady')
      .mockImplementationOnce(async (...args) => {
        const permission = await prisma.permission.findUniqueOrThrow({
          where: { PermissionKey: 'asset:read-own' },
        });
        await prisma.rolePermission.deleteMany({
          where: {
            RoleId: actor.roleId,
            PermissionId: permission.PermissionId,
          },
        });
        return original(...args);
      });
    try {
      const response = await request(http)
        .get(`/api/v1/assets/${image.assetId}`)
        .auth(actor.token, { type: 'bearer' })
        .expect(403);
      expect(response.body.data).toBeNull();
      expect(find).toHaveBeenCalledOnce();
      expect(sign).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
      await objectState(image.assetId, 'ready', image.url);
    } finally {
      find.mockRestore();
      sign.mockRestore();
      remove.mockRestore();
    }
  });

  for (const mutation of ['read-grant-removed', 'account-disabled'] as const) {
    it(`rejects an owned read after actual signing when ${mutation}, while documenting existing URL capability`, async () => {
      const actor = await uploadActor(),
        image = await upload(actor, mutation);
      const storage = app.get(S3AssetStorage),
        originalSign = storage.createReadUrl.bind(storage);
      let issuedUrl: string | undefined;
      const remove = vi.spyOn(storage, 'remove');
      const sign = vi
        .spyOn(storage, 'createReadUrl')
        .mockImplementationOnce(async (...args) => {
          issuedUrl = await originalSign(...args);
          if (mutation === 'account-disabled')
            await prisma.user.update({
              where: { UserId: actor.id },
              data: { Status: 'disabled' },
            });
          else {
            const permission = await prisma.permission.findUniqueOrThrow({
              where: { PermissionKey: 'asset:read-own' },
            });
            await prisma.rolePermission.deleteMany({
              where: {
                RoleId: actor.roleId,
                PermissionId: permission.PermissionId,
              },
            });
          }
          return issuedUrl;
        });
      try {
        const response = await request(http)
          .get(`/api/v1/assets/${image.assetId}`)
          .auth(actor.token, { type: 'bearer' })
          .expect(403);
        expect(response.body.data).toBeNull();
        expect(JSON.stringify(response.body)).not.toContain('X-Amz');
        expect(sign).toHaveBeenCalledOnce();
        expect(remove).not.toHaveBeenCalled();
        expect(issuedUrl).toBeDefined();
        // Signing is a capability operation. The response must not expose this
        // new URL, but authorization changes cannot revoke an already signed URL.
        await objectState(image.assetId, 'ready', issuedUrl);
      } finally {
        sign.mockRestore();
        remove.mockRestore();
      }
    });
  }

  it('does not return an old signed read after another actual owned delete completes during signing', async () => {
    const actor = await uploadActor(),
      image = await upload(actor, 'delete-during-read');
    const storage = app.get(S3AssetStorage),
      originalSign = storage.createReadUrl.bind(storage);
    const remove = vi.spyOn(storage, 'remove');
    const sign = vi
      .spyOn(storage, 'createReadUrl')
      .mockImplementationOnce(async (...args) => {
        const url = await originalSign(...args);
        await request(http)
          .delete(`/api/v1/assets/${image.assetId}`)
          .auth(actor.token, { type: 'bearer' })
          .expect(204);
        return url;
      });
    try {
      const response = await request(http)
        .get(`/api/v1/assets/${image.assetId}`)
        .auth(actor.token, { type: 'bearer' })
        .expect(404);
      expect(response.body.data).toBeNull();
      expect(sign).toHaveBeenCalledOnce();
      expect(remove).toHaveBeenCalledOnce();
      await objectState(image.assetId, 'deleted', image.url);
    } finally {
      sign.mockRestore();
      remove.mockRestore();
    }
  });

  for (const mutation of [
    'account-disabled',
    'role-disabled',
    'membership-removed',
    'grant-removed',
    'permission-disabled',
  ] as const) {
    it(`keeps the owned ready object intact when ${mutation} occurs after delete preparation`, async () => {
      const actor = await uploadActor(),
        image = await upload(actor, `delete-${mutation}`);
      const repository = app.get(PrismaAssetRepository),
        storage = app.get(S3AssetStorage);
      const original = repository.deleteIfUnreferenced.bind(repository);
      const permission = await prisma.permission.findUniqueOrThrow({
        where: { PermissionKey: 'asset:delete-own' },
      });
      const remove = vi.spyOn(storage, 'remove');
      const command = vi
        .spyOn(repository, 'deleteIfUnreferenced')
        .mockImplementationOnce(async (...args) => {
          if (mutation === 'account-disabled')
            await prisma.user.update({
              where: { UserId: actor.id },
              data: { Status: 'disabled' },
            });
          else if (mutation === 'role-disabled')
            await prisma.role.update({
              where: { RoleId: actor.roleId },
              data: { Status: 'disabled' },
            });
          else if (mutation === 'membership-removed')
            await prisma.userRole.deleteMany({ where: { UserId: actor.id } });
          else if (mutation === 'grant-removed')
            await prisma.rolePermission.deleteMany({
              where: {
                RoleId: actor.roleId,
                PermissionId: permission.PermissionId,
              },
            });
          else
            await prisma.permission.update({
              where: { PermissionId: permission.PermissionId },
              data: { Status: 'disabled' },
            });
          return original(...args);
        });
      try {
        const response = await request(http)
          .delete(`/api/v1/assets/${image.assetId}`)
          .auth(actor.token, { type: 'bearer' })
          .expect(403);
        expect(response.body.data).toBeNull();
        expect(command).toHaveBeenCalledOnce();
        expect(remove).not.toHaveBeenCalled();
        await objectState(image.assetId, 'ready', image.url);
        await noAudit(actor.id);
      } finally {
        command.mockRestore();
        remove.mockRestore();
        if (mutation === 'permission-disabled')
          await prisma.permission.update({
            where: { PermissionId: permission.PermissionId },
            data: { Status: 'active' },
          });
      }
    });
  }

  it('honors read-only and delete-only grants independently without upload or management permissions', async () => {
    const actor = await uploadActor(),
      image = await upload(actor, 'independent-owned-grants');
    const read = await prisma.permission.findUniqueOrThrow({
      where: { PermissionKey: 'asset:read-own' },
    });
    const del = await prisma.permission.findUniqueOrThrow({
      where: { PermissionKey: 'asset:delete-own' },
    });
    await prisma.rolePermission.deleteMany({
      where: { RoleId: actor.roleId, PermissionId: { not: read.PermissionId } },
    });
    const response = await request(http)
      .get(`/api/v1/assets/${image.assetId}`)
      .auth(actor.token, { type: 'bearer' })
      .expect(200);
    await objectState(image.assetId, 'ready', response.body.data.url as string);
    await request(http)
      .delete(`/api/v1/assets/${image.assetId}`)
      .auth(actor.token, { type: 'bearer' })
      .expect(403);
    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { RoleId: actor.roleId } }),
      prisma.rolePermission.create({
        data: { RoleId: actor.roleId, PermissionId: del.PermissionId },
      }),
    ]);
    await request(http)
      .get(`/api/v1/assets/${image.assetId}`)
      .auth(actor.token, { type: 'bearer' })
      .expect(403);
    await request(http)
      .delete(`/api/v1/assets/${image.assetId}`)
      .auth(actor.token, { type: 'bearer' })
      .expect(204);
    await objectState(image.assetId, 'deleted', image.url);
  });

  it('denies pending creation after Guard authorization is revoked without scanning or storing', async () => {
    const actor = await uploadActor(),
      repository = app.get(PrismaAssetRepository);
    const original = repository.createPending.bind(repository);
    const scanner = vi.spyOn(app.get(ClamAvAssetScanner), 'scan');
    const put = vi.spyOn(app.get(S3AssetStorage), 'put');
    const create = vi
      .spyOn(repository, 'createPending')
      .mockImplementationOnce(async (input) => {
        await prisma.userRole.deleteMany({ where: { UserId: actor.id } });
        return original(input);
      });
    try {
      const response = await request(http)
        .post('/api/v1/assets')
        .auth(actor.token, { type: 'bearer' })
        .attach('file', png, `${prefix}-revoke-before-pending.png`)
        .expect(403);
      expect(response.body.data).toBeNull();
      expect(create).toHaveBeenCalledOnce();
      expect(scanner).not.toHaveBeenCalled();
      expect(put).not.toHaveBeenCalled();
      expect(
        await prisma.asset.count({ where: { OwnerUserId: actor.id } }),
      ).toBe(0);
    } finally {
      create.mockRestore();
      scanner.mockRestore();
      put.mockRestore();
    }
  });

  for (const mutation of [
    'account-disabled',
    'role-disabled',
    'membership-removed',
    'grant-removed',
    'permission-disabled',
  ] as const) {
    it(`rejects ready after ${mutation} during actual scan or S3 PUT and compensates the real object`, async () => {
      const actor = await uploadActor(),
        storage = app.get(S3AssetStorage),
        scanner = app.get(ClamAvAssetScanner);
      const originalScan = scanner.scan.bind(scanner),
        originalPut = storage.put.bind(storage);
      const scan = vi.spyOn(scanner, 'scan'),
        put = vi.spyOn(storage, 'put'),
        remove = vi.spyOn(storage, 'remove');
      const sign = vi.spyOn(storage, 'createReadUrl');
      const filename = `${prefix}-${mutation}.png`;
      const mutate = async () => {
        if (mutation === 'account-disabled')
          await prisma.user.update({
            where: { UserId: actor.id },
            data: { Status: 'disabled' },
          });
        else if (mutation === 'role-disabled')
          await prisma.role.update({
            where: { RoleId: actor.roleId },
            data: { Status: 'disabled' },
          });
        else if (mutation === 'membership-removed')
          await prisma.userRole.deleteMany({ where: { UserId: actor.id } });
        else if (mutation === 'grant-removed')
          await prisma.rolePermission.deleteMany({
            where: {
              RoleId: actor.roleId,
              PermissionId: actor.uploadPermissionId,
            },
          });
        else
          await prisma.permission.update({
            where: { PermissionId: actor.uploadPermissionId },
            data: { Status: 'disabled' },
          });
      };
      // Every scanner/SDK invocation remains real. The observer commits a
      // deterministic authorization change after that actual operation returns.
      if (mutation === 'account-disabled' || mutation === 'permission-disabled')
        scan.mockImplementationOnce(async (bytes) => {
          const result = await originalScan(bytes);
          await mutate();
          return result;
        });
      else
        put.mockImplementationOnce(async (input) => {
          await originalPut(input);
          await mutate();
        });
      try {
        const response = await request(http)
          .post('/api/v1/assets')
          .auth(actor.token, { type: 'bearer' })
          .attach('file', png, filename)
          .expect(403);
        expect(response.body.data).toBeNull();
        expect(JSON.stringify(response.body)).not.toContain('X-Amz');
        const row = await prisma.asset.findFirstOrThrow({
          where: { OwnerUserId: actor.id, OriginalName: filename },
        });
        expect(row.Status).toBe('rejected');
        expect(scan).toHaveBeenCalledOnce();
        expect(put).toHaveBeenCalledOnce();
        expect(remove).toHaveBeenCalledOnce();
        expect(remove).toHaveBeenCalledWith(row.StorageKey);
        expect(sign).not.toHaveBeenCalled();
        await objectState(String(row.AssetId), 'rejected');
        await noAudit(actor.id);
      } finally {
        scan.mockRestore();
        put.mockRestore();
        remove.mockRestore();
        sign.mockRestore();
        if (mutation === 'permission-disabled')
          await prisma.permission.update({
            where: { PermissionId: actor.uploadPermissionId },
            data: { Status: 'active' },
          });
      }
    });
  }

  it('uploads through multiple configurable roles without requiring merchant or management identities', async () => {
    const actor = await uploadActor();
    const readPermission = await prisma.permission.findUniqueOrThrow({
      where: { PermissionKey: 'asset:read-own' },
    });
    const second = await prisma.role.create({
      data: {
        RoleKey: `${prefix}-reader-${roles.length}`,
        RoleName: 'Independent reader',
        DataScope: 'all',
        RolePermissions: {
          create: { PermissionId: readPermission.PermissionId },
        },
        UserRoles: { create: { UserId: actor.id } },
      },
    });
    roles.push(second.RoleId);
    expect(
      await prisma.merchantProfile.count({ where: { UserId: actor.id } }),
    ).toBe(0);
    const response = await upload(actor, 'multiple-custom-roles');
    expect(response.status).toBe('ready');
    await objectState(response.assetId, 'ready', response.url);
  });

  for (const operation of ['list', 'detail'] as const) {
    for (const mutation of [
      'account',
      'role',
      'read-grant',
      'portal',
      'scope',
      'owner',
    ] as const) {
      it(`withholds admin ${operation} after real signing and ${mutation} change`, async () => {
        const actor = await operator('all'),
          name = `admin-read-${operation}-${mutation}`;
        const image = await upload(owner, name),
          row = await prisma.asset.findUniqueOrThrow({
            where: { AssetId: BigInt(image.assetId) },
          });
        const storage = app.get(S3AssetStorage),
          original = storage.createReadUrl.bind(storage);
        let captured = '';
        const hook = vi
          .spyOn(storage, 'createReadUrl')
          .mockImplementation(async (key, ttl) => {
            const url = await original(key, ttl);
            if (key !== row.StorageKey) return url;
            captured = url;
            if (mutation === 'account')
              await prisma.user.update({
                where: { UserId: actor.id },
                data: { Status: 'disabled' },
              });
            if (mutation === 'role')
              await prisma.role.update({
                where: { RoleId: actor.roleId },
                data: { Status: 'disabled' },
              });
            if (mutation === 'read-grant' || mutation === 'portal') {
              const permission = await prisma.permission.findUniqueOrThrow({
                where: {
                  PermissionKey:
                    mutation === 'portal'
                      ? 'management:portal:enter'
                      : 'content:asset:list',
                },
              });
              await prisma.rolePermission.delete({
                where: {
                  RoleId_PermissionId: {
                    RoleId: actor.roleId,
                    PermissionId: permission.PermissionId,
                  },
                },
              });
            }
            if (mutation === 'scope')
              await prisma.roleDataScope.updateMany({
                where: { RoleId: actor.roleId, ResourceKey: 'asset' },
                data: { ScopeType: 'self' },
              });
            if (mutation === 'owner')
              await prisma.asset.update({
                where: { AssetId: row.AssetId },
                data: { OwnerUserId: other.id },
              });
            return url;
          });
        try {
          const query = request(http).get(
            operation === 'list'
              ? '/api/v1/admin/assets'
              : `/api/v1/admin/assets/${image.assetId}`,
          );
          if (operation === 'list')
            query.query({ keyword: `${prefix}-${name}` });
          const response = await query
            .auth(actor.token, { type: 'bearer' })
            .expect(mutation === 'owner' ? 404 : 403);
          expect(captured).toContain('X-Amz-Signature');
          expect(JSON.stringify(response.body)).not.toContain(
            'X-Amz-Signature',
          );
          await objectState(image.assetId, 'ready', captured);
          await noAudit(actor.id);
        } finally {
          hook.mockRestore();
        }
      });
    }
    it(`rechecks admin ${operation} after Guard before any signing`, async () => {
      const actor = await operator('all'),
        image = await upload(owner, `admin-before-${operation}`);
      const repository = app.get(PrismaAssetRepository),
        original = repository.verifyReadAccess.bind(repository);
      const sign = vi.spyOn(app.get(S3AssetStorage), 'createReadUrl');
      const hook = vi
        .spyOn(repository, 'verifyReadAccess')
        .mockImplementationOnce(async (input) => {
          await prisma.userRole.deleteMany({ where: { UserId: actor.id } });
          return original(input);
        });
      try {
        const query = request(http).get(
          operation === 'list'
            ? '/api/v1/admin/assets'
            : `/api/v1/admin/assets/${image.assetId}`,
        );
        if (operation === 'list')
          query.query({ keyword: `${prefix}-admin-before-${operation}` });
        await query.auth(actor.token, { type: 'bearer' }).expect(403);
        expect(sign).not.toHaveBeenCalled();
        await objectState(image.assetId, 'ready', image.url);
        await noAudit(actor.id);
      } finally {
        hook.mockRestore();
        sign.mockRestore();
      }
    });
    it(`withholds admin ${operation} when actual owned deletion completes during signing`, async () => {
      const actor = await operator('all'),
        name = `admin-deleted-${operation}`,
        image = await upload(owner, name);
      const storage = app.get(S3AssetStorage),
        original = storage.createReadUrl.bind(storage);
      const row = await prisma.asset.findUniqueOrThrow({
        where: { AssetId: BigInt(image.assetId) },
      });
      const hook = vi
        .spyOn(storage, 'createReadUrl')
        .mockImplementation(async (key, ttl) => {
          const url = await original(key, ttl);
          if (key === row.StorageKey)
            await request(http)
              .delete(`/api/v1/assets/${image.assetId}`)
              .auth(owner.token, { type: 'bearer' })
              .expect(204);
          return url;
        });
      try {
        const query = request(http).get(
          operation === 'list'
            ? '/api/v1/admin/assets'
            : `/api/v1/admin/assets/${image.assetId}`,
        );
        if (operation === 'list') query.query({ keyword: `${prefix}-${name}` });
        const response = await query
          .auth(actor.token, { type: 'bearer' })
          .expect(404);
        expect(JSON.stringify(response.body)).not.toContain('X-Amz-Signature');
        await objectState(image.assetId, 'deleted', image.url);
      } finally {
        hook.mockRestore();
      }
    });
  }
  it('rechecks authorization even when the admin inventory is empty', async () => {
    const actor = await operator('all'),
      repository = app.get(PrismaAssetRepository),
      original = repository.findPage.bind(repository);
    const hook = vi
      .spyOn(repository, 'findPage')
      .mockImplementationOnce(async (input) => {
        const result = await original(input);
        expect(result).toEqual({ items: [], total: 0 });
        await prisma.role.update({
          where: { RoleId: actor.roleId },
          data: { Status: 'disabled' },
        });
        return result;
      });
    try {
      await request(http)
        .get('/api/v1/admin/assets')
        .query({ keyword: `${prefix}-never-created` })
        .auth(actor.token, { type: 'bearer' })
        .expect(403);
    } finally {
      hook.mockRestore();
    }
  });

  it('applies self scope to real signed inventory, pagination and owner filters without exposing other objects', async () => {
    const actor = await operator('self');
    const keyword = `${prefix}-self`;
    const a = await upload(actor, 'self-a'),
      b = await upload(actor, 'self-b');
    const outside = await upload(owner, 'self-outside');
    const first = await request(http)
      .get('/api/v1/admin/assets')
      .query({ keyword, pageSize: 1 })
      .auth(actor.token, { type: 'bearer' })
      .expect(200);
    expect(first.body.data).toMatchObject({
      total: 2,
      page: 1,
      pageSize: 1,
      hasNext: true,
    });
    expect(
      first.body.data.items.map((v: { assetId: string }) => v.assetId),
    ).toEqual([b.assetId]);
    await objectState(b.assetId, 'ready', first.body.data.items[0].url);
    const next = await request(http)
      .get('/api/v1/admin/assets')
      .query({ keyword, pageSize: 1, page: 2 })
      .auth(actor.token, { type: 'bearer' })
      .expect(200);
    expect(next.body.data).toMatchObject({ total: 2, hasNext: false });
    expect(next.body.data.items[0].assetId).toBe(a.assetId);
    const filtered = await request(http)
      .get('/api/v1/admin/assets')
      .query({ keyword, ownerUserId: owner.id })
      .auth(actor.token, { type: 'bearer' })
      .expect(200);
    expect(filtered.body.data).toMatchObject({ items: [], total: 0 });
    for (const method of ['get', 'delete'] as const) {
      const denied = await request(http)
        [method](`/api/v1/admin/assets/${outside.assetId}`)
        .auth(actor.token, { type: 'bearer' })
        .expect(404);
      expect(JSON.stringify(denied.body)).not.toContain('X-Amz-Signature');
    }
    await objectState(outside.assetId, 'ready', outside.url);
    await noAudit(actor.id);
  });

  it('allows only selected IDs across owners and physically deletes one with exactly one transactional audit', async () => {
    const a = await upload(owner, 'selected-a'),
      b = await upload(other, 'selected-b');
    const outside = await upload(owner, 'selected-outside');
    const actor = await operator('selected', [
      Number(a.assetId),
      Number(b.assetId),
    ]);
    const list = await request(http)
      .get('/api/v1/admin/assets')
      .query({ keyword: `${prefix}-selected` })
      .auth(actor.token, { type: 'bearer' })
      .expect(200);
    expect(list.body.data.total).toBe(2);
    expect(
      list.body.data.items.map((v: { assetId: string }) => v.assetId).sort(),
    ).toEqual([a.assetId, b.assetId].sort());
    for (const item of list.body.data.items)
      await objectState(item.assetId, 'ready', item.url);
    for (const method of ['get', 'delete'] as const)
      await request(http)
        [method](`/api/v1/admin/assets/${outside.assetId}`)
        .auth(actor.token, { type: 'bearer' })
        .expect(404);
    await request(http)
      .get('/api/v1/admin/assets')
      .query({ selectedIds: outside.assetId })
      .auth(actor.token, { type: 'bearer' })
      .expect(400);
    const deleted = await request(http)
      .delete(`/api/v1/admin/assets/${a.assetId}`)
      .auth(actor.token, { type: 'bearer' })
      .expect(204);
    await objectState(a.assetId, 'deleted', a.url);
    await objectState(b.assetId, 'ready', b.url);
    await objectState(outside.assetId, 'ready', outside.url);
    const audits = await prisma.operationLog.findMany({
      where: { ActorUserId: actor.id },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      ActionKey: 'content:asset:delete',
      ResourceKey: 'asset',
      TargetId: a.assetId,
      Result: 'success',
      TraceId: deleted.headers['x-trace-id'],
    });
  });

  it('uses an ordinary configurable all-scope role to read foreign images and exposes deleted metadata without a URL', async () => {
    const actor = await operator('all'),
      image = await upload(other, 'all-target');
    const detail = await request(http)
      .get(`/api/v1/admin/assets/${image.assetId}`)
      .auth(actor.token, { type: 'bearer' })
      .expect(200);
    expect(detail.body.data).toMatchObject({
      assetId: image.assetId,
      ownerUserId: other.id,
      status: 'ready',
    });
    expect(detail.body.data.url).toContain('X-Amz-Expires=900');
    expect(detail.body.data).not.toHaveProperty('storageKey');
    await objectState(image.assetId, 'ready', detail.body.data.url);
    await request(http)
      .delete(`/api/v1/admin/assets/${image.assetId}`)
      .auth(actor.token, { type: 'bearer' })
      .expect(204);
    await objectState(image.assetId, 'deleted', detail.body.data.url);
    const deleted = await request(http)
      .get(`/api/v1/admin/assets/${image.assetId}`)
      .auth(actor.token, { type: 'bearer' })
      .expect(200);
    expect(deleted.body.data).toMatchObject({ status: 'deleted', url: null });
    const list = await request(http)
      .get('/api/v1/admin/assets')
      .query({ status: 'deleted', keyword: `${prefix}-all-target` })
      .auth(actor.token, { type: 'bearer' })
      .expect(200);
    expect(list.body.data).toMatchObject({
      total: 1,
      items: [{ assetId: image.assetId, status: 'deleted', url: null }],
    });
    expect(
      await prisma.operationLog.count({ where: { ActorUserId: actor.id } }),
    ).toBe(1);
  });

  it('preserves real referenced avatar bytes and creates no success audit when admin deletion is rejected', async () => {
    const actor = await operator('all'),
      image = await upload(owner, 'referenced-avatar');
    await prisma.user.update({
      where: { UserId: owner.id },
      data: { AvatarAssetId: BigInt(image.assetId) },
    });
    try {
      const detail = await request(http)
        .get(`/api/v1/admin/assets/${image.assetId}`)
        .auth(actor.token, { type: 'bearer' })
        .expect(200);
      expect(detail.body.data.references.userAvatars).toBe(1);
      await request(http)
        .delete(`/api/v1/admin/assets/${image.assetId}`)
        .auth(actor.token, { type: 'bearer' })
        .expect(422);
      await objectState(image.assetId, 'ready', image.url);
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { UserId: owner.id } }))
          .AvatarAssetId,
      ).toBe(BigInt(image.assetId));
      await noAudit(actor.id);
    } finally {
      await prisma.user.update({
        where: { UserId: owner.id },
        data: { AvatarAssetId: null },
      });
    }
  });

  it('rechecks role revocation for an already-issued token and leaves actual objects untouched', async () => {
    const actor = await operator('all'),
      image = await upload(owner, 'revoked-target');
    await request(http)
      .get(`/api/v1/admin/assets/${image.assetId}`)
      .auth(actor.token, { type: 'bearer' })
      .expect(200);
    await prisma.role.update({
      where: { RoleId: actor.roleId },
      data: { Status: 'disabled' },
    });
    for (const method of ['get', 'delete'] as const)
      await request(http)
        [method](`/api/v1/admin/assets/${image.assetId}`)
        .auth(actor.token, { type: 'bearer' })
        .expect(403);
    await objectState(image.assetId, 'ready', image.url);
    await noAudit(actor.id);
  });

  it('rejects missing management entry, unsupported merchant scope and conflicting roles before touching real storage', async () => {
    const image = await upload(owner, 'denied-target');
    const noPortal = await operator('all', [], false),
      merchant = await operator('merchant'),
      conflict = await operator('self');
    expect(
      await prisma.merchantProfile.findUniqueOrThrow({
        where: { UserId: merchant.id },
      }),
    ).toMatchObject({ Status: 'active' });
    const second = await prisma.role.findUniqueOrThrow({
      where: { RoleId: noPortal.roleId },
    });
    await prisma.userRole.create({
      data: { UserId: conflict.id, RoleId: second.RoleId },
    });
    for (const actor of [noPortal, merchant, conflict]) {
      await request(http)
        .get('/api/v1/admin/assets')
        .auth(actor.token, { type: 'bearer' })
        .expect(403);
      for (const method of ['get', 'delete'] as const)
        await request(http)
          [method](`/api/v1/admin/assets/${image.assetId}`)
          .auth(actor.token, { type: 'bearer' })
          .expect(403);
      await noAudit(actor.id);
    }
    await objectState(image.assetId, 'ready', image.url);
  });

  it('rolls back an admin delete on actual audit insertion failure and keeps the MinIO object downloadable', async () => {
    const actor = await operator('all'),
      image = await upload(owner, 'audit-rollback');
    const trigger = `storage_audit_${randomUUID().replaceAll('-', '')}`;
    // Both SQL identifiers and target digits are generated inside this disposable fixture.
    await prisma.$executeRawUnsafe(`CREATE FUNCTION "${trigger}"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW."ActionKey"='content:asset:delete' AND NEW."TargetId"='${image.assetId}' THEN
          RAISE EXCEPTION 'storage audit rollback injection';
        END IF;
        RETURN NEW;
      END $$`);
    try {
      await prisma.$executeRawUnsafe(
        `CREATE TRIGGER "${trigger}" BEFORE INSERT ON "OperationLog" FOR EACH ROW EXECUTE FUNCTION "${trigger}"()`,
      );
      await request(http)
        .delete(`/api/v1/admin/assets/${image.assetId}`)
        .auth(actor.token, { type: 'bearer' })
        .expect(500);
      await objectState(image.assetId, 'ready', image.url);
      await noAudit(actor.id);
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS "${trigger}" ON "OperationLog"`,
      );
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${trigger}"()`);
    }
  });
  it('uses real multipart/scanner/storage and issues a 900-second URL that downloads exact private bytes', async () => {
    const result = await request(http)
      .post('/api/v1/assets')
      .auth(owner.token, { type: 'bearer' })
      .attach('file', png, `${prefix}.png`)
      .expect(201);
    asset = result.body.data;
    const row = await prisma.asset.findUniqueOrThrow({
      where: { AssetId: BigInt(asset.assetId) },
    });
    key = row.StorageKey;
    expect(row).toMatchObject({
      OwnerUserId: owner.id,
      Status: 'ready',
      MimeType: 'image/png',
      SizeBytes: BigInt(png.length),
      Sha256: createHash('sha256').update(png).digest('hex'),
    });
    const url = new URL(asset.url);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
    const response = await fetch(url);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
  });
  it('denies unsigned reads and cryptographically rejects a modified signature or object path', async () => {
    const unsigned = new URL(asset.url);
    unsigned.search = '';
    expect((await fetch(unsigned)).status).toBe(403);
    const tampered = new URL(asset.url),
      signature = tampered.searchParams.get('X-Amz-Signature')!;
    tampered.searchParams.set(
      'X-Amz-Signature',
      (signature[0] === '0' ? '1' : '0') + signature.slice(1),
    );
    expect((await fetch(tampered)).status).toBe(403);
    const moved = new URL(asset.url);
    moved.pathname += '.other';
    expect((await fetch(moved)).status).toBe(403);
  });
  it('enforces expired signatures at the real storage service', async () => {
    const expired = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: bucket, Key: key }),
      { expiresIn: 900, signingDate: new Date(Date.now() - 20 * 60 * 1000) },
    );
    const response = await fetch(expired);
    expect(response.status).toBe(403);
    expect(await response.text()).toContain('expired');
  });
  it('only lets the owner request a new capability URL or delete the asset', async () => {
    const read = await request(http)
      .get(`/api/v1/assets/${asset.assetId}`)
      .auth(owner.token, { type: 'bearer' })
      .expect(200);
    expect((await fetch(read.body.data.url as string)).status).toBe(200);
    await request(http)
      .get(`/api/v1/assets/${asset.assetId}`)
      .auth(other.token, { type: 'bearer' })
      .expect(404);
    await request(http)
      .delete(`/api/v1/assets/${asset.assetId}`)
      .auth(other.token, { type: 'bearer' })
      .expect(404);
    await expect(
      s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key })),
    ).resolves.toMatchObject({ ContentLength: png.length });
  });

  it('signs for the configured public host when it differs from the internal storage host', async () => {
    const previous = process.env.S3_PUBLIC_ENDPOINT;
    const publicEndpoint = new URL(previous!);
    publicEndpoint.hostname =
      publicEndpoint.hostname === 'localhost' ? '127.0.0.1' : 'localhost';
    process.env.S3_PUBLIC_ENDPOINT = publicEndpoint.origin;
    try {
      const read = await request(http)
        .get(`/api/v1/assets/${asset.assetId}`)
        .auth(owner.token, { type: 'bearer' })
        .expect(200);
      const url = new URL(read.body.data.url as string);
      expect(url.origin).toBe(publicEndpoint.origin);
      const response = await fetch(url);
      expect(response.status).toBe(200);
      expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
    } finally {
      process.env.S3_PUBLIC_ENDPOINT = previous;
    }
  });
  it('keeps a referenced avatar object and database row ready when deletion is rejected', async () => {
    await prisma.user.update({
      where: { UserId: owner.id },
      data: { AvatarAssetId: BigInt(asset.assetId) },
    });
    try {
      await request(http)
        .delete(`/api/v1/assets/${asset.assetId}`)
        .auth(owner.token, { type: 'bearer' })
        .expect(422);
      expect((await fetch(asset.url)).status).toBe(200);
      expect(
        await prisma.asset.findUniqueOrThrow({
          where: { AssetId: BigInt(asset.assetId) },
        }),
      ).toMatchObject({ Status: 'ready' });
    } finally {
      await prisma.user.update({
        where: { UserId: owner.id },
        data: { AvatarAssetId: null },
      });
    }
  });
  it('initializes an existing bucket without changing private access or stored object bytes', async () => {
    await promisify(execFile)(
      process.execPath,
      ['--import', 'tsx', 'scripts/init-asset-storage.ts'],
      { timeout: 15_000 },
    );
    const response = await fetch(asset.url);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
    const unsigned = new URL(asset.url);
    unsigned.search = '';
    expect((await fetch(unsigned)).status).toBe(403);
  });
  it('fails initialization with invalid credentials without changing objects or bucket policy', async () => {
    await expect(
      promisify(execFile)(
        process.execPath,
        ['--import', 'tsx', 'scripts/init-asset-storage.ts'],
        {
          timeout: 15_000,
          env: {
            ...process.env,
            S3_SECRET_ACCESS_KEY: 'invalid-test-only-secret',
          },
        },
      ),
    ).rejects.toMatchObject({ code: 1 });
    expect((await fetch(asset.url)).status).toBe(200);
  });
  it('rejects the harmless marked image using the real scanner and test-only definition without storing an object', async () => {
    const filename = `${prefix}-av-test.png`;
    await request(http)
      .post('/api/v1/assets')
      .auth(owner.token, { type: 'bearer' })
      .attach('file', markedPng, filename)
      .expect(422);
    const rejected = await prisma.asset.findFirstOrThrow({
      where: { OwnerUserId: owner.id, OriginalName: filename },
    });
    expect(rejected.Status).toBe('rejected');
    await expect(
      s3.send(
        new HeadObjectCommand({ Bucket: bucket, Key: rejected.StorageKey }),
      ),
    ).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
    await request(http)
      .get(`/api/v1/assets/${rejected.AssetId}`)
      .auth(owner.token, { type: 'bearer' })
      .expect(404);
  });
  it('physically removes an unreferenced private object and invalidates previously issued URLs', async () => {
    await request(http)
      .delete(`/api/v1/assets/${asset.assetId}`)
      .auth(owner.token, { type: 'bearer' })
      .expect(204);
    expect(
      await prisma.asset.findUniqueOrThrow({
        where: { AssetId: BigInt(asset.assetId) },
      }),
    ).toMatchObject({ Status: 'deleted' });
    await expect(
      s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key })),
    ).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
    expect((await fetch(asset.url)).status).toBe(404);
    await request(http)
      .get(`/api/v1/assets/${asset.assetId}`)
      .auth(owner.token, { type: 'bearer' })
      .expect(404);
  });
});
