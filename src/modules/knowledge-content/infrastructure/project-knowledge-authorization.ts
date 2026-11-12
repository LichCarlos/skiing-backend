import { ForbiddenException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ResolveAuthorizationPrincipal } from '../../identity-access/application/resolve-authorization-principal.js';
import { PrismaAuthorizationPrincipalReader } from '../../identity-access/infrastructure/prisma-authorization-principal-reader.js';
import {
  hasPermission,
  mayEnterManagementPortal,
} from '../../identity-access/domain/authorization.js';

const WRITE_PERMISSIONS = new Set([
  'content:project-knowledge:create',
  'content:project-knowledge:update',
  'content:project-knowledge:publish',
  'content:project-knowledge:withdraw',
  'content:project-knowledge:delete',
]);
export async function authorizeProjectKnowledgeWrite(
  tx: Prisma.TransactionClient,
  actorUserId: number,
  permission: string,
): Promise<void> {
  const principal = await new ResolveAuthorizationPrincipal(
    new PrismaAuthorizationPrincipalReader(tx),
  ).execute(actorUserId);
  if (
    !WRITE_PERMISSIONS.has(permission) ||
    !mayEnterManagementPortal(principal) ||
    !hasPermission(principal, permission) ||
    !principal?.roles.some((r) => r.active && r.roleKey === 'system_admin')
  )
    throw new ForbiddenException(
      'Project knowledge authorization changed or is not permitted',
    );
  const identity = await tx.user.findUnique({
    where: { UserId: actorUserId, Status: 'active' },
    select: {
      UserRoles: {
        where: {
          Role: {
            RoleKey: 'system_admin',
            SystemRoleCode: 'system_admin',
            Status: 'active',
          },
        },
        select: { RoleId: true },
      },
    },
  });
  if (!identity?.UserRoles.length)
    throw new ForbiddenException(
      'Protected system administrator identity required',
    );
}
