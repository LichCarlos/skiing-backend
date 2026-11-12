import { ForbiddenException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ResolveAuthorizationPrincipal } from '../../identity-access/application/resolve-authorization-principal.js';
import { hasPermission } from '../../identity-access/domain/authorization.js';
import { PrismaAuthorizationPrincipalReader } from '../../identity-access/infrastructure/prisma-authorization-principal-reader.js';

/** Re-evaluate current explicit grants; caller selects an internal operation. */
export async function authorizeOwnedAsset(
  tx: Prisma.TransactionClient,
  ownerUserId: number,
  permission: 'asset:upload' | 'asset:read-own' | 'asset:delete-own',
): Promise<void> {
  if (
    !Number.isSafeInteger(ownerUserId) ||
    ownerUserId < 1 ||
    ownerUserId > 2_147_483_647
  )
    throw new ForbiddenException('Asset owner is unavailable');
  const principal = await new ResolveAuthorizationPrincipal(
    new PrismaAuthorizationPrincipalReader(tx),
  ).execute(ownerUserId);
  if (!hasPermission(principal, permission))
    throw new ForbiddenException('Asset operation is no longer permitted');
}

export function authorizeOwnedAssetUpload(
  tx: Prisma.TransactionClient,
  ownerUserId: number,
) {
  return authorizeOwnedAsset(tx, ownerUserId, 'asset:upload');
}
