import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import type { AuthorizationPrincipal } from '../../domain/authorization.js';
import type { ResolveAuthorizationPrincipal } from '../../application/resolve-authorization-principal.js';
import {
  MANAGEMENT_ROUTE_METADATA,
  MANAGEMENT_ENTRY_ONLY_METADATA,
  PUBLIC_ROUTE_METADATA,
  REQUIRED_PERMISSIONS_METADATA,
  RESOURCE_SCOPE_METADATA,
} from './authorization.decorators.js';
import { AuthorizationGuard } from './authorization.guard.js';

const principal: AuthorizationPrincipal = {
  userId: 42,
  active: true,
  merchantId: 13,
  roles: [
    {
      roleKey: 'resort_operator',
      active: true,
      dataScope: 'merchant',
      permissionKeys: ['management:portal:enter', 'resort:merchant:list'],
    },
  ],
};

function createGuard(
  options?: {
    isPublic?: boolean;
    isManagement?: boolean;
    permissions?: readonly string[];
    resourceKey?: string;
    entryOnly?: boolean;
  },
  resolvedPrincipal: AuthorizationPrincipal | null = principal,
) {
  const reflector = {
    getAllAndOverride: vi.fn((key: string) => {
      if (key === PUBLIC_ROUTE_METADATA) return options?.isPublic;
      if (key === MANAGEMENT_ROUTE_METADATA) return options?.isManagement;
      if (key === MANAGEMENT_ENTRY_ONLY_METADATA) return options?.entryOnly;
      if (key === REQUIRED_PERMISSIONS_METADATA) return options?.permissions;
      if (key === RESOURCE_SCOPE_METADATA) return options?.resourceKey;
      return undefined;
    }),
  } as unknown as Reflector;
  const execute = vi.fn().mockResolvedValue(resolvedPrincipal);
  const resolver = { execute } as unknown as ResolveAuthorizationPrincipal;
  const guard = new AuthorizationGuard(reflector, resolver);
  const request: {
    authenticatedUserId?: number;
    user?: AuthorizationPrincipal | null;
    authorizationDataScopes?: Readonly<Record<string, unknown>>;
  } = {};
  const context = {
    getHandler: vi.fn(),
    getClass: vi.fn(),
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;
  return { guard, context, request, reflector, execute };
}

describe('AuthorizationGuard', () => {
  it('allows explicit entry-only aggregation without resolving conflicting portal scopes', async () => {
    const { guard, context, request } = createGuard(
      { isManagement: true, permissions: [], entryOnly: true },
      {
        ...principal,
        roles: [
          ...principal.roles,
          { ...principal.roles[0]!, roleKey: 'another', dataScope: 'self' },
        ],
      },
    );
    request.authenticatedUserId = 42;
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.authorizationDataScopes).toEqual({});
  });
  it('entry-only metadata cannot authorize an ordinary or unconfigured route', async () => {
    for (const options of [
      { entryOnly: true, permissions: [] },
      { entryOnly: true, isManagement: true },
    ]) {
      const { guard, context, request } = createGuard(options);
      request.authenticatedUserId = 42;
      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    }
  });
  it('allows only explicitly public routes without resolving an identity', async () => {
    const { guard, context, execute } = createGuard({ isPublic: true });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(execute).not.toHaveBeenCalled();
  });

  it('fails closed when a route has no explicit authorization metadata', async () => {
    const { guard, context } = createGuard();

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('resolves permissions from the server identity instead of trusting request.user', async () => {
    const { guard, context, request, execute } = createGuard({
      permissions: ['resort:merchant:list'],
    });
    request.user = {
      ...principal,
      roles: [
        {
          roleKey: 'system_admin',
          active: true,
          dataScope: 'all',
          permissionKeys: ['*'],
        },
      ],
    };

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(execute).not.toHaveBeenCalled();

    request.authenticatedUserId = 42;
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(execute).toHaveBeenCalledWith(42);
    expect(request.user).toEqual(principal);
    expect(request.authorizationDataScopes).toEqual({
      'resort:merchant:list': { kind: 'merchant', merchantId: 13 },
    });
  });

  it('returns 401 for missing identities and 403 for inactive or unauthorized principals', async () => {
    const inactive = { ...principal, active: false };
    const inactiveGuard = createGuard(
      { permissions: ['resort:merchant:list'] },
      inactive,
    );
    inactiveGuard.request.authenticatedUserId = 42;
    await expect(
      inactiveGuard.guard.canActivate(inactiveGuard.context),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const missingGuard = createGuard(
      { permissions: ['resort:merchant:list'] },
      null,
    );
    missingGuard.request.authenticatedUserId = 42;
    await expect(
      missingGuard.guard.canActivate(missingGuard.context),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const unauthorizedGuard = createGuard({
      permissions: ['resort:merchant:update'],
    });
    unauthorizedGuard.request.authenticatedUserId = 42;
    await expect(
      unauthorizedGuard.guard.canActivate(unauthorizedGuard.context),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a resolved principal that does not match the authenticated subject', async () => {
    const { guard, context, request } = createGuard(
      { permissions: ['resort:merchant:list'] },
      { ...principal, userId: 99 },
    );
    request.authenticatedUserId = 42;

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects permissions with conflicting role scopes', async () => {
    const conflictingPrincipal: AuthorizationPrincipal = {
      ...principal,
      roles: [
        {
          roleKey: 'resort_operator',
          active: true,
          dataScope: 'merchant',
          permissionKeys: ['content:dynamic:list'],
        },
        {
          roleKey: 'user',
          active: true,
          dataScope: 'self',
          permissionKeys: ['content:dynamic:list'],
        },
      ],
    };
    const { guard, context, request } = createGuard(
      { permissions: ['content:dynamic:list'] },
      conflictingPrincipal,
    );
    request.authenticatedUserId = 42;

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(request.authorizationDataScopes).toBeUndefined();
  });

  it('requires an explicit portal-entry grant and endpoint scope on management routes', async () => {
    const { guard, context, request, execute } = createGuard({
      isManagement: true,
      permissions: ['resort:merchant:list'],
    });
    request.authenticatedUserId = 42;
    await expect(guard.canActivate(context)).resolves.toBe(true);

    execute.mockResolvedValueOnce({
      ...principal,
      merchantId: null,
      roles: [
        {
          roleKey: 'user',
          active: true,
          dataScope: 'self',
          permissionKeys: ['resort:merchant:list'],
        },
      ],
    });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('resolves and stores the resource scope named by route metadata', async () => {
    const selectedPrincipal: AuthorizationPrincipal = {
      ...principal,
      roles: [
        {
          roleKey: 'resort_operator',
          active: true,
          dataScope: 'all',
          permissionKeys: ['management:portal:enter', 'resort:merchant:list'],
          resourceScopes: [
            {
              resourceKey: 'resort',
              scopeType: 'selected',
              selectedIds: [4, 9],
            },
          ],
        },
      ],
    };
    const { guard, context, request } = createGuard(
      {
        isManagement: true,
        permissions: ['resort:merchant:list'],
        resourceKey: 'resort',
      },
      selectedPrincipal,
    );
    request.authenticatedUserId = 42;

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.authorizationDataScopes).toEqual({
      resort: { kind: 'selected', ids: [4, 9] },
    });
  });

  it('rejects empty or blank permission declarations', async () => {
    for (const permissions of [undefined, [], ['  ']]) {
      const { guard, context } = createGuard({ permissions });
      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    }
  });
});
