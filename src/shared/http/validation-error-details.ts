import type { ValidationError } from 'class-validator';
import type { ApiErrorDetail } from './api-response.js';

export function toValidationErrorDetails(
  errors: readonly ValidationError[],
): ApiErrorDetail[] {
  const details: ApiErrorDetail[] = [];
  appendValidationErrors(errors, '', details);
  return details;
}

function appendValidationErrors(
  errors: readonly ValidationError[],
  parentPath: string,
  details: ApiErrorDetail[],
): void {
  for (const error of errors) {
    const field = [parentPath, error.property].filter(Boolean).join('.');
    const constraints = Object.entries(error.constraints ?? {}).sort(
      ([left], [right]) => left.localeCompare(right),
    );
    for (const [, message] of constraints) {
      details.push({ field, code: 'VALIDATION_ERROR', message });
    }
    appendValidationErrors(error.children ?? [], field, details);
  }
}
