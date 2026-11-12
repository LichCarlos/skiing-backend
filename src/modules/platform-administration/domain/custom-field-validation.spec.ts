import { describe, expect, it } from 'vitest';
import {
  filterReadableCustomFields,
  validateCustomFieldWrite,
  type CustomFieldAccessPolicy,
  type CustomFieldDefinition,
} from './custom-field-validation.js';

const definitions: CustomFieldDefinition[] = [
  {
    fieldKey: 'difficulty',
    dataType: 'integer',
    required: true,
    status: 'active',
    validation: { min: 1, max: 5 },
  },
  {
    fieldKey: 'website',
    dataType: 'url',
    required: false,
    status: 'active',
  },
  {
    fieldKey: 'audience',
    dataType: 'single_select',
    required: false,
    status: 'active',
    optionsDictType: 'resort.fit_tag',
  },
  {
    fieldKey: 'internalNote',
    dataType: 'text',
    required: false,
    status: 'active',
  },
  {
    fieldKey: 'retiredField',
    dataType: 'text',
    required: false,
    status: 'disabled',
  },
];

const writablePolicies = new Map<string, CustomFieldAccessPolicy>(
  definitions.map(({ fieldKey }) => [
    fieldKey,
    {
      canRead: fieldKey !== 'internalNote',
      canWrite: fieldKey !== 'internalNote',
    },
  ]),
);

const dictionaryValues = new Map([
  ['resort.fit_tag', new Set(['beginner', 'advanced'])],
]);

describe('custom field validation', () => {
  it('accepts authorized values and keeps JSON values typed', () => {
    expect(
      validateCustomFieldWrite({
        definitions,
        policies: writablePolicies,
        dictionaryValues,
        existingValues: {
          difficulty: 2,
          internalNote: 'existing private value',
        },
        submittedValues: {
          difficulty: 3,
          website: 'https://example.com/trails',
          audience: 'beginner',
        },
      }),
    ).toEqual({
      ok: true,
      values: {
        difficulty: 3,
        website: 'https://example.com/trails',
        audience: 'beginner',
        internalNote: 'existing private value',
      },
    });
  });

  it('rejects non-object input, unknown keys, and fields outside the write grant', () => {
    expect(
      validateCustomFieldWrite({
        definitions,
        policies: writablePolicies,
        submittedValues: [],
      }),
    ).toEqual({
      ok: false,
      issues: [{ fieldKey: '*', code: 'invalid_object' }],
    });

    const result = validateCustomFieldWrite({
      definitions,
      policies: writablePolicies,
      existingValues: { difficulty: 2 },
      submittedValues: { arbitrary: 'value', internalNote: 'private' },
    });
    expect(result).toEqual({
      ok: false,
      issues: [
        { fieldKey: 'arbitrary', code: 'unknown_field' },
        { fieldKey: 'internalNote', code: 'field_not_writable' },
      ],
    });
  });

  it('blocks writes to disabled definitions and checks required fields against merged values', () => {
    const disabled = validateCustomFieldWrite({
      definitions,
      policies: writablePolicies,
      existingValues: { difficulty: 2 },
      submittedValues: { retiredField: 'old' },
    });
    expect(disabled).toEqual({
      ok: false,
      issues: [{ fieldKey: 'retiredField', code: 'field_not_active' }],
    });

    expect(
      validateCustomFieldWrite({
        definitions,
        policies: writablePolicies,
        submittedValues: { website: 'https://example.com' },
      }),
    ).toEqual({
      ok: false,
      issues: [{ fieldKey: 'difficulty', code: 'required' }],
    });
  });

  it('validates number ranges, dictionary membership, dates, and URLs', () => {
    const result = validateCustomFieldWrite({
      definitions: [
        ...definitions,
        {
          fieldKey: 'availableFrom',
          dataType: 'date',
          required: false,
          status: 'active',
        },
      ],
      policies: new Map([
        ...writablePolicies,
        ['availableFrom', { canRead: true, canWrite: true }],
      ]),
      dictionaryValues,
      existingValues: { difficulty: 2 },
      submittedValues: {
        difficulty: 8,
        website: 'javascript:alert(1)',
        audience: 'staff-only',
        availableFrom: '2026-02-30',
      },
    });
    expect(result).toEqual({
      ok: false,
      issues: [
        { fieldKey: 'difficulty', code: 'out_of_range' },
        { fieldKey: 'website', code: 'invalid_format' },
        { fieldKey: 'audience', code: 'invalid_dictionary' },
        { fieldKey: 'availableFrom', code: 'invalid_format' },
      ],
    });
  });

  it('filters disabled and unreadable values from responses', () => {
    expect(
      filterReadableCustomFields({
        definitions,
        policies: writablePolicies,
        values: {
          difficulty: 4,
          website: 'https://example.com',
          internalNote: 'never expose',
          retiredField: 'legacy',
          unknownField: 'ignored',
        },
      }),
    ).toEqual({
      difficulty: 4,
      website: 'https://example.com',
    });
  });
});
