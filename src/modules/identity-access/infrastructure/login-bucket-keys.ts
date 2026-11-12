import { createHmac } from 'node:crypto';
import { normalizeAccount } from '../domain/registration-rules.js';

export class LoginBucketKeys {
  constructor(private readonly secret: string) {
    if (Buffer.byteLength(secret, 'utf8') < 32)
      throw new Error('LOGIN_RATE_LIMIT_SECRET must contain at least 32 bytes');
  }
  account(account: string): string {
    return this.key('account', normalizeAccount(account));
  }
  ip(ip: string): string {
    return this.key('ip', ip);
  }
  private key(kind: string, value: string) {
    return createHmac('sha256', this.secret)
      .update(`login:v1:${kind}\0${value}`)
      .digest('hex');
  }
}
export function createLoginBucketKeysFromEnvironment() {
  return new LoginBucketKeys(process.env.LOGIN_RATE_LIMIT_SECRET ?? '');
}
