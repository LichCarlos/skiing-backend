import {
  CustomFieldActorUnavailableError,
  CustomFieldAuthorizationError,
  CustomFieldReferenceInvalidError,
} from '../domain/custom-field-audit.js';
import type { CustomFieldAuditContext } from '../domain/custom-field-audit.js';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CUSTOM_FIELD_REPOSITORY,
  type CreateCustomFieldDefinitionRecord,
  type CustomFieldDefinitionRecord,
  type CustomFieldGroupRecord,
  type CustomFieldRepository,
  type UpdateCustomFieldDefinitionRecord,
} from './ports/custom-field-repository.js';
import {
  isCustomFieldEntityType,
  validateCustomFieldDefinition,
} from '../domain/custom-field-definition.js';
import {
  validateCustomFieldWrite,
  type CustomFieldDefinition,
} from '../domain/custom-field-validation.js';

export interface CustomFieldPage {
  page: number;
  pageSize: number;
  entityType?: string;
  status?: string;
}

@Injectable()
export class ManageCustomFields {
  constructor(
    @Inject(CUSTOM_FIELD_REPOSITORY)
    private readonly fields: CustomFieldRepository,
  ) {}

  list(input: CustomFieldPage) {
    return this.fields
      .listDefinitions({
        entityType: input.entityType,
        status: input.status,
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      })
      .then((result) => ({
        ...result,
        page: input.page,
        pageSize: input.pageSize,
      }));
  }

  async get(fieldDefinitionId: number): Promise<CustomFieldDefinitionRecord> {
    const definition = await this.fields.findDefinitionById(fieldDefinitionId);
    if (!definition) throw new NotFoundException('Custom field not found');
    return definition;
  }

  async create(
    input: CreateCustomFieldDefinitionRecord,
    audit: CustomFieldAuditContext,
  ): Promise<CustomFieldDefinitionRecord> {
    const issues = validateCustomFieldDefinition(input);
    if (issues.length) {
      throw new BadRequestException({
        message: 'Custom field definition is invalid',
        details: issues.map((code) => ({ code, message: code })),
      });
    }
    const group = await this.fields.findGroup(input.entityType, input.groupKey);
    if (!group || group.status !== 'active') {
      throw new BadRequestException('An active field group is required');
    }
    if (
      input.optionsDictType &&
      !(await this.fields.isActiveDictionaryType(input.optionsDictType))
    ) {
      throw new BadRequestException('An active dictionary type is required');
    }
    await this.validateDefaultValue(input);
    try {
      return await this.write(() => this.fields.createDefinition(input, audit));
    } catch (error) {
      if (getPrismaErrorCode(error) === 'P2002') {
        throw new ConflictException('A field with this key already exists');
      }
      if (getPrismaErrorCode(error) === 'P2003') {
        throw new BadRequestException(
          'A referenced group or dictionary is invalid',
        );
      }
      throw error;
    }
  }

  async update(
    input: {
      fieldDefinitionId: number;
      expectedSchemaVersion: number;
      patch: UpdateCustomFieldDefinitionRecord;
    },
    audit: CustomFieldAuditContext,
  ): Promise<CustomFieldDefinitionRecord> {
    const current = await this.get(input.fieldDefinitionId);
    if (input.expectedSchemaVersion !== current.schemaVersion) {
      throw new ConflictException('Custom field schema version is stale');
    }
    if (Object.keys(input.patch).length === 0) {
      throw new BadRequestException(
        'At least one custom field property is required',
      );
    }
    if (input.patch.groupKey) {
      const group = await this.fields.findGroup(
        current.entityType,
        input.patch.groupKey,
      );
      if (!group || group.status !== 'active') {
        throw new BadRequestException('An active field group is required');
      }
    }
    const optionsDictType =
      input.patch.optionsDictType === undefined
        ? current.optionsDictType
        : input.patch.optionsDictType;
    const candidate = {
      entityType: current.entityType,
      fieldKey: current.fieldKey,
      label: input.patch.label ?? current.label,
      dataType: current.dataType,
      groupKey: input.patch.groupKey ?? current.groupKey,
      optionsDictType,
      validation:
        input.patch.validation !== undefined
          ? input.patch.validation
          : current.validation,
    };
    const issues = validateCustomFieldDefinition(candidate);
    if (issues.length) {
      throw new BadRequestException({
        message: 'Custom field definition is invalid',
        details: issues.map((code) => ({ code, message: code })),
      });
    }
    if (
      optionsDictType &&
      !(await this.fields.isActiveDictionaryType(optionsDictType))
    ) {
      throw new BadRequestException('An active dictionary type is required');
    }
    const defaultValue =
      input.patch.defaultValue !== undefined
        ? input.patch.defaultValue
        : current.defaultValue;
    await this.validateDefaultValue({ ...candidate, defaultValue });
    const updated = await this.write(() =>
      this.fields.updateDefinition(input, audit),
    );
    if (!updated)
      throw new ConflictException('Custom field changed concurrently');
    return updated;
  }

  async activate(
    input: {
      fieldDefinitionId: number;
      expectedSchemaVersion: number;
    },
    audit: CustomFieldAuditContext,
  ): Promise<CustomFieldDefinitionRecord> {
    const current = await this.get(input.fieldDefinitionId);
    if (current.schemaVersion !== input.expectedSchemaVersion) {
      throw new ConflictException('Custom field schema version is stale');
    }
    const group = await this.fields.findGroup(
      current.entityType,
      current.groupKey,
    );
    if (!group || group.status !== 'active') {
      throw new BadRequestException('An active field group is required');
    }
    if (
      current.optionsDictType &&
      !(await this.fields.isActiveDictionaryType(current.optionsDictType))
    ) {
      throw new BadRequestException('An active dictionary type is required');
    }
    const updated = await this.write(() =>
      this.fields.setDefinitionStatus(
        {
          fieldDefinitionId: input.fieldDefinitionId,
          expectedSchemaVersion: input.expectedSchemaVersion,
          status: 'active',
        },
        audit,
      ),
    );
    if (!updated)
      throw new ConflictException('Custom field changed concurrently');
    return updated;
  }

