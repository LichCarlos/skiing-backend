import { describe, expect, it } from 'vitest';
import { toValidationErrorDetails } from './validation-error-details.js';

describe('toValidationErrorDetails', () => {
  it('maps constraint failures and nested fields to stable field paths', () => {
    expect(
      toValidationErrorDetails([
        {
          property: 'profile',
          value: undefined,
          constraints: undefined,
          children: [
            {
              property: 'nickname',
              value: '',
              constraints: {
                maxLength:
                  'nickname must be shorter than or equal to 50 characters',
                isString: 'nickname must be a string',
              },
              children: [],
            },
          ],
        },
        {
          property: 'unexpected',
          value: true,
          constraints: {
            whitelistValidation: 'property unexpected should not exist',
          },
          children: [],
        },
      ]),
    ).toEqual([
      {
        field: 'profile.nickname',
        code: 'VALIDATION_ERROR',
        message: 'nickname must be a string',
      },
      {
        field: 'profile.nickname',
        code: 'VALIDATION_ERROR',
        message: 'nickname must be shorter than or equal to 50 characters',
      },
      {
        field: 'unexpected',
        code: 'VALIDATION_ERROR',
        message: 'property unexpected should not exist',
      },
    ]);
  });

  it('returns no details when there are no constraint failures', () => {
    expect(toValidationErrorDetails([])).toEqual([]);
  });
});
