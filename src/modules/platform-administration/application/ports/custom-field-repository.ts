import type { CustomFieldAuditContext } from '../../domain/custom-field-audit.js';
import type { CustomFieldValidationRules } from '../../domain/custom-field-validation.js';

export const CUSTOM_FIELD_REPOSITORY = Symbol('CUSTOM_FIELD_REPOSITORY');

export interface CustomFieldDefinitionRecord {
  fieldDefinitionId: number;
  entityType: string;
  fieldKey: string;
  label: string;
  dataType: string;
  groupKey: string;
  sortOrder: number;
  required: boolean;
  defaultValue: unknown;
  optionsDictType: string | null;
  validation: CustomFieldValidationRules | null;
  searchable: boolean;
  filterable: boolean;
  sortable: boolean;
  isPublic: boolean;
  status: 'draft' | 'active' | 'disabled';
  schemaVersion: number;
  createTime: Date;
  updateTime: Date;
}

export interface CustomFieldGroupRecord {
  entityType: string;
  groupKey: string;
  label: string;
  sortOrder: number;
  visibilityRule: unknown;
  status: 'active' | 'disabled';
  createTime: Date;
  updateTime: Date;
}

export interface CustomFieldSchemaGroup extends CustomFieldGroupRecord {
  fields: CustomFieldDefinitionRecord[];
}

export interface CustomFieldDefinitionFilter {
  entityType?: string;
  status?: string;
  skip: number;
  take: number;
}

export interface CreateCustomFieldDefinitionRecord {
  entityType: string;
  fieldKey: string;
  label: string;
  dataType: string;
  groupKey: string;
  sortOrder: number;
  required: boolean;
  defaultValue?: unknown;
  optionsDictType?: string | null;
  validation?: CustomFieldValidationRules | null;
  searchable: boolean;
  filterable: boolean;
  sortable: boolean;
  isPublic: boolean;
}

export interface UpdateCustomFieldDefinitionRecord {
  label?: string;
  groupKey?: string;
  sortOrder?: number;
  required?: boolean;
  defaultValue?: unknown;
  optionsDictType?: string | null;
  validation?: CustomFieldValidationRules | null;
  searchable?: boolean;
  filterable?: boolean;
  sortable?: boolean;
  isPublic?: boolean;
}

export interface CustomFieldRepository {
  listDefinitions(
    filter: CustomFieldDefinitionFilter,
  ): Promise<{ items: CustomFieldDefinitionRecord[]; total: number }>;
  findDefinitionById(
    fieldDefinitionId: number,
  ): Promise<CustomFieldDefinitionRecord | null>;
  createDefinition(
    input: CreateCustomFieldDefinitionRecord,
    audit: CustomFieldAuditContext,
  ): Promise<CustomFieldDefinitionRecord>;
  updateDefinition(
    input: {
      fieldDefinitionId: number;
      expectedSchemaVersion: number;
      patch: UpdateCustomFieldDefinitionRecord;
    },
    audit: CustomFieldAuditContext,
  ): Promise<CustomFieldDefinitionRecord | null>;
  setDefinitionStatus(
    input: {
      fieldDefinitionId: number;
      expectedSchemaVersion: number;
      status: 'active' | 'disabled';
    },
    audit: CustomFieldAuditContext,
  ): Promise<CustomFieldDefinitionRecord | null>;
  listGroups(entityType?: string): Promise<CustomFieldGroupRecord[]>;
  findGroup(
    entityType: string,
    groupKey: string,
  ): Promise<CustomFieldGroupRecord | null>;
  createGroup(
    input: {
      entityType: string;
      groupKey: string;
      label: string;
      sortOrder: number;
    },
    audit: CustomFieldAuditContext,
  ): Promise<CustomFieldGroupRecord>;
  updateGroup(
    input: {
      entityType: string;
      groupKey: string;
      label?: string;
      sortOrder?: number;
    },
    audit: CustomFieldAuditContext,
  ): Promise<CustomFieldGroupRecord | null>;
  disableGroup(
    entityType: string,
    groupKey: string,
    audit: CustomFieldAuditContext,
  ): Promise<boolean>;
  isActiveDictionaryType(dictType: string): Promise<boolean>;
  listActiveDictionaryValues(dictType: string): Promise<ReadonlySet<string>>;
  findActiveSchema(entityType: string): Promise<CustomFieldSchemaGroup[]>;
}
