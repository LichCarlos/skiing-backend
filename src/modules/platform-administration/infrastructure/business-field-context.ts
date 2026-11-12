import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';
import { PrismaCustomFieldRepository } from './prisma-custom-field.repository.js';
import type {
  CustomFieldDataType,
  CustomFieldDefinition,
} from '../domain/custom-field-validation.js';

export async function businessFieldContext(
  tx: Prisma.TransactionClient,
  entity: string,
  userId: number,
) {
  const groups = await new PrismaCustomFieldRepository(
    tx as PrismaService,
  ).findActiveSchema(entity);
  const grants = await tx.roleFieldPermission.findMany({
    where: {
      EntityType: entity,
      Role: { Status: 'active', UserRoles: { some: { UserId: userId } } },
    },
    select: { FieldKey: true, CanRead: true, CanWrite: true },
  });
  const admin = await tx.userRole.findFirst({
    where: {
      UserId: userId,
      Role: {
        Status: 'active',
        RoleKey: 'system_admin',
        SystemRoleCode: 'system_admin',
      },
    },
    select: { RoleId: true },
  });
  const policies = new Map<string, { canRead: boolean; canWrite: boolean }>();
  const definitions: CustomFieldDefinition[] = groups.flatMap((group) =>
    group.fields.map((field) => ({
      fieldKey: field.fieldKey,
      dataType: field.dataType as CustomFieldDataType,
      required: field.required,
      status: field.status,
      validation: field.validation,
      optionsDictType: field.optionsDictType,
    })),
  );
  for (const f of definitions)
    policies.set(f.fieldKey, {
      canRead:
        !!admin || grants.some((g) => g.FieldKey === f.fieldKey && g.CanRead),
      canWrite:
        !!admin || grants.some((g) => g.FieldKey === f.fieldKey && g.CanWrite),
    });
  const dictionaryValues = new Map<string, ReadonlySet<string>>();
  const options: Record<string, Array<{ value: string; label: string }>> = {};
  for (const f of definitions)
    if (f.optionsDictType && !dictionaryValues.has(f.optionsDictType)) {
      const items = await tx.dictionaryItem.findMany({
        where: {
          DictType: f.optionsDictType,
          Status: 'active',
          Type: { Status: 'active' },
        },
        select: { Value: true, Label: true },
        orderBy: [{ SortOrder: 'asc' }, { ItemId: 'asc' }],
      });
      dictionaryValues.set(
        f.optionsDictType,
        new Set(items.map((i) => i.Value)),
      );
      options[f.optionsDictType] = items.map((i) => ({
        value: i.Value,
        label: i.Label,
      }));
    }
  return { groups, definitions, policies, dictionaryValues, options };
}
export function businessFieldSchema(
  context: Awaited<ReturnType<typeof businessFieldContext>>,
  entity: string,
) {
  return {
    entityType: entity,
    groups: context.groups
      .map((group) => ({
        ...group,
        fields: group.fields.flatMap((field) => {
          const policy = context.policies.get(field.fieldKey)!;
          return policy.canRead || policy.canWrite
            ? [{ ...field, ...policy }]
            : [];
        }),
      }))
      .filter((group) => group.fields.length),
    options: Object.fromEntries(
      Object.entries(context.options).filter(([type]) =>
        context.groups.some((group) =>
          group.fields.some(
            (field) =>
              field.optionsDictType === type &&
              (context.policies.get(field.fieldKey)?.canRead ||
                context.policies.get(field.fieldKey)?.canWrite),
          ),
        ),
      ),
    ),
  };
}
