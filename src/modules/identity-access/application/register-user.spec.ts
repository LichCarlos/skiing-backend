import { describe, expect, it, vi } from 'vitest';
import type { PasswordHasher } from './ports/password-hasher.js';
import type { UserRegistrationRepository } from './ports/user-registration-repository.js';
import {
  AccountAlreadyRegisteredError,
  RegisterUser,
} from './register-user.js';

function setup(
  register: UserRegistrationRepository['register'] = vi
    .fn()
    .mockResolvedValue({ userId: 12, account: 'rider', nickname: 'Rider' }),
  hash: PasswordHasher['hash'] = vi.fn().mockResolvedValue('password-hash'),
) {
  const repository: UserRegistrationRepository = { register };
  const passwordHasher: PasswordHasher = { hash, verify: vi.fn() };
  return {
    useCase: new RegisterUser(repository, passwordHasher),
    register,
    hash,
  };
}

describe('RegisterUser', () => {
  it('hashes the password and delegates only non-secret user data plus the hash', async () => {
    const { useCase, register, hash } = setup();

    await expect(
      useCase.execute({
        account: 'rider',
        password: 'long passphrase',
        nickname: 'Rider',
      }),
    ).resolves.toEqual({ userId: 12, account: 'rider', nickname: 'Rider' });
    expect(hash).toHaveBeenCalledWith('long passphrase');
    expect(register).toHaveBeenCalledWith({
      account: 'rider',
      nickname: 'Rider',
      passwordHash: 'password-hash',
    });
  });

  it('does not persist when password hashing fails', async () => {
    const register = vi.fn();
    const hash = vi.fn().mockRejectedValue(new Error('invalid password input'));
    const { useCase } = setup(register, hash);

    await expect(
      useCase.execute({
        account: 'rider',
        password: 'valid password',
        nickname: 'Rider',
      }),
    ).rejects.toThrow('invalid password input');
    expect(register).not.toHaveBeenCalled();
  });

  it('preserves the repository account-conflict result', async () => {
    const register = vi
      .fn()
      .mockRejectedValue(new AccountAlreadyRegisteredError());
    const { useCase } = setup(register);

    await expect(
      useCase.execute({
        account: 'rider',
        password: 'passphrase',
        nickname: 'Rider',
      }),
    ).rejects.toBeInstanceOf(AccountAlreadyRegisteredError);
  });

  it('normalizes account and nickname before hashing and persistence', async () => {
    const { useCase, register } = setup();

    await useCase.execute({
      account: '  Rider.Name  ',
      password: 'eight-byte',
      nickname: '  Snow Rider  ',
    });

    expect(register).toHaveBeenCalledWith({
      account: 'rider.name',
      nickname: 'Snow Rider',
      passwordHash: 'password-hash',
    });
  });

  it.each([
    {
      account: '  ',
      password: 'valid-pass',
      nickname: 'Rider',
      field: 'account',
    },
    {
      account: 'rider',
      password: 'short',
      nickname: 'Rider',
      field: 'password',
    },
    {
      account: 'rider',
      password: '雪'.repeat(25),
      nickname: 'Rider',
      field: 'password',
    },
    {
      account: 'rider',
      password: 'valid-pass',
      nickname: '  ',
      field: 'nickname',
    },
  ] as const)(
    'rejects invalid $field without hashing or persistence',
    async (input) => {
      const { useCase, register, hash } = setup();

      await expect(useCase.execute(input)).rejects.toMatchObject({
        name: 'InvalidRegistrationInputError',
        field: input.field,
      });
      expect(hash).not.toHaveBeenCalled();
      expect(register).not.toHaveBeenCalled();
    },
  );
});
