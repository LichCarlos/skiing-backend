import type { Prisma } from '@prisma/client';
import { ResolveAuthorizationPrincipal } from '../application/resolve-authorization-principal.js';
import {
  mayEnterManagementPortal,
  resolveDataScope,
} from '../domain/authorization.js';
import { ManagementWriteAuthorizationError } from '../domain/management-write-authorization.js';
import { PrismaAuthorizationPrincipalReader } from './prisma-authorization-principal-reader.js';

/** Uses the write transaction's authoritative snapshot, never HTTP role/scope flags. */
export async function authorizeUserWrite(
  transaction: Prisma.TransactionClient,
  actorUserId: number,
  permission:
    | 'system:user:create'
    | 'system:user:assign-role'
    | 'system:user:update'
    | 'system:user:reset-password',
) {
  const principal = await new ResolveAuthorizationPrincipal(
    new PrismaAuthorizationPrincipalReader(transaction),
  ).execute(actorUserId);
  const scope = resolveDataScope(principal, permission, 'user');
  if (
    !mayEnterManagementPortal(principal) ||
    !scope ||
    (scope.kind === 'selected' &&
      scope.ids.some(
        (id) => !Number.isSafeInteger(id) || id < 1 || id > 2147483647,
      )) ||
    (permission === 'system:user:create' && scope.kind !== 'all')
  )
    throw new ManagementWriteAuthorizationError(
      'User write permission or data scope is unavailable',
    );
  const actor = await transaction.user.findUnique({
    where: { UserId: actorUserId },
    select: {
      Account: true,
      UserRoles: {
        where: {
          Role: {
            Status: 'active',
            RoleKey: 'system_admin',
            SystemRoleCode: 'system_admin',
          },
        },
        select: { RoleId: true },
      },
    },
  });
  if (!actor)
    throw new ManagementWriteAuthorizationError(
      'User write actor is unavailable',
    );
  return {
    scope,
    account: actor.Account,
    isSystemAdmin: actor.UserRoles.length > 0,
  };
}
