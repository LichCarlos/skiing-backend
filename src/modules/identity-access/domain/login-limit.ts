export const LOGIN_WINDOW_MS = 60_000;
export const LOGIN_ACCOUNT_LIMIT = 5;
export const LOGIN_IP_LIMIT = 30;

export interface LoginBucket {
  attempts: number;
  expiresAt: Date;
}
export type LoginLimitDecision =
  { allowed: true } | { allowed: false; retryAfterSeconds: number };

/** The caller supplies one database timestamp after acquiring both locks. */
export function loginLimitDecision(
  now: Date,
  account: LoginBucket | undefined,
  ip: LoginBucket | undefined,
): LoginLimitDecision {
  const remaining = [
    { bucket: account, limit: LOGIN_ACCOUNT_LIMIT },
    { bucket: ip, limit: LOGIN_IP_LIMIT },
  ].flatMap(({ bucket, limit }) =>
    bucket && bucket.expiresAt > now && bucket.attempts >= limit
      ? [bucket.expiresAt.getTime() - now.getTime()]
      : [],
  );
  return remaining.length
    ? {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil(Math.max(...remaining) / 1000),
        ),
      }
    : { allowed: true };
}
