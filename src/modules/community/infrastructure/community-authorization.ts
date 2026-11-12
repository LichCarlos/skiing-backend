import { ForbiddenException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ResolveAuthorizationPrincipal } from '../../identity-access/application/resolve-authorization-principal.js';
import {
  mayEnterManagementPortal,
  resolveDataScope,
} from '../../identity-access/domain/authorization.js';
import { PrismaAuthorizationPrincipalReader } from '../../identity-access/infrastructure/prisma-authorization-principal-reader.js';
import type { CommunityWritePermission } from '../application/ports/community-unit-of-work.js';

export async function authorizeCommunityWrite(
  tx: Prisma.TransactionClient,
  userId: number,
  permission: CommunityWritePermission,
): Promise<void> {
  if (!Number.isSafeInteger(userId) || userId < 1 || userId > 2147483647)
    throw new ForbiddenException('Community actor is unavailable');
  const principal = await new ResolveAuthorizationPrincipal(
    new PrismaAuthorizationPrincipalReader(tx),
  ).execute(userId);
  // Match the Guard's permission-key scope fallback; community has no resource scope contract.
  if (
    !resolveDataScope(principal, permission) ||
    (permission === 'content:dynamic:moderate' &&
      !mayEnterManagementPortal(principal))
  )
    throw new ForbiddenException('Community authorization is not permitted');
}