  async disable(
    input: {
      fieldDefinitionId: number;
      expectedSchemaVersion: number;
    },
    audit: CustomFieldAuditContext,
  ): Promise<CustomFieldDefinitionRecord> {
    await this.get(input.fieldDefinitionId);
    const updated = await this.write(() =>
      this.fields.setDefinitionStatus(
        {
          fieldDefinitionId: input.fieldDefinitionId,
          expectedSchemaVersion: input.expectedSchemaVersion,
          status: 'disabled',
        },
        audit,
      ),
    );
    if (!updated)
      throw new ConflictException('Custom field changed concurrently');
    return updated;
  }

  async schema(entityType: string) {
    if (!isCustomFieldEntityType(entityType)) {
      throw new BadRequestException('Unsupported custom field entity type');
    }
    const groups = await this.fields.findActiveSchema(entityType);
    return { entityType, groups };
  }

  private async validateDefaultValue(input: {
    fieldKey: string;
    dataType: string;
    optionsDictType?: string | null;
    validation?: CustomFieldDefinition['validation'];
    defaultValue?: unknown;
  }): Promise<void> {
    if (input.defaultValue === undefined || input.defaultValue === null) return;
    const definition = {
      fieldKey: input.fieldKey,
      dataType: input.dataType,
      required: false,
      status: 'active',
      optionsDictType: input.optionsDictType,
      validation: input.validation,
    } as CustomFieldDefinition;
    const dictionaryValues = input.optionsDictType
      ? new Map([
          [
            input.optionsDictType,
            await this.fields.listActiveDictionaryValues(input.optionsDictType),
          ],
        ])
      : undefined;
    const result = validateCustomFieldWrite({
      definitions: [definition],
      policies: new Map([[input.fieldKey, { canRead: true, canWrite: true }]]),
      dictionaryValues,
      submittedValues: { [input.fieldKey]: input.defaultValue },
    });
    if (!result.ok) {
      throw new BadRequestException('Custom field default value is invalid');
    }
  }

  private async write<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof CustomFieldReferenceInvalidError)
        throw new BadRequestException(error.message);
      if (error instanceof CustomFieldActorUnavailableError)
        throw new ForbiddenException('Audit actor is unavailable');
      if (error instanceof CustomFieldAuthorizationError)
        throw new ForbiddenException(error.message);
      if (getPrismaErrorCode(error) === 'P2034')
        throw new ConflictException(
          'Custom field configuration changed concurrently',
        );
      throw error;
    }
  }

  async listGroups(entityType?: string): Promise<CustomFieldGroupRecord[]> {
    if (entityType && !isCustomFieldEntityType(entityType)) {
      throw new BadRequestException('Unsupported custom field entity type');
    }
    return this.fields.listGroups(entityType);
  }

  async getGroup(
    entityType: string,
    groupKey: string,
  ): Promise<CustomFieldGroupRecord> {
    if (
      !isCustomFieldEntityType(entityType) ||
      !/^[a-z][a-z0-9_-]{0,99}$/.test(groupKey)
    ) {
      throw new BadRequestException('Custom field group is invalid');
    }
    const group = await this.fields.findGroup(entityType, groupKey);
    if (!group) throw new NotFoundException('Custom field group not found');
    return group;
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
    if (
      !isCustomFieldEntityType(input.entityType) ||
      !/^[a-z][a-z0-9_-]{0,99}$/.test(input.groupKey) ||
      !input.label.trim() ||
      input.label.length > 100
    ) {
      throw new BadRequestException('Custom field group is invalid');
    }
    try {
      return await this.write(() => this.fields.createGroup(input, audit));
    } catch (error) {
      if (getPrismaErrorCode(error) === 'P2002') {
        throw new ConflictException('Custom field group already exists');
      }
      throw error;
    }
  }

  async updateGroup(
    input: {
      entityType: string;
      groupKey: string;
      label?: string;
      sortOrder?: number;
    },
    audit: CustomFieldAuditContext,
  ): Promise<CustomFieldGroupRecord> {
    if (
      !isCustomFieldEntityType(input.entityType) ||
      (input.label !== undefined &&
        (!input.label.trim() || input.label.length > 100))
    ) {
      throw new BadRequestException('Custom field group is invalid');
    }
    if (input.label === undefined && input.sortOrder === undefined) {
      throw new BadRequestException(
        'At least one custom field group property is required',
      );
    }
    const updated = await this.write(() =>
      this.fields.updateGroup(input, audit),
    );
    if (!updated) throw new NotFoundException('Custom field group not found');
    return updated;
  }

  async disableGroup(
    entityType: string,
    groupKey: string,
    audit: CustomFieldAuditContext,
  ): Promise<void> {
    if (!isCustomFieldEntityType(entityType)) {
      throw new BadRequestException('Unsupported custom field entity type');
    }
    const disabled = await this.write(() =>
      this.fields.disableGroup(entityType, groupKey, audit),
    );
    if (!disabled) {
      throw new ConflictException(
        'Group is missing or still contains active fields',
      );
    }
  }
}

export type { UpdateCustomFieldDefinitionRecord };

function getPrismaErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const candidate = error as { code?: unknown };
  return typeof candidate.code === 'string' ? candidate.code : null;
}
