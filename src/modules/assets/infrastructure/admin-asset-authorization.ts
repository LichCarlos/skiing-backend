import { ForbiddenException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ResolveAuthorizationPrincipal } from '../../identity-access/application/resolve-authorization-principal.js';
import { PrismaAuthorizationPrincipalReader } from '../../identity-access/infrastructure/prisma-authorization-principal-reader.js';
import {
  mayEnterManagementPortal,
  resolveDataScope,
} from '../../identity-access/domain/authorization.js';
import {
  resolveAdminAssetAccess,
  type AdminAssetAccess,
} from '../domain/admin-asset-access.js';

/** Uses the deletion transaction's snapshot; never trusts a prior Guard result. */
export async function authorizeAdminAssetDeletion(
  tx: Prisma.TransactionClient,
  actorUserId: number,
  requested: AdminAssetAccess,
): Promise<AdminAssetAccess> {
  return authorizeAdminAsset(
    tx,
    actorUserId,
    requested,
    'content:asset:delete',
  );
}

export async function authorizeAdminAssetRead(
  tx: Prisma.TransactionClient,
  actorUserId: number,
  requested: AdminAssetAccess,
): Promise<AdminAssetAccess> {
  return authorizeAdminAsset(tx, actorUserId, requested, 'content:asset:list');
}

async function authorizeAdminAsset(
  tx: Prisma.TransactionClient,
  actorUserId: number,
  requested: AdminAssetAccess,
  permission: 'content:asset:list' | 'content:asset:delete',
): Promise<AdminAssetAccess> {
  if (
    !Number.isInteger(actorUserId) ||
    actorUserId < 1 ||
    actorUserId > 2_147_483_647
  )
    throw new ForbiddenException('Asset actor is unavailable');
  const principal = await new ResolveAuthorizationPrincipal(
    new PrismaAuthorizationPrincipalReader(tx),
  ).execute(actorUserId);
  const access = resolveAdminAssetAccess(
    resolveDataScope(principal, permission, 'asset') ?? undefined,
    actorUserId,
  );
  if (
    !mayEnterManagementPortal(principal) ||
    !access ||
    accessKey(access) !== accessKey(requested)
  )
    throw new ForbiddenException(
      'Asset authorization changed or is not permitted',
    );
  return access;
}
function accessKey(access: AdminAssetAccess): string {
  switch (access.kind) {
    case 'all':
      return 'all';
    case 'self':
      return `self:${access.userId}`;
    case 'selected':
      return `selected:${[...new Set(access.ids)].sort((a, b) => a - b).join(',')}`;
  }
}
