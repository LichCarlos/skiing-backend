import type { Prisma } from '@prisma/client';
import { ResolveAuthorizationPrincipal } from '../application/resolve-authorization-principal.js';
import {
  mayEnterManagementPortal,
  resolveDataScope,
} from '../domain/authorization.js';
import { ManagementWriteAuthorizationError } from '../domain/management-write-authorization.js';
import { PrismaAuthorizationPrincipalReader } from './prisma-authorization-principal-reader.js';

// The caller must pass its write transaction so authorization, mutation and
// audit observe the same snapshot. This does not cancel later revocations.
export async function readManagementWriteActor(
  transaction: Prisma.TransactionClient,
  userId: number,
  permission: string,
  requiresSystemAdmin = false,
): Promise<{ account: string }> {
  const principal = await new ResolveAuthorizationPrincipal(
    new PrismaAuthorizationPrincipalReader(transaction),
  ).execute(userId);
  if (
    !mayEnterManagementPortal(principal) ||
    !resolveDataScope(principal, permission)
  )
    throw new ManagementWriteAuthorizationError(
      'Management write permission is unavailable',
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
      'Required management identity is unavailable',
    );
  return { account: actor.Account };
}
