import { ForbiddenException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ResolveAuthorizationPrincipal } from '../../identity-access/application/resolve-authorization-principal.js';
import { PrismaAuthorizationPrincipalReader } from '../../identity-access/infrastructure/prisma-authorization-principal-reader.js';
import {
  mayEnterManagementPortal,
  resolveDataScope,
} from '../../identity-access/domain/authorization.js';
import { permitsGlobalResortManagement } from '../domain/resort-management-scope.js';

const WRITE_PERMISSIONS = new Set([
  'content:resort:create-all',
  'content:resort:update-all',
  'content:resort:delete-all',
  'content:resort:publish',
  'content:resort:offline',
]);

export async function authorizeAdminResortWrite(
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
    !permitsGlobalResortManagement(
      resolveDataScope(principal, permission, 'resort') ?? undefined,
    )
  ) {
    throw new ForbiddenException(
      'Global resort authorization changed or is not permitted',
    );
  }
}
