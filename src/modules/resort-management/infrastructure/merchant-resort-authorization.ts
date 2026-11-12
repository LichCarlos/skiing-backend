import { ForbiddenException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ResolveAuthorizationPrincipal } from '../../identity-access/application/resolve-authorization-principal.js';
import { PrismaAuthorizationPrincipalReader } from '../../identity-access/infrastructure/prisma-authorization-principal-reader.js';
import {
  mayEnterManagementPortal,
  resolveDataScope,
  type ResolvedDataScope,
} from '../../identity-access/domain/authorization.js';
import {
  permitsMerchantResortAccess,
  type MerchantResortAccess,
} from '../domain/resort-management-scope.js';
import { resolveMerchantFieldPolicies } from '../domain/merchant-resort.js';
import type {
  CustomFieldDataType,
  CustomFieldValidationRules,
} from '../../platform-administration/domain/custom-field-validation.js';

const WRITE_PERMISSIONS = new Set([
  'resort:merchant:create',
  'resort:merchant:update',
  'resort:merchant:delete',
  'resort:merchant:submit-review',
]);
export async function authorizeMerchantWrite(
  tx: Prisma.TransactionClient,
  requested: MerchantResortAccess,
  permission: string,
) {
  const principal = await new ResolveAuthorizationPrincipal(
    new PrismaAuthorizationPrincipalReader(tx),
  ).execute(requested.userId);
  const scope = resolveDataScope(principal, permission, 'resort');
  const current: MerchantResortAccess = {
    userId: principal?.userId ?? 0,
    merchantId: principal?.merchantId ?? null,
    scope: scope ?? undefined,
  };
  if (
    !WRITE_PERMISSIONS.has(permission) ||
    !mayEnterManagementPortal(principal) ||
    !permitsMerchantResortAccess(current) ||
    current.merchantId !== requested.merchantId ||
    !requested.scope ||
    !scope ||
    scopeIdentity(scope) !== scopeIdentity(requested.scope) ||
    (permission === 'resort:merchant:create' && scope.kind === 'selected')
  )
    throw new ForbiddenException(
      'Merchant resort authorization changed or is not permitted',
    );
}
function scopeIdentity(scope: ResolvedDataScope) {
  if (scope.kind === 'self') return `self:${scope.userId}`;
  if (scope.kind === 'merchant') return `merchant:${scope.merchantId}`;
  if (scope.kind === 'selected')
    return `selected:${[...scope.ids].sort((a, b) => a - b).join(',')}`;
  return scope.kind;
}
export async function merchantFieldContext(
  tx: Prisma.TransactionClient,
  userId: number,
) {
  const [fields, grants] = await Promise.all([
    tx.customFieldDefinition.findMany({
      where: {
        EntityType: 'ski_resort',
        Status: 'active',
        Group: { Status: 'active' },
      },
      select: {
        FieldKey: true,
        DataType: true,
        Required: true,
        Validation: true,
        OptionsDictType: true,
      },
      orderBy: [{ SortOrder: 'asc' }, { FieldDefinitionId: 'asc' }],
    }),
    tx.roleFieldPermission.findMany({
      where: {
        EntityType: 'ski_resort',
        Role: { Status: 'active', UserRoles: { some: { UserId: userId } } },
      },
      select: { FieldKey: true, CanRead: true, CanWrite: true },
    }),
  ]);
  const definitions = fields.map((field) => ({
    fieldKey: field.FieldKey,
    dataType: field.DataType as CustomFieldDataType,
    required: field.Required,
    status: 'active' as const,
    validation: field.Validation as CustomFieldValidationRules | null,
    optionsDictType: field.OptionsDictType,
  }));
  const dictTypes = [
    ...new Set(
      fields.flatMap((f) => (f.OptionsDictType ? [f.OptionsDictType] : [])),
    ),
  ];
  const items = dictTypes.length
    ? await tx.dictionaryItem.findMany({
        where: {
          DictType: { in: dictTypes },
          Status: 'active',
          Type: { Status: 'active' },
        },
        select: { DictType: true, Value: true },
      })
    : [];
  return {
    definitions,
    policies: resolveMerchantFieldPolicies([
      grants.map((f) => ({
        fieldKey: f.FieldKey,
        canRead: f.CanRead,
        canWrite: f.CanWrite,
      })),
    ]),
    dictionaryValues: new Map(
      dictTypes.map((type) => [
        type,
        new Set(items.filter((i) => i.DictType === type).map((i) => i.Value)),
      ]),
    ),
  };
}
