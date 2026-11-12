import { appendFieldDependencyEvent } from '../../integration-events/infrastructure/rag-dependency-events.js';
import {
  CustomFieldActorUnavailableError,
  CustomFieldAuthorizationError,
  CustomFieldReferenceInvalidError,
  type CustomFieldAuditContext,
} from '../domain/custom-field-audit.js';
import { Injectable } from '@nestjs/common';
import {
  Prisma,
  type CustomFieldDefinition,
  type CustomFieldGroup,
} from '@prisma/client';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';
import { ResolveAuthorizationPrincipal } from '../../identity-access/application/resolve-authorization-principal.js';
import { PrismaAuthorizationPrincipalReader } from '../../identity-access/infrastructure/prisma-authorization-principal-reader.js';
import {
  mayEnterManagementPortal,
  resolveDataScope,
} from '../../identity-access/domain/authorization.js';
import type {
  CreateCustomFieldDefinitionRecord,
  CustomFieldDefinitionFilter,
  CustomFieldDefinitionRecord,
  CustomFieldGroupRecord,
  CustomFieldRepository,
  CustomFieldSchemaGroup,
  UpdateCustomFieldDefinitionRecord,
} from '../application/ports/custom-field-repository.js';
import type { CustomFieldValidationRules } from '../domain/custom-field-validation.js';

