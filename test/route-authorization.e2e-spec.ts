import { LOGIN_ATTEMPT_STORE } from '../src/modules/identity-access/application/ports/login-attempt-store.js';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { RequestMethod, type INestApplication } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { MetadataScanner, ModulesContainer, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureHttp } from '../src/shared/http/configure-http.js';
import { createOpenApiDocument } from '../src/shared/http/openapi-document.js';
import { PrismaService } from '../src/shared/persistence/prisma.service.js';
import {
  AUTHORIZATION_PRINCIPAL_READER,
  type AuthorizationPrincipalRecord,
} from '../src/modules/identity-access/application/ports/authorization-principal-reader.js';
import { AUTH_SESSION_REPOSITORY } from '../src/modules/identity-access/application/ports/auth-session-repository.js';
import { AUTH_TOKEN_SERVICE } from '../src/modules/identity-access/application/ports/auth-token-service.js';
import { HmacAuthTokenService } from '../src/modules/identity-access/infrastructure/hmac-auth-token.service.js';
import { SYSTEM_PERMISSION_DEFINITIONS } from '../src/modules/identity-access/domain/permissions.js';
import { AUTHORIZATION_RESOURCES } from '../src/modules/identity-access/domain/authorization-resources.js';
import {
  MANAGEMENT_ENTRY_ONLY_METADATA,
  MANAGEMENT_ROUTE_METADATA,
  PUBLIC_ROUTE_METADATA,
  REQUIRED_PERMISSIONS_METADATA,
  RESOURCE_SCOPE_METADATA,
} from '../src/modules/identity-access/presentation/http/authorization.decorators.js';

// Review additions explicitly: deriving this list from @Public would hide regressions.
const publicRoutes = new Set([
  'GET /api/v1/catalog/{entity}/fields',
  'POST /api/v1/catalog/{entity}/query',
  'GET /api/v1/health',
  'GET /api/v1/auth/csrf',
  'POST /api/v1/auth/register',
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/refresh',
  'POST /api/v1/auth/logout',
  'GET /api/v1/public/config',
  'GET /api/v1/resorts',
  'GET /api/v1/resorts/fit-tags',
  'GET /api/v1/resorts/{id}',
  'GET /api/v1/dynamics',
  'GET /api/v1/dynamics/{id}',
  'GET /api/v1/dynamics/{id}/comments',
  'GET /api/v1/knowledge/categories',
  'GET /api/v1/articles',
  'GET /api/v1/articles/{id}',
]);

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
const methods: readonly Method[] = ['get', 'post', 'put', 'patch', 'delete'];
const contract = JSON.parse(
  readFileSync(new URL('../contracts/openapi.json', import.meta.url), 'utf8'),
) as { paths: Record<string, Partial<Record<Method, unknown>>> };
const routes = Object.entries(contract.paths).flatMap(([path, operations]) =>
  methods
    .filter((method) => operations[method] !== undefined)
    .map((method) => ({
      method,
      path,
      key: `${method.toUpperCase()} ${path}`,
    })),
);
const protectedRoutes = routes.filter(({ key }) => !publicRoutes.has(key));
const allPermissions = SYSTEM_PERMISSION_DEFINITIONS.filter(
  ({ type }) => type === 'api',
).map(({ key }) => ({ key, status: 'active' }));

function principal(): AuthorizationPrincipalRecord {
  return {
    userId: 42,
    status: 'active',
    merchant: null,
    roles: [
      {
        key: 'system_admin',
        status: 'active',
        dataScope: 'all',
        permissions: allPermissions,
      },
    ],
  };
}

