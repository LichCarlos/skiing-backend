import type {
  CustomFieldDataType,
  CustomFieldValidationRules,
} from './custom-field-validation.js';

export const CUSTOM_FIELD_ENTITY_TYPES = [
  'ski_resort',
  'article',
  'dynamic',
  'merchant_profile',
] as const;

export type CustomFieldEntityType = (typeof CUSTOM_FIELD_ENTITY_TYPES)[number];

export const CUSTOM_FIELD_DATA_TYPES: readonly CustomFieldDataType[] = [
  'text',
  'textarea',
  'integer',
  'decimal',
  'boolean',
  'date',
  'single_select',
  'multi_select',
  'url',
];

export interface CustomFieldDefinitionInput {
  entityType: string;
  fieldKey: string;
  label: string;
  dataType: string;
  groupKey: string;
  optionsDictType?: string | null;
  validation?: CustomFieldValidationRules | null;
}

export type CustomFieldDefinitionIssue =
  | 'invalid_entity_type'
  | 'invalid_field_key'
  | 'invalid_label'
  | 'invalid_data_type'
  | 'invalid_group_key'
  | 'dictionary_required'
  | 'dictionary_not_allowed'
  | 'invalid_validation';

export function validateCustomFieldDefinition(
  input: CustomFieldDefinitionInput,
): CustomFieldDefinitionIssue[] {
  const issues: CustomFieldDefinitionIssue[] = [];
  if (!isCustomFieldEntityType(input.entityType))
    issues.push('invalid_entity_type');
  if (!/^[a-z][a-z0-9_]{0,99}$/.test(input.fieldKey))
    issues.push('invalid_field_key');
  if (!input.label.trim() || input.label.length > 100)
    issues.push('invalid_label');
  if (!isCustomFieldDataType(input.dataType)) issues.push('invalid_data_type');
  if (!/^[a-z][a-z0-9_-]{0,99}$/.test(input.groupKey))
    issues.push('invalid_group_key');

  const needsDictionary =
    input.dataType === 'single_select' || input.dataType === 'multi_select';
  if (needsDictionary && !input.optionsDictType?.trim())
    issues.push('dictionary_required');
  if (!needsDictionary && input.optionsDictType)
    issues.push('dictionary_not_allowed');
  if (!isValidValidation(input.dataType, input.validation))
    issues.push('invalid_validation');
  return issues;
}

export function isCustomFieldEntityType(
  value: string,
): value is CustomFieldEntityType {
  return CUSTOM_FIELD_ENTITY_TYPES.some((entityType) => entityType === value);
}

export function isCustomFieldDataType(
  value: string,
): value is CustomFieldDataType {
  return CUSTOM_FIELD_DATA_TYPES.some((dataType) => dataType === value);
}

function isValidValidation(
  dataType: string,
  value: CustomFieldValidationRules | null | undefined,
): boolean {
  if (value == null) return true;
  const allowedKeys =
    dataType === 'text' || dataType === 'textarea'
      ? ['minLength', 'maxLength', 'pattern']
      : dataType === 'integer' || dataType === 'decimal'
        ? ['min', 'max']
        : [];
  if (Object.keys(value).some((key) => !allowedKeys.includes(key)))
    return false;
  if (
    value.min !== undefined &&
    (!Number.isFinite(value.min) ||
      (value.max !== undefined &&
        (!Number.isFinite(value.max) || value.min > value.max)))
  ) {
    return false;
  }
  if (value.max !== undefined && !Number.isFinite(value.max)) return false;
  if (
    value.minLength !== undefined &&
    (!Number.isSafeInteger(value.minLength) || value.minLength < 0)
  ) {
    return false;
  }
  if (
    value.maxLength !== undefined &&
    (!Number.isSafeInteger(value.maxLength) ||
      value.maxLength < 0 ||
      (value.minLength !== undefined && value.minLength > value.maxLength))
  ) {
    return false;
  }
  if (value.pattern !== undefined) {
    if (
      value.pattern.length === 0 ||
      value.pattern.length > 128 ||
      /\\[1-9]|\(\?[=!<]|\(\?>|\([^)]*[+*][^)]*\)[+*{]/.test(value.pattern)
    ) {
      return false;
    }
    try {
      new RegExp(value.pattern, 'u');
    } catch {
      return false;
    }
  }
  return true;
}
