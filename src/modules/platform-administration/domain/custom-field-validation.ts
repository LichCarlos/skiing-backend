export type CustomFieldDataType =
  | 'text'
  | 'textarea'
  | 'integer'
  | 'decimal'
  | 'boolean'
  | 'date'
  | 'single_select'
  | 'multi_select'
  | 'url';

export type CustomFieldValue = string | number | boolean | string[] | null;

export interface CustomFieldValidationRules {
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
}

export interface CustomFieldDefinition {
  fieldKey: string;
  dataType: CustomFieldDataType;
  required: boolean;
  status: 'draft' | 'active' | 'disabled';
  validation?: CustomFieldValidationRules | null;
  optionsDictType?: string | null;
}

export interface CustomFieldAccessPolicy {
  canRead: boolean;
  canWrite: boolean;
}

export interface CustomFieldIssue {
  fieldKey: string;
  code:
    | 'invalid_object'
    | 'unknown_field'
    | 'field_not_active'
    | 'field_not_writable'
    | 'required'
    | 'invalid_type'
    | 'out_of_range'
    | 'invalid_length'
    | 'invalid_format'
    | 'invalid_dictionary';
}

export type CustomFieldWriteResult =
  | { ok: true; values: Record<string, unknown> }
  | { ok: false; issues: CustomFieldIssue[] };

const MAX_PATTERN_LENGTH = 128;
const MAX_VALIDATED_TEXT_LENGTH = 10_000;

export function validateCustomFieldWrite(input: {
  definitions: readonly CustomFieldDefinition[];
  policies: ReadonlyMap<string, CustomFieldAccessPolicy>;
  dictionaryValues?: ReadonlyMap<string, ReadonlySet<string>>;
  existingValues?: Readonly<Record<string, unknown>>;
  submittedValues: unknown;
}): CustomFieldWriteResult {
  const { definitions, policies } = input;
  if (!isPlainRecord(input.submittedValues)) {
    return {
      ok: false,
      issues: [{ fieldKey: '*', code: 'invalid_object' }],
    };
  }

  const byKey = new Map(
    definitions.map((definition) => [definition.fieldKey, definition]),
  );
  const issues: CustomFieldIssue[] = [];
  const submitted = input.submittedValues;

  for (const fieldKey of Object.keys(submitted)) {
    const definition = byKey.get(fieldKey);
    if (!definition) {
      issues.push({ fieldKey, code: 'unknown_field' });
      continue;
    }
    if (definition.status !== 'active') {
      issues.push({ fieldKey, code: 'field_not_active' });
      continue;
    }
    if (!policies.get(fieldKey)?.canWrite) {
      issues.push({ fieldKey, code: 'field_not_writable' });
      continue;
    }

    const value = submitted[fieldKey];
    const issue = validateValue(definition, value, input.dictionaryValues);
    if (issue) issues.push({ fieldKey, code: issue });
  }

  const merged: Record<string, unknown> = {
    ...(isPlainRecord(input.existingValues) ? input.existingValues : {}),
    ...submitted,
  };
  for (const definition of definitions) {
    if (
      definition.status === 'active' &&
      definition.required &&
      isEmpty(merged[definition.fieldKey])
    ) {
      issues.push({ fieldKey: definition.fieldKey, code: 'required' });
    }
  }

  if (issues.length > 0) return { ok: false, issues };

  return {
    ok: true,
    values: merged,
  };
}

export function filterReadableCustomFields(input: {
  definitions: readonly CustomFieldDefinition[];
  policies: ReadonlyMap<string, CustomFieldAccessPolicy>;
  values: unknown;
}): Record<string, CustomFieldValue> {
  if (!isPlainRecord(input.values)) return {};

  const visible: Record<string, CustomFieldValue> = {};
  for (const definition of input.definitions) {
    if (
      definition.status !== 'active' ||
      !input.policies.get(definition.fieldKey)?.canRead
    ) {
      continue;
    }
    const value = input.values[definition.fieldKey];
    if (isCustomFieldValue(value)) visible[definition.fieldKey] = value;
  }
  return visible;
}

function validateValue(
  definition: CustomFieldDefinition,
  value: unknown,
  dictionaryValues: ReadonlyMap<string, ReadonlySet<string>> | undefined,
): CustomFieldIssue['code'] | null {
  if (value === null) return definition.required ? 'required' : null;

  const rules = definition.validation ?? {};
  switch (definition.dataType) {
    case 'text':
    case 'textarea':
      if (typeof value !== 'string') return 'invalid_type';
      if (value.length > MAX_VALIDATED_TEXT_LENGTH) return 'invalid_length';
      if (typeof rules.minLength === 'number' && value.length < rules.minLength)
        return 'invalid_length';
      if (typeof rules.maxLength === 'number' && value.length > rules.maxLength)
        return 'invalid_length';
      if (rules.pattern && !matchesSafePattern(value, rules.pattern))
        return 'invalid_format';
      return null;
    case 'integer':
      if (typeof value !== 'number' || !Number.isSafeInteger(value))
        return 'invalid_type';
      return isWithinRange(value, rules) ? null : 'out_of_range';
    case 'decimal':
      if (typeof value !== 'number' || !Number.isFinite(value))
        return 'invalid_type';
      return isWithinRange(value, rules) ? null : 'out_of_range';
    case 'boolean':
      return typeof value === 'boolean' ? null : 'invalid_type';
    case 'date':
      return typeof value === 'string' && isCalendarDate(value)
        ? null
        : 'invalid_format';
    case 'single_select':
      return isDictionaryValue(definition, value, dictionaryValues)
        ? null
        : 'invalid_dictionary';
    case 'multi_select':
      if (
        !Array.isArray(value) ||
        !value.every((item) => typeof item === 'string')
      )
        return 'invalid_type';
      if (new Set(value).size !== value.length) return 'invalid_dictionary';
      return value.every((item) =>
        isDictionaryValue(definition, item, dictionaryValues),
      )
        ? null
        : 'invalid_dictionary';
    case 'url':
      if (typeof value !== 'string') return 'invalid_type';
      try {
        const url = new URL(value);
        return url.protocol === 'https:' || url.protocol === 'http:'
          ? null
          : 'invalid_format';
      } catch {
        return 'invalid_format';
      }
  }
}

function isDictionaryValue(
  definition: CustomFieldDefinition,
  value: unknown,
  dictionaryValues: ReadonlyMap<string, ReadonlySet<string>> | undefined,
): value is string {
  if (typeof value !== 'string' || !definition.optionsDictType) return false;
  return dictionaryValues?.get(definition.optionsDictType)?.has(value) ?? false;
}

function matchesSafePattern(value: string, pattern: string): boolean {
  if (
    pattern.length === 0 ||
    pattern.length > MAX_PATTERN_LENGTH ||
    /\\[1-9]|\(\?[=!<]|\(\?>|\([^)]*[+*][^)]*\)[+*{]/.test(pattern)
  ) {
    return false;
  }
  try {
    return new RegExp(pattern, 'u').test(value);
  } catch {
    return false;
  }
}

function isWithinRange(
  value: number,
  rules: CustomFieldValidationRules,
): boolean {
  return (
    (rules.min === undefined || value >= rules.min) &&
    (rules.max === undefined || value <= rules.max)
  );
}

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function isEmpty(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.trim().length === 0) ||
    (Array.isArray(value) && value.length === 0)
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isCustomFieldValue(value: unknown): value is CustomFieldValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return true;
  }
  if (typeof value === 'number') return Number.isFinite(value);
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}