@Injectable()
export class PrismaCustomFieldRepository implements CustomFieldRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listDefinitions(
    filter: CustomFieldDefinitionFilter,
  ): Promise<{ items: CustomFieldDefinitionRecord[]; total: number }> {
    const where: Prisma.CustomFieldDefinitionWhereInput = {
      ...(filter.entityType ? { EntityType: filter.entityType } : {}),
      ...(filter.status ? { Status: filter.status } : {}),
    };
    const [records, total] = await this.prisma.$transaction([
      this.prisma.customFieldDefinition.findMany({
        where,
        skip: filter.skip,
        take: filter.take,
        orderBy: [
          { EntityType: 'asc' },
          { GroupKey: 'asc' },
          { SortOrder: 'asc' },
          { FieldDefinitionId: 'asc' },
        ],
      }),
      this.prisma.customFieldDefinition.count({ where }),
    ]);
    return { items: records.map(mapDefinition), total };
  }

  async findDefinitionById(
    fieldDefinitionId: number,
  ): Promise<CustomFieldDefinitionRecord | null> {
    const record = await this.prisma.customFieldDefinition.findUnique({
      where: { FieldDefinitionId: fieldDefinitionId },
    });
    return record ? mapDefinition(record) : null;
  }

  async createDefinition(
    input: CreateCustomFieldDefinitionRecord,
    audit: CustomFieldAuditContext,
  ): Promise<CustomFieldDefinitionRecord> {
    return this.prisma.$transaction(
      async (transaction) => {
        await authorizeWrite(
          transaction,
          audit,
          'system:field:create',
          input.isPublic,
        );
        await assertReferences(
          transaction,
          input.entityType,
          input.groupKey,
          input.optionsDictType,
        );
        const record = await transaction.customFieldDefinition.create({
          data: {
            EntityType: input.entityType,
            FieldKey: input.fieldKey,
            Label: input.label.trim(),
            DataType: input.dataType,
            GroupKey: input.groupKey,
            SortOrder: input.sortOrder,
            Required: input.required,
            ...(input.defaultValue !== undefined
              ? { DefaultValue: input.defaultValue as Prisma.InputJsonValue }
              : {}),
            OptionsDictType: input.optionsDictType ?? null,
            ...(input.validation !== undefined
              ? { Validation: toNullableJson(input.validation) }
              : {}),
            Searchable: input.searchable,
            Filterable: input.filterable,
            Sortable: input.sortable,
            IsPublic: input.isPublic,
          },
        });
        await writeAudit(
          transaction,
          audit,
          'system:field:create',
          null,
          record,
        );
        return mapDefinition(record);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async updateDefinition(
    input: {
      fieldDefinitionId: number;
      expectedSchemaVersion: number;
      patch: UpdateCustomFieldDefinitionRecord;
    },
    audit: CustomFieldAuditContext,
  ): Promise<CustomFieldDefinitionRecord | null> {
    return this.prisma.$transaction(
      async (transaction) => {
        await authorizeWrite(
          transaction,
          audit,
          'system:field:update',
          input.patch.isPublic === true,
        );
        const current = await transaction.customFieldDefinition.findUnique({
          where: { FieldDefinitionId: input.fieldDefinitionId },
        });
        if (!current || current.SchemaVersion !== input.expectedSchemaVersion)
          return null;
        await assertReferences(
          transaction,
          current.EntityType,
          input.patch.groupKey ?? current.GroupKey,
          input.patch.optionsDictType === undefined
            ? current.OptionsDictType
            : input.patch.optionsDictType,
        );
        const data: Prisma.CustomFieldDefinitionUpdateManyMutationInput = {
          ...(input.patch.label !== undefined
            ? { Label: input.patch.label.trim() }
            : {}),
          ...(input.patch.groupKey !== undefined
            ? { GroupKey: input.patch.groupKey }
            : {}),
          ...(input.patch.sortOrder !== undefined
            ? { SortOrder: input.patch.sortOrder }
            : {}),
          ...(input.patch.required !== undefined
            ? { Required: input.patch.required }
            : {}),
          ...(input.patch.defaultValue !== undefined
            ? { DefaultValue: toNullableJson(input.patch.defaultValue) }
            : {}),
          ...(input.patch.optionsDictType !== undefined
            ? { OptionsDictType: input.patch.optionsDictType }
            : {}),
          ...(input.patch.validation !== undefined
            ? { Validation: toNullableJson(input.patch.validation) }
            : {}),
          ...(input.patch.searchable !== undefined
            ? { Searchable: input.patch.searchable }
            : {}),
          ...(input.patch.filterable !== undefined
            ? { Filterable: input.patch.filterable }
            : {}),
          ...(input.patch.sortable !== undefined
            ? { Sortable: input.patch.sortable }
            : {}),
          ...(input.patch.isPublic !== undefined
            ? { IsPublic: input.patch.isPublic }
            : {}),
          SchemaVersion: { increment: 1 },
        };
        const result = await transaction.customFieldDefinition.updateMany({
          where: {
            FieldDefinitionId: input.fieldDefinitionId,
            SchemaVersion: input.expectedSchemaVersion,
          },
          data,
        });
        if (result.count !== 1) return null;
        const record =
          await transaction.customFieldDefinition.findUniqueOrThrow({
            where: { FieldDefinitionId: input.fieldDefinitionId },
          });
        await writeAudit(
          transaction,
          audit,
          'system:field:update',
          current,
          record,
          Object.keys(input.patch),
        );
        return mapDefinition(record);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async setDefinitionStatus(
    input: {
      fieldDefinitionId: number;
      expectedSchemaVersion: number;
      status: 'active' | 'disabled';
    },
    audit: CustomFieldAuditContext,
  ): Promise<CustomFieldDefinitionRecord | null> {
    return this.prisma.$transaction(
      async (transaction) => {
        await authorizeWrite(
          transaction,
          audit,
          input.status === 'active'
            ? 'system:field:update'
            : 'system:field:delete',
        );
        const current = await transaction.customFieldDefinition.findUnique({
          where: { FieldDefinitionId: input.fieldDefinitionId },
        });
        if (!current || current.SchemaVersion !== input.expectedSchemaVersion)
          return null;
        if (input.status === 'active')
          await assertReferences(
            transaction,
            current.EntityType,
            current.GroupKey,
            current.OptionsDictType,
          );
        const result = await transaction.customFieldDefinition.updateMany({
          where: {
            FieldDefinitionId: input.fieldDefinitionId,
            SchemaVersion: input.expectedSchemaVersion,
          },
          data: {
            Status: input.status,
            SchemaVersion: { increment: 1 },
          },
        });
        if (result.count !== 1) return null;
        const record =
          await transaction.customFieldDefinition.findUniqueOrThrow({
            where: { FieldDefinitionId: input.fieldDefinitionId },
          });
        await writeAudit(
          transaction,
          audit,
          input.status === 'active'
            ? 'system:field:update'
            : 'system:field:delete',
          current,
          record,
          ['status'],
        );
        return mapDefinition(record);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async listGroups(entityType?: string): Promise<CustomFieldGroupRecord[]> {
    const records = await this.prisma.customFieldGroup.findMany({
      where: entityType ? { EntityType: entityType } : undefined,
      orderBy: [
        { EntityType: 'asc' },
        { SortOrder: 'asc' },
        { GroupKey: 'asc' },
      ],
    });
    return records.map(mapGroup);
  }

  async findGroup(
    entityType: string,
    groupKey: string,
  ): Promise<CustomFieldGroupRecord | null> {
    const record = await this.prisma.customFieldGroup.findUnique({
      where: {
        EntityType_GroupKey: { EntityType: entityType, GroupKey: groupKey },
      },
    });
    return record ? mapGroup(record) : null;
  }

  async createGroup(
    input: {
      entityType: string;
      groupKey: string;
      label: string;
      sortOrder: number;
    },
    audit: CustomFieldAuditContext,
  ): Promise<CustomFieldGroupRecord> {
    return this.prisma.$transaction(
      async (transaction) => {
        await authorizeWrite(transaction, audit, 'system:field-group:create');
        const record = await transaction.customFieldGroup.create({
          data: {
            EntityType: input.entityType,
            GroupKey: input.groupKey,
            Label: input.label.trim(),
            SortOrder: input.sortOrder,
          },
        });
        await writeAudit(
          transaction,
          audit,
          'system:field-group:create',
          null,
          record,
        );
        return mapGroup(record);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async updateGroup(
    input: {
      entityType: string;
      groupKey: string;
      label?: string;
      sortOrder?: number;
    },
    audit: CustomFieldAuditContext,
  ): Promise<CustomFieldGroupRecord | null> {
    return this.prisma.$transaction(
      async (transaction) => {
        await authorizeWrite(transaction, audit, 'system:field-group:update');
        const current = await transaction.customFieldGroup.findUnique({
          where: {
            EntityType_GroupKey: {
              EntityType: input.entityType,
              GroupKey: input.groupKey,
            },
          },
        });
        if (!current || current.Status !== 'active') return null;
        const result = await transaction.customFieldGroup.updateMany({
          where: {
            EntityType: input.entityType,
            GroupKey: input.groupKey,
            Status: 'active',
          },
          data: {
            ...(input.label !== undefined ? { Label: input.label.trim() } : {}),
            ...(input.sortOrder !== undefined
              ? { SortOrder: input.sortOrder }
              : {}),
          },
        });
        if (result.count !== 1) return null;
        const record = await transaction.customFieldGroup.findUniqueOrThrow({
          where: {
            EntityType_GroupKey: {
              EntityType: input.entityType,
              GroupKey: input.groupKey,
            },
          },
        });
        await writeAudit(
          transaction,
          audit,
          'system:field-group:update',
          current,
          record,
          ['label', 'sortOrder'].filter(
            (key) => input[key as 'label' | 'sortOrder'] !== undefined,
          ),
        );
        return mapGroup(record);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async disableGroup(
    entityType: string,
    groupKey: string,
    audit: CustomFieldAuditContext,
  ): Promise<boolean> {
    return this.prisma.$transaction(
      async (transaction) => {
        await authorizeWrite(transaction, audit, 'system:field-group:delete');
        const current = await transaction.customFieldGroup.findUnique({
          where: {
            EntityType_GroupKey: { EntityType: entityType, GroupKey: groupKey },
          },
        });
        if (!current) return false;
        const activeDefinitions = await transaction.customFieldDefinition.count(
          {
            where: {
              EntityType: entityType,
              GroupKey: groupKey,
              Status: 'active',
            },
          },
        );
        if (activeDefinitions > 0) return false;
        const record = await transaction.customFieldGroup.update({
          where: {
            EntityType_GroupKey: { EntityType: entityType, GroupKey: groupKey },
          },
          data: { Status: 'disabled' },
        });
        await writeAudit(
          transaction,
          audit,
          'system:field-group:delete',
          current,
          record,
          ['status'],
        );
        return true;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async isActiveDictionaryType(dictType: string): Promise<boolean> {
    const record = await this.prisma.dictionaryType.findUnique({
      where: { DictType: dictType },
      select: { Status: true },
    });
    return record?.Status === 'active';
  }

  async listActiveDictionaryValues(
    dictType: string,
  ): Promise<ReadonlySet<string>> {
    const items = await this.prisma.dictionaryItem.findMany({
      where: { DictType: dictType, Status: 'active' },
      select: { Value: true },
    });
    return new Set(items.map(({ Value }) => Value));
  }

  async findActiveSchema(
    entityType: string,
  ): Promise<CustomFieldSchemaGroup[]> {
    const groups = await this.prisma.customFieldGroup.findMany({
      where: { EntityType: entityType, Status: 'active' },
      include: {
        Definitions: {
          where: { Status: 'active' },
          orderBy: [{ SortOrder: 'asc' }, { FieldDefinitionId: 'asc' }],
        },
      },
      orderBy: [{ SortOrder: 'asc' }, { GroupKey: 'asc' }],
    });
    return groups.map((group) => ({
      ...mapGroup(group),
      fields: group.Definitions.map(mapDefinition),
    }));
  }
}

function mapDefinition(
  record: CustomFieldDefinition,
): CustomFieldDefinitionRecord {
  return {
    fieldDefinitionId: record.FieldDefinitionId,
    entityType: record.EntityType,
    fieldKey: record.FieldKey,
    label: record.Label,
    dataType: record.DataType,
    groupKey: record.GroupKey,
    sortOrder: record.SortOrder,
    required: record.Required,
    defaultValue: record.DefaultValue,
    optionsDictType: record.OptionsDictType,
    validation: record.Validation as CustomFieldValidationRules | null,
    searchable: record.Searchable,
    filterable: record.Filterable,
    sortable: record.Sortable,
    isPublic: record.IsPublic,
    status: record.Status as CustomFieldDefinitionRecord['status'],
    schemaVersion: record.SchemaVersion,
    createTime: record.CreateTime,
    updateTime: record.UpdateTime,
  };
}

function mapGroup(record: CustomFieldGroup): CustomFieldGroupRecord {
  return {
    entityType: record.EntityType,
    groupKey: record.GroupKey,
    label: record.Label,
    sortOrder: record.SortOrder,
    visibilityRule: record.VisibilityRule,
    status: record.Status as CustomFieldGroupRecord['status'],
    createTime: record.CreateTime,
    updateTime: record.UpdateTime,
  };
}

function toNullableJson(
  value: unknown,
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  return value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}

async function authorizeWrite(
  transaction: Prisma.TransactionClient,
  audit: CustomFieldAuditContext,
  permission: string,
  requiresPublicAdministration = false,
): Promise<void> {
  const principal = await new ResolveAuthorizationPrincipal(
    new PrismaAuthorizationPrincipalReader(transaction),
  ).execute(audit.actorUserId);
  if (
    !mayEnterManagementPortal(principal) ||
    !resolveDataScope(principal, permission)
  )
    throw new CustomFieldAuthorizationError(
      'Custom field write permission is unavailable',
    );

  if (requiresPublicAdministration) {
    const administrator = await transaction.userRole.findFirst({
      where: {
        UserId: audit.actorUserId,
        Role: {
          Status: 'active',
          RoleKey: 'system_admin',
          SystemRoleCode: 'system_admin',
        },
      },
      select: { RoleId: true },
    });
    if (!administrator)
      throw new CustomFieldAuthorizationError(
        'Only system_admin may enable public fields',
      );
  }
}

async function assertReferences(
  transaction: Prisma.TransactionClient,
  entityType: string,
  groupKey: string,
  optionsDictType?: string | null,
): Promise<void> {
  const group = await transaction.customFieldGroup.findUnique({
    where: {
      EntityType_GroupKey: { EntityType: entityType, GroupKey: groupKey },
    },
    select: { Status: true },
  });
  if (group?.Status !== 'active')
    throw new CustomFieldReferenceInvalidError(
      'An active field group is required',
    );
  if (optionsDictType) {
    const dictionary = await transaction.dictionaryType.findUnique({
      where: { DictType: optionsDictType },
      select: { Status: true },
    });
    if (dictionary?.Status !== 'active')
      throw new CustomFieldReferenceInvalidError(
        'An active dictionary type is required',
      );
  }
}

type AuditRecord = CustomFieldDefinition | CustomFieldGroup;

// Values, labels, validation patterns and visibility expressions are intentionally
// excluded: these configuration fields may contain confidential business input.
function auditSummary(record: AuditRecord): Prisma.InputJsonObject {
  return {
    entityType: record.EntityType,
    groupKey: record.GroupKey,
    status: record.Status,
    sortOrder: record.SortOrder,
    ...('FieldDefinitionId' in record
      ? {
          fieldDefinitionId: record.FieldDefinitionId,
          fieldKey: record.FieldKey,
          dataType: record.DataType,
          schemaVersion: record.SchemaVersion,
          required: record.Required,
          optionsDictType: record.OptionsDictType,
          searchable: record.Searchable,
          filterable: record.Filterable,
          sortable: record.Sortable,
          isPublic: record.IsPublic,
          hasDefaultValue: record.DefaultValue !== null,
          hasValidation: record.Validation !== null,
        }
      : {}),
  };
}

async function writeAudit(
  transaction: Prisma.TransactionClient,
  audit: CustomFieldAuditContext,
  actionKey: string,
  before: AuditRecord | null,
  after: AuditRecord,
  changedProperties?: string[],
): Promise<void> {
  const actor = await transaction.user.findUnique({
    where: { UserId: audit.actorUserId },
    select: { Account: true, Status: true },
  });
  if (!actor || actor.Status !== 'active')
    throw new CustomFieldActorUnavailableError('Audit actor is unavailable');
  const definition = 'FieldDefinitionId' in after;
  await appendFieldDependencyEvent(transaction, after.EntityType);
  await transaction.operationLog.create({
    data: {
      ActorUserId: audit.actorUserId,
      ActorAccountSnapshot: actor.Account,
      ActionKey: actionKey,
      ResourceKey: definition ? 'system:field' : 'system:field-group',
      TargetType: definition ? 'CustomFieldDefinition' : 'CustomFieldGroup',
      TargetId: definition
        ? String(after.FieldDefinitionId)
        : after.EntityType + ':' + after.GroupKey,
      Result: 'success',
      TraceId: audit.traceId,
      ClientIp: audit.clientIp,
      UserAgent: audit.userAgent,
      Metadata: {
        ...(before ? { before: auditSummary(before) } : {}),
        after: auditSummary(after),
        ...(changedProperties
          ? { changedProperties: [...changedProperties].sort() }
          : {}),
      },
    },
  });
}
