import { Inject, Injectable } from '@nestjs/common';
import {
  AUTHENTICATION_REPOSITORY,
  type AuthenticationIdentityRecord,
  type AuthenticationRepository,
} from './ports/authentication-repository.js';
import { ResolveAuthorizationPrincipal } from './resolve-authorization-principal.js';
import { GetPermissionTree } from './get-permission-tree.js';
import type { PermissionNode } from '../domain/permission-tree.js';

export interface CurrentUserVO {
  userId: number;
  account: string;
  nickname: string;
  avatarUrl: string | null;
  roles: Array<{ roleKey: string; roleName: string }>;
  permissionKeys: string[];
  menuTree: PermissionNode[];
  merchant: { merchantId: number; businessName: string } | null;
}

export class AuthenticatedUserUnavailableError extends Error {
  constructor() {
    super('Authenticated user is unavailable');
    this.name = 'AuthenticatedUserUnavailableError';
  }
}

@Injectable()
export class GetCurrentUser {
  constructor(
    @Inject(AUTHENTICATION_REPOSITORY)
    private readonly identities: AuthenticationRepository,
    private readonly principals: ResolveAuthorizationPrincipal,
    private readonly permissions: GetPermissionTree,
  ) {}

  async execute(userId: number): Promise<CurrentUserVO> {
    const principal = await this.principals.execute(userId);
    const identity = await this.identities.findByUserId(userId);
    if (!principal?.active || !identity || identity.status !== 'active') {
      throw new AuthenticatedUserUnavailableError();
    }

    return createCurrentUser(
      identity,
      principal.merchantId,
      await this.permissions.execute(),
    );
  }
}

function createCurrentUser(
  identity: AuthenticationIdentityRecord,
  merchantId: number | null,
  permissionTree: PermissionNode[],
): CurrentUserVO {
  const activeRoles = identity.roles.filter(
    ({ status }) => status === 'active',
  );
  const permissionKeys = [
    ...new Set(
      activeRoles.flatMap((role) =>
        role.permissionKeys
          .filter(({ status }) => status === 'active')
          .map(({ key }) => key),
      ),
    ),
  ].sort();
  const allowedPermissions = new Set(permissionKeys);

  return {
    userId: identity.userId,
    account: identity.account,
    nickname: identity.nickname,
    avatarUrl: identity.avatarUrl,
    roles: activeRoles.map(({ key, name }) => ({
      roleKey: key,
      roleName: name,
    })),
    permissionKeys,
    menuTree: permissionTree
      .map((node) => filterPermissionNode(node, allowedPermissions))
      .filter((node): node is PermissionNode => node !== null),
    merchant:
      merchantId !== null && identity.merchant?.id === merchantId
        ? { merchantId, businessName: identity.merchant.businessName }
        : null,
  };
}

function filterPermissionNode(
  node: PermissionNode,
  allowedPermissions: ReadonlySet<string>,
): PermissionNode | null {
  const children = node.children
    .map((child) => filterPermissionNode(child, allowedPermissions))
    .filter((child): child is PermissionNode => child !== null);
  if (!allowedPermissions.has(node.permissionKey) && children.length === 0) {
    return null;
  }
  return { ...node, children };
}
