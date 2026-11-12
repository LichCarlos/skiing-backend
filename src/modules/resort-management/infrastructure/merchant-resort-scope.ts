import { ForbiddenException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  permitsMerchantResortAccess,
  type MerchantResortAccess,
} from '../domain/resort-management-scope.js';

export function merchantResortWhere(
  access: MerchantResortAccess,
): Prisma.SkiResortWhereInput {
  if (!permitsMerchantResortAccess(access))
    throw new ForbiddenException('A valid merchant resort scope is required');
  return {
    MerchantId: access.merchantId!,
    Merchant: {
      is: {
        UserId: access.userId,
        Status: 'active',
        User: { Status: 'active' },
      },
    },
    DeletedAt: null,
    ...(access.scope?.kind === 'selected'
      ? { ResortId: { in: [...access.scope.ids] } }
      : {}),
  };
}

export function merchantResortTargetWhere(
  access: MerchantResortAccess,
  resortId: number,
): Prisma.SkiResortWhereInput {
  const where = merchantResortWhere(access);
  // Never overwrite selected IDs with the client-provided target.
  return { ...where, AND: [{ ResortId: resortId }] };
}
