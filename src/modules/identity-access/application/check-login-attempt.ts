import { Inject, Injectable } from '@nestjs/common';
import { normalizeAccount } from '../domain/registration-rules.js';
import {
  LOGIN_ATTEMPT_STORE,
  type LoginAttemptStore,
} from './ports/login-attempt-store.js';

export class LoginRateLimitExceededError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('Login rate limit exceeded');
  }
}
export class LoginLimitUnavailableError extends Error {
  constructor() {
    super('Login service unavailable');
  }
}

@Injectable()
export class CheckLoginAttempt {
  constructor(
    @Inject(LOGIN_ATTEMPT_STORE) private readonly store: LoginAttemptStore,
  ) {}
  async execute(account: string, clientIp: string): Promise<void> {
    let decision;
    try {
      decision = await this.store.consume(normalizeAccount(account), clientIp);
    } catch {
      // Never expose database errors, identifiers, or permit a fallback login.
      throw new LoginLimitUnavailableError();
    }
    if (!decision.allowed)
      throw new LoginRateLimitExceededError(decision.retryAfterSeconds);
  }
}
