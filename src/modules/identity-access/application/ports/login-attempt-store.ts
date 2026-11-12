import type { LoginLimitDecision } from '../../domain/login-limit.js';

export const LOGIN_ATTEMPT_STORE = Symbol('LOGIN_ATTEMPT_STORE');
export interface LoginAttemptStore {
  /** Atomically consume both budgets or neither. No raw identifiers are persisted. */
  consume(account: string, clientIp: string): Promise<LoginLimitDecision>;
}
