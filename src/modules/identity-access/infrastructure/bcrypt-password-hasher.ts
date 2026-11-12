import { compare, hash, truncates } from 'bcryptjs';
import type { PasswordHasher } from '../application/ports/password-hasher.js';

const BCRYPT_ROUNDS = 12;

export class BcryptPasswordHasher implements PasswordHasher {
  async hash(password: string): Promise<string> {
    if (password.length === 0) throw new Error('Password cannot be empty');
    if (truncates(password)) {
      throw new Error('Password exceeds bcrypt maximum input length');
    }
    return hash(password, BCRYPT_ROUNDS);
  }

  async verify(password: string, encodedHash: string): Promise<boolean> {
    if (password.length === 0 || truncates(password)) return false;
    try {
      return await compare(password, encodedHash);
    } catch {
      return false;
    }
  }
}
