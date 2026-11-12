import { Inject, Injectable } from '@nestjs/common';
import {
  PASSWORD_HASHER,
  type PasswordHasher,
} from './ports/password-hasher.js';
import {
  USER_REGISTRATION_REPOSITORY,
  type RegisteredUserRecord,
  type UserRegistrationRepository,
} from './ports/user-registration-repository.js';
import {
  isValidAccount,
  isValidNickname,
  isValidPasswordLength,
  normalizeAccount,
  normalizeNickname,
} from '../domain/registration-rules.js';

export interface RegisterUserInput {
  account: string;
  password: string;
  nickname: string;
}

export class AccountAlreadyRegisteredError extends Error {
  constructor() {
    super('Account is already registered');
    this.name = 'AccountAlreadyRegisteredError';
  }
}

export class ActiveUserRoleUnavailableError extends Error {
  constructor() {
    super('The active user role is not configured');
    this.name = 'ActiveUserRoleUnavailableError';
  }
}

export class InvalidRegistrationInputError extends Error {
  constructor(readonly field: 'account' | 'password' | 'nickname') {
    super(`Invalid registration ${field}`);
    this.name = 'InvalidRegistrationInputError';
  }
}

@Injectable()
export class RegisterUser {
  constructor(
    @Inject(USER_REGISTRATION_REPOSITORY)
    private readonly users: UserRegistrationRepository,
    @Inject(PASSWORD_HASHER)
    private readonly passwordHasher: PasswordHasher,
  ) {}

  async execute(input: RegisterUserInput): Promise<RegisteredUserRecord> {
    const account = normalizeAccount(input.account);
    const nickname = normalizeNickname(input.nickname);
    if (!isValidAccount(account))
      throw new InvalidRegistrationInputError('account');
    if (!isValidPasswordLength(input.password)) {
      throw new InvalidRegistrationInputError('password');
    }
    if (!isValidNickname(nickname)) {
      throw new InvalidRegistrationInputError('nickname');
    }

    const passwordHash = await this.passwordHasher.hash(input.password);
    return this.users.register({
      account,
      nickname,
      passwordHash,
    });
  }
}
