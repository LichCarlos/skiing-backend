import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PASSWORD_HASHER,
  type PasswordHasher,
} from './ports/password-hasher.js';
import {
  MANAGED_USER_REPOSITORY,
  type ManagedUserRepository,
  type UserManagementAudit,
} from './ports/managed-user-repository.js';
import {
  isValidAccount,
  isValidNickname,
  isValidPasswordLength,
  normalizeAccount,
  normalizeNickname,
} from '../domain/registration-rules.js';
import {
  MANAGED_USER_STATUSES,
  areValidManagedUserRoleIds,
  type ManagedUserStatus,
} from '../domain/managed-user.js';
import { ManagementWriteAuthorizationError } from '../domain/management-write-authorization.js';

@Injectable()
export class ManageUsers {
  constructor(
    @Inject(MANAGED_USER_REPOSITORY)
    private readonly users: ManagedUserRepository,
    @Inject(PASSWORD_HASHER)
    private readonly passwords: PasswordHasher,
  ) {}

  async list(input: {
    page: number;
    pageSize: number;
    keyword?: string;
    status?: ManagedUserStatus;
    scope: import('../domain/authorization.js').ResolvedDataScope;
  }) {
    if (
      !Number.isSafeInteger(input.page) ||
      input.page < 1 ||
      !Number.isSafeInteger(input.pageSize) ||
      input.pageSize < 1 ||
      input.pageSize > 100
    ) {
      throw new BadRequestException('User pagination is invalid');
    }
    const offset = (input.page - 1) * input.pageSize;
    if (!Number.isSafeInteger(offset) || offset > 2147483647)
      throw new BadRequestException('User pagination offset is invalid');
    const result = await this.users.list({
      ...input,
      keyword: input.keyword?.trim() || undefined,
    });
    return {
      ...result,
      page: input.page,
      pageSize: input.pageSize,
      hasNext: input.page < Math.ceil(result.total / input.pageSize),
    };
  }

  async get(
    userId: number,
    scope: import('../domain/authorization.js').ResolvedDataScope,
  ) {
    this.assertUserId(userId);
    const user = await this.users.findById(userId, scope);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async create(input: {
    account: string;
    nickname: string;
    password: string;
    roleIds: readonly number[];
    audit: UserManagementAudit;
  }) {
    const account = normalizeAccount(input.account);
    const nickname = normalizeNickname(input.nickname);
    this.assertRoleIds(input.roleIds);
    if (!isValidAccount(account) || !isValidNickname(nickname)) {
      throw new BadRequestException('Account or nickname is invalid');
    }
    if (!isValidPasswordLength(input.password)) {
      throw new BadRequestException('Password must be 8 to 72 UTF-8 bytes');
    }
    try {
      const passwordHash = await this.passwords.hash(input.password);
      return await this.users.create({
        account,
        nickname,
        passwordHash,
        roleIds: input.roleIds,
        audit: input.audit,
      });
    } catch (error) {
      this.mapRepositoryError(error);
    }
  }

  async replaceRoles(input: {
    userId: number;
    roleIds: readonly number[];
    audit: UserManagementAudit;
  }) {
    this.assertUserId(input.userId);
    this.assertRoleIds(input.roleIds);
    try {
      const user = await this.users.replaceRoles(input);
      if (!user) throw new NotFoundException('User not found');
      return user;
    } catch (error) {
      this.mapRepositoryError(error);
    }
  }

  async setStatus(input: {
    userId: number;
    status: ManagedUserStatus;
    audit: UserManagementAudit;
  }) {
    this.assertUserId(input.userId);
    if (!MANAGED_USER_STATUSES.includes(input.status)) {
      throw new BadRequestException('User status is invalid');
    }
    try {
      const user = await this.users.setStatus(input);
      if (!user) throw new NotFoundException('User not found');
      return user;
    } catch (error) {
      this.mapRepositoryError(error);
    }
  }

  private assertUserId(userId: number): void {
    if (!Number.isSafeInteger(userId) || userId < 1 || userId > 2147483647) {
      throw new BadRequestException('User ID is invalid');
    }
  }

  private assertRoleIds(roleIds: readonly number[]): void {
    if (!areValidManagedUserRoleIds(roleIds))
      throw new BadRequestException('Role IDs are invalid');
  }

  private mapRepositoryError(error: unknown): never {
    if (error instanceof ManagementWriteAuthorizationError)
      throw new ForbiddenException(error.message);
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'P2034'
    )
      throw new ConflictException(
        'User changed concurrently; reload and retry',
      );
    if (error instanceof ManagedUserConflictError) {
      throw new ConflictException(error.message);
    }
    if (error instanceof ManagedUserInputError) {
      throw new BadRequestException(error.message);
    }
    throw error;
  }
}

export class ManagedUserConflictError extends Error {}
export class ManagedUserInputError extends Error {}