describe('Every production HTTP route uses the global authorization chain', () => {
  let app: INestApplication<App>;
  let token: string;
  let sessionActive = true;
  let record: AuthorizationPrincipalRecord | null;
  const findByUserId = vi.fn(async () => record);
  const isActive = vi.fn(async () => sessionActive);
  const transaction = vi.fn(() => {
    throw new Error('Denied requests must not reach persistence');
  });

  beforeAll(async () => {
    vi.stubEnv('OPENAPI_EXPORT', 'true');
    const tokens = new HmacAuthTokenService(
      'route-auth-test-secret-32-bytes-minimum',
    );
    token = tokens.issueAccessToken(42, randomUUID()).token;
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ $transaction: transaction })
      .overrideProvider(LOGIN_ATTEMPT_STORE)
      .useValue({ consume: async () => ({ allowed: true }) })
      .overrideProvider(AUTH_TOKEN_SERVICE)
      .useValue(tokens)
      .overrideProvider(AUTH_SESSION_REPOSITORY)
      .useValue({ isActive })
      .overrideProvider(AUTHORIZATION_PRINCIPAL_READER)
      .useValue({ findByUserId })
      .compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.init();
  });

  beforeEach(() => {
    record = principal();
    sessionActive = true;
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await app?.close();
    vi.unstubAllEnvs();
  });

  it('matches runtime routes to the pinned contract and an explicit public allowlist', () => {
    const reflector = app.get(Reflector);
    const scanner = new MetadataScanner();
    const runtime = new Set<string>();
    const actualPublic = new Set<string>();
    const catalog = new Set(
      SYSTEM_PERMISSION_DEFINITIONS.map(({ key }) => key),
    );
    const resources = new Set<string>(
      AUTHORIZATION_RESOURCES.map(({ resourceKey }) => resourceKey),
    );
    for (const module of app.get(ModulesContainer).values()) {
      for (const controller of module.controllers.values()) {
        const type = controller.metatype;
        if (!type) throw new Error('Controller has no metatype');
        const prototype = type.prototype as Record<
          string,
          (...args: never[]) => unknown
        >;
        for (const name of scanner.getAllMethodNames(prototype)) {
          const handler = prototype[name];
          const method = Reflect.getMetadata(METHOD_METADATA, handler) as
            RequestMethod | undefined;
          if (method === undefined) continue;
          const controllerPath = Reflect.getMetadata(
            PATH_METADATA,
            type,
          ) as string;
          const methodPath = Reflect.getMetadata(
            PATH_METADATA,
            handler,
          ) as string;
          const path = ['api/v1', controllerPath, methodPath]
            .join('/')
            .replace(/\/+/g, '/')
            .replace(/\/$/, '')
            .replace(/:([A-Za-z0-9_]+)/g, '{$1}');
          const key = `${RequestMethod[method]} /${path}`;
          expect(runtime.has(key), `duplicate route ${key}`).toBe(false);
          runtime.add(key);
          const targets = [handler, type];
          const get = <T>(metadata: string) =>
            reflector.getAllAndOverride<T>(metadata, targets);
          if (get<boolean>(PUBLIC_ROUTE_METADATA) === true) {
            actualPublic.add(key);
            continue;
          }
          const permissions = get<readonly string[]>(
            REQUIRED_PERMISSIONS_METADATA,
          );
          const management = get<boolean>(MANAGEMENT_ROUTE_METADATA) === true;
          const entryOnly =
            get<boolean>(MANAGEMENT_ENTRY_ONLY_METADATA) === true;
          expect(permissions, key).toBeDefined();
          expect(
            permissions!.length > 0 || (management && entryOnly),
            key,
          ).toBe(true);
          for (const permission of permissions!) {
            expect(catalog.has(permission), `${key}: ${permission}`).toBe(true);
          }
          const resource = get<string>(RESOURCE_SCOPE_METADATA);
          if (resource !== undefined)
            expect(resources.has(resource), key).toBe(true);
          if (
            path.startsWith('api/v1/admin/') ||
            path.startsWith('api/v1/merchant/')
          ) {
            expect(management, key).toBe(true);
          }
        }
      }
    }
    expect([...runtime].sort()).toEqual(routes.map(({ key }) => key).sort());
    expect([...actualPublic].sort()).toEqual([...publicRoutes].sort());
    const exported = createOpenApiDocument(app);
    expect(Object.keys(exported.paths).sort()).toEqual(
      Object.keys(contract.paths).sort(),
    );
  });

  it.each([
    'anonymous',
    'invalid-token',
    'revoked-session',
    'missing-principal',
    'disabled-account',
    'disabled-role',
    'revoked-grants',
    'disabled-grants',
  ] as const)(
    'rejects %s on every protected route before business execution',
    async (scenario) => {
      if (scenario === 'revoked-session') sessionActive = false;
      if (scenario === 'missing-principal') record = null;
      if (scenario === 'disabled-account')
        record = { ...principal(), status: 'disabled' };
      if (
        ['disabled-role', 'revoked-grants', 'disabled-grants'].includes(
          scenario,
        )
      ) {
        record = {
          ...principal(),
          roles: principal().roles.map((role) => ({
            ...role,
            ...(scenario === 'disabled-role' ? { status: 'disabled' } : {}),
            permissions:
              scenario === 'revoked-grants'
                ? []
                : role.permissions.map((permission) => ({
                    ...permission,
                    status:
                      scenario === 'disabled-grants'
                        ? 'disabled'
                        : permission.status,
                  })),
          })),
        };
      }
      const expected = [
        'anonymous',
        'invalid-token',
        'revoked-session',
        'missing-principal',
      ].includes(scenario)
        ? 401
        : 403;
      for (const route of protectedRoutes) {
        const url = route.path.replace(/\{[^}]+\}/g, '1');
        let pending = request(app.getHttpServer())[route.method](url);
        if (scenario !== 'anonymous') {
          pending = pending.set(
            'authorization',
            `Bearer ${scenario === 'invalid-token' ? 'invalid' : token}`,
          );
        }
        const response = await pending.send({});
        expect(response.status, `${scenario}: ${route.key}`).toBe(expected);
        expect(response.body.traceId, route.key).toBeTruthy();
      }
      if (
        ['anonymous', 'invalid-token', 'revoked-session'].includes(scenario)
      ) {
        expect(findByUserId).not.toHaveBeenCalled();
      } else {
        expect(findByUserId).toHaveBeenCalledTimes(protectedRoutes.length);
      }
      expect(transaction).not.toHaveBeenCalled();
    },
  );

  it('requires the portal grant even when all business permissions remain granted', async () => {
    record = {
      ...principal(),
      roles: principal().roles.map((role) => ({
        ...role,
        permissions: role.permissions.filter(
          ({ key }) => key !== 'management:portal:enter',
        ),
      })),
    };
    for (const route of protectedRoutes.filter(({ path }) =>
      /\/api\/v1\/(admin|merchant)\//.test(path),
    )) {
      const response = await request(app.getHttpServer())
        [route.method](route.path.replace(/\{[^}]+\}/g, '1'))
        .set('authorization', `Bearer ${token}`)
        .send({});
      expect(response.status, route.key).toBe(403);
    }
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rechecks authorization and session state for the same unexpired signed JWT', async () => {
    const read = () =>
      request(app.getHttpServer())
        .get('/api/v1/admin/authorization/resources')
        .set('authorization', `Bearer ${token}`);
    const allowed = await read().expect(200);
    expect(allowed.body.data).toEqual(AUTHORIZATION_RESOURCES);
    record = {
      ...principal(),
      roles: principal().roles.map((role) => ({
        ...role,
        permissions: role.permissions.filter(
          ({ key }) => key !== 'system:role:list',
        ),
      })),
    };
    await read().expect(403);
    record = principal();
    await read().expect(200);
    sessionActive = false;
    await read().expect(401);
    expect(findByUserId).toHaveBeenCalledTimes(3);
    expect(isActive).toHaveBeenCalledTimes(4);
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each(['page=2147483649&pageSize=1', 'page=21474838&pageSize=100'])(
    'returns 400 for an overflowing role page before any Prisma delegate: %s',
    async (query) => {
      await request(app.getHttpServer())
        .get(`/api/v1/admin/roles?${query}`)
        .set('authorization', `Bearer ${token}`)
        .expect(400);
      expect(findByUserId).toHaveBeenCalledExactlyOnceWith(42);
      expect(transaction).not.toHaveBeenCalled();
    },
  );
});
