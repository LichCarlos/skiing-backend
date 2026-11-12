export const USER_REGISTRATION_REPOSITORY = Symbol(
  'USER_REGISTRATION_REPOSITORY',
);

export interface RegisterUserRecord {
  account: string;
  nickname: string;
  passwordHash: string;
}

export interface RegisteredUserRecord {
  userId: number;
  account: string;
  nickname: string;
}

export interface UserRegistrationRepository {
  register(input: RegisterUserRecord): Promise<RegisteredUserRecord>;
}
