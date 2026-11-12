import { describe, expect, it } from 'vitest';
import { BcryptPasswordHasher } from './bcrypt-password-hasher.js';

describe('BcryptPasswordHasher', () => {
  const hasher = new BcryptPasswordHasher();

  it('hashes passwords and verifies the original without storing plaintext', async () => {
    const password = 'a-long-demo-password';
    const encodedHash = await hasher.hash(password);

    expect(encodedHash).toMatch(/^\$2[aby]\$/);
    expect(encodedHash).not.toContain(password);
    await expect(hasher.verify(password, encodedHash)).resolves.toBe(true);
    await expect(
      hasher.verify('incorrect-password', encodedHash),
    ).resolves.toBe(false);
  });

  it('rejects empty and bcrypt-truncated password inputs', async () => {
    await expect(hasher.hash('')).rejects.toThrow('Password cannot be empty');
    await expect(hasher.hash('雪'.repeat(25))).rejects.toThrow(
      'Password exceeds bcrypt maximum input length',
    );
    await expect(hasher.verify('雪'.repeat(25), 'not-a-hash')).resolves.toBe(
      false,
    );
  });
});
