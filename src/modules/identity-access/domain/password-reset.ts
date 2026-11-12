export class PasswordResetTargetMissingError extends Error {}
export class PasswordResetConflictError extends Error {}

export function validPasswordResetTarget(userId: number): boolean {
  return Number.isSafeInteger(userId) && userId > 0 && userId <= 2147483647;
}

export function passwordResetReason(reason: string): string | null {
  if (typeof reason !== 'string') return null;
  const value = reason.trim();
  return value.length >= 1 && value.length <= 500 ? value : null;
}
