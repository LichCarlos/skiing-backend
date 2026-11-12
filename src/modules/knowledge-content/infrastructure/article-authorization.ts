import { ForbiddenException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ResolveAuthorizationPrincipal } from '../../identity-access/application/resolve-authorization-principal.js';
import { PrismaAuthorizationPrincipalReader } from '../../identity-access/infrastructure/prisma-authorization-principal-reader.js';
import {
  mayEnterManagementPortal,
  resolveDataScope,
} from '../../identity-access/domain/authorization.js';
import {
  resolveArticleAccess,
  type ArticleAccess,
} from '../domain/article-scope.js';
import { resolveArticleFieldPolicies } from '../domain/article-field-access.js';
import type {
  ArticleFieldContext,
  ArticleFieldGroup,
  ArticleFieldSchemaDefinition,
} from '../application/ports/article-repository.js';
import type {
  CustomFieldDataType,
  CustomFieldValidationRules,
} from '../../platform-administration/domain/custom-field-validation.js';

export async function articleAuthorization(
  tx: Prisma.TransactionClient,
  requested: ArticleAccess,
  actorUserId: number,
): Promise<{ access: ArticleAccess; fields: ArticleFieldContext }> {
  if (
    !Number.isSafeInteger(actorUserId) ||
    actorUserId < 1 ||
    actorUserId > 2_147_483_647
  )
    throw new ForbiddenException('Article actor is unavailable');
  const principal = await new ResolveAuthorizationPrincipal(
    new PrismaAuthorizationPrincipalReader(tx),
  ).execute(actorUserId);
  const access = resolveArticleAccess(
    resolveDataScope(principal, 'content:article:manage', 'article') ??
      undefined,
  );
  if (
    !mayEnterManagementPortal(principal) ||
    !access ||
    scopeKey(access) !== scopeKey(requested)
  )
    throw new ForbiddenException(
      'Article authorization changed or is not permitted',
    );

  const isSystemAdmin = principal!.roles.some(
    (role) => role.active && role.roleKey === 'system_admin',
  );
  if (isSystemAdmin) {
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

  const definitions = await tx.customFieldDefinition.findMany({
    where: {
      EntityType: 'article',
      Status: 'active',
      Group: { Status: 'active' },
    },
    select: {
      FieldKey: true,
      DataType: true,
      Required: true,
      Validation: true,
      OptionsDictType: true,
      SchemaVersion: true,
      FieldDefinitionId: true,
      Label: true,
      GroupKey: true,
      SortOrder: true,
      DefaultValue: true,
      Group: { select: { GroupKey: true, Label: true, SortOrder: true } },
    },
    orderBy: [{ SortOrder: 'asc' }, { FieldDefinitionId: 'asc' }],
  });
  const schema = definitions.map((field) => ({
    fieldKey: field.FieldKey,
    dataType: field.DataType as CustomFieldDataType,
    required: field.Required,
    status: 'active' as const,
    validation: field.Validation as CustomFieldValidationRules | null,
    optionsDictType: field.OptionsDictType,
    schemaVersion: field.SchemaVersion,
  }));
  const groupMap = new Map<
    string,
    ArticleFieldGroup & { fields: ArticleFieldSchemaDefinition[] }
  >();
  for (const field of definitions) {
    let group = groupMap.get(field.GroupKey);
    if (!group) {
      group = {
        groupKey: field.GroupKey,
        label: field.Group.Label,
        sortOrder: field.Group.SortOrder,
        fields: [],
      };
      groupMap.set(field.GroupKey, group);
    }
    group.fields.push({
      fieldDefinitionId: field.FieldDefinitionId,
      fieldKey: field.FieldKey,
      label: field.Label,
      dataType: field.DataType as CustomFieldDataType,
      groupKey: field.GroupKey,
      sortOrder: field.SortOrder,
      required: field.Required,
      defaultValue: field.DefaultValue,
      optionsDictType: field.OptionsDictType,
      validation: field.Validation as CustomFieldValidationRules | null,
      schemaVersion: field.SchemaVersion,
    });
  }
  const grants = isSystemAdmin
    ? schema.map((field) => ({
        fieldKey: field.fieldKey,
        canRead: true,
        canWrite: true,
      }))
    : (
        await tx.roleFieldPermission.findMany({
          where: {
            EntityType: 'article',
            Role: {
              Status: 'active',
              UserRoles: { some: { UserId: actorUserId } },
            },
          },
          select: { FieldKey: true, CanRead: true, CanWrite: true },
        })
      ).map((field) => ({
        fieldKey: field.FieldKey,
        canRead: field.CanRead,
        canWrite: field.CanWrite,
      }));
  const dictionaryValues = new Map<string, ReadonlySet<string>>();
  const dictTypes = [
    ...new Set(
      schema.flatMap((field) =>
        field.optionsDictType ? [field.optionsDictType] : [],
      ),
    ),
  ];
  if (dictTypes.length) {
    const items = await tx.dictionaryItem.findMany({
      where: {
        DictType: { in: dictTypes },
        Status: 'active',
        Type: { Status: 'active' },
      },
      select: { DictType: true, Value: true },
    });
    for (const dictType of dictTypes)
      dictionaryValues.set(
        dictType,
        new Set(
          items
            .filter((item) => item.DictType === dictType)
            .map((item) => item.Value),
        ),
      );
  }
  return {
    access,
    fields: {
      definitions: schema,
      policies: resolveArticleFieldPolicies(grants),
      dictionaryValues,
      groups: [...groupMap.values()].sort(
        (a, b) =>
          a.sortOrder - b.sortOrder || a.groupKey.localeCompare(b.groupKey),
      ),
    },
  };
}

function scopeKey(access: ArticleAccess) {
  if (access.kind === 'self') return `self:${access.userId}`;
  if (access.kind === 'selected')
    return `selected:${[...access.ids].sort((a, b) => a - b).join(',')}`;
  return access.kind;
}
