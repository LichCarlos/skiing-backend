import type { Prisma } from '@prisma/client';
import { ResolveAuthorizationPrincipal } from '../../identity-access/application/resolve-authorization-principal.js';
import {
  mayEnterManagementPortal,
  resolveDataScope,
} from '../../identity-access/domain/authorization.js';
import { ManagementWriteAuthorizationError } from '../../identity-access/domain/management-write-authorization.js';
import { PrismaAuthorizationPrincipalReader } from '../../identity-access/infrastructure/prisma-authorization-principal-reader.js';

// Re-read authority from the caller's write transaction, never the HTTP snapshot.
export async function authorizeRoleWrite(
  transaction: Prisma.TransactionClient,
  userId: number,
  permissions: readonly string[],
  targetRoleId?: number,
  requiresSystemAdmin = false,
): Promise<string> {
  const principal = await new ResolveAuthorizationPrincipal(
    new PrismaAuthorizationPrincipalReader(transaction),
  ).execute(userId);
  if (
    !mayEnterManagementPortal(principal) ||
    permissions.length === 0 ||
    !permissions.every((permission) => {
      const scope = resolveDataScope(principal, permission, 'role');
      return (
        scope?.kind === 'all' ||
        (targetRoleId !== undefined &&
          scope?.kind === 'selected' &&
          scope.ids.includes(targetRoleId))
      );
    })
  )
    throw new ManagementWriteAuthorizationError(
      'Role write permission or data scope is unavailable',
    );

  const actor = await transaction.user.findUnique({
    where: { UserId: userId },
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
  if (!actor || (requiresSystemAdmin && actor.UserRoles.length === 0))
    throw new ManagementWriteAuthorizationError(
      'Protected system administrator identity is required',
    );
  return actor.Account;
}
