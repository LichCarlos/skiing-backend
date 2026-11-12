import { describe, expect, it } from 'vitest';
import { resolveFieldAccessPolicies } from './field-access.js';

describe('resolveFieldAccessPolicies', () => {
  it('unions read and write grants across active roles', () => {
    const policies = resolveFieldAccessPolicies(
      [
        {
          active: true,
          entityType: 'ski_resort',
          fieldKey: 'private_note',
          canRead: true,
          canWrite: false,
        },
        {
          active: true,
          entityType: 'ski_resort',
          fieldKey: 'private_note',
          canRead: false,
          canWrite: true,
        },
        {
          active: false,
          entityType: 'ski_resort',
          fieldKey: 'disabled_role_field',
          canRead: true,
          canWrite: true,
        },
        {
          active: true,
          entityType: 'article',
          fieldKey: 'private_note',
          canRead: true,
          canWrite: true,
        },
      ],
      'ski_resort',
    );

    expect(policies.get('private_note')).toEqual({
      canRead: true,
      canWrite: true,
    });
    expect(policies.has('disabled_role_field')).toBe(false);
  });

  it('defaults absent policies to deny', () => {
    const policies = resolveFieldAccessPolicies([], 'ski_resort');

    expect(policies.get('missing_field')).toBeUndefined();
  });
});
