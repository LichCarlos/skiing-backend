import { describe, expect, it } from 'vitest';
import { validateCustomFieldDefinition } from './custom-field-definition.js';

const valid = {
  entityType: 'ski_resort',
  fieldKey: 'lift_count',
  label: '缆车数量',
  dataType: 'integer',
  groupKey: 'facilities',
};

describe('custom field definition policy', () => {
  it('accepts a valid numeric field definition', () => {
    expect(
      validateCustomFieldDefinition({
        ...valid,
        validation: { min: 0, max: 500 },
      }),
    ).toEqual([]);
  });

  it('requires a dictionary for select field types only', () => {
    expect(
      validateCustomFieldDefinition({ ...valid, dataType: 'single_select' }),
    ).toContain('dictionary_required');
    expect(
      validateCustomFieldDefinition({
        ...valid,
        optionsDictType: 'resort.fit_tag',
      }),
    ).toContain('dictionary_not_allowed');
  });

  it('rejects unknown entities, unsafe keys, and invalid validation rules', () => {
    const issues = validateCustomFieldDefinition({
      ...valid,
      entityType: 'user',
      fieldKey: 'SQL;DROP',
      validation: { pattern: '(a+)+$' } as never,
    });
    expect(issues).toEqual(
      expect.arrayContaining([
        'invalid_entity_type',
        'invalid_field_key',
        'invalid_validation',
      ]),
    );
  });
});
