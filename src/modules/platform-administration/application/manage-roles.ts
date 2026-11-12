import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ManagementWriteAuthorizationError } from '../../identity-access/domain/management-write-authorization.js';
import {
  MANAGED_ROLE_REPOSITORY,
  type ManagedRoleRepository,
} from './ports/managed-role-repository.js';
import {
  ManagedRoleActorUnavailableError,
  ManagedRoleScopeAuthorizationError,
  ManagedRoleNotFoundError,
  ProtectedManagedRoleError,
  RegistrationRoleRequiredError,
} from './role-management-errors.js';
import {
  validateCreateManagedRole,
  validateUpdateManagedRole,
  type CreateManagedRoleInput,
  type ManagedRoleFilter,
  type ManagedRoleStatus,
  type RoleAuditContext,
  type UpdateManagedRoleInput,
} from '../domain/managed-role.js';

@Injectable()
export class ManageRoles {
  constructor(
    @Inject(MANAGED_ROLE_REPOSITORY)
    private readonly roles: ManagedRoleRepository,
  ) {}

  async list(input: {
    page: number;
    pageSize: number;
    keyword?: string;
    status?: ManagedRoleStatus;
    roleIds?: readonly number[];
  }) {
    const skip = (input.page - 1) * input.pageSize;
    if (
      !Number.isSafeInteger(input.page) ||
      input.page < 1 ||
      !Number.isSafeInteger(input.pageSize) ||
      input.pageSize < 1 ||
      input.pageSize > 100
    ) {
      throw new BadRequestException('Role pagination is invalid');
    }
    if (!Number.isSafeInteger(skip) || skip > 2147483647) {
      throw new BadRequestException('Role pagination offset is invalid');
    }
    const filter: ManagedRoleFilter = {
      skip,
      take: input.pageSize,
      ...(input.keyword?.trim() ? { keyword: input.keyword.trim() } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.roleIds ? { roleIds: input.roleIds } : {}),
    };
    const result = await this.roles.list(filter);
    return {
      ...result,
      page: input.page,
      pageSize: input.pageSize,
      hasNext: input.page < Math.ceil(result.total / input.pageSize),
    };
  }

  async get(roleId: number) {
    this.assertRoleId(roleId);
    const role = await this.roles.findById(roleId);
    if (!role) throw new NotFoundException('Role not found');
    return role;
  }

  async create(input: {
    role: CreateManagedRoleInput;
    audit: RoleAuditContext;
  }) {
    const issues = validateCreateManagedRole(input.role);
    if (issues.length) {
      throw new BadRequestException({
        message: 'Role definition is invalid',
        details: issues.map((code) => ({ code, message: code })),
      });
    }
    try {
      return await this.roles.create(input);
    } catch (error) {
      this.mapRepositoryError(error);
    }
  }

  async update(input: {
    roleId: number;
    patch: UpdateManagedRoleInput;
    audit: RoleAuditContext;
  }) {
    this.assertRoleId(input.roleId);
    const issues = validateUpdateManagedRole(input.patch);
    if (issues.length) {
      throw new BadRequestException({
        message: 'Role update is invalid',
        details: issues.map((code) => ({ code, message: code })),
      });
    }
    try {
      const role = await this.roles.update(input);
      if (!role) throw new NotFoundException('Role not found');
      return role;
    } catch (error) {
      this.mapRepositoryError(error);
    }
  }

  async disable(input: { roleId: number; audit: RoleAuditContext }) {
    this.assertRoleId(input.roleId);
    try {
      const found = await this.roles.disable(input);
      if (!found) throw new NotFoundException('Role not found');
    } catch (error) {
      this.mapRepositoryError(error);
    }
  }

  private assertRoleId(roleId: number): void {
    if (!Number.isSafeInteger(roleId) || roleId < 1) {
      throw new BadRequestException('Role ID is invalid');
    }
  }

  private mapRepositoryError(error: unknown): never {
    if (error instanceof ProtectedManagedRoleError) {
      throw new ForbiddenException(error.message);
    }
    if (error instanceof RegistrationRoleRequiredError) {
      throw new ConflictException(error.message);
    }
    if (error instanceof ManagedRoleNotFoundError) {
      throw new NotFoundException(error.message);
    }
    if (
      error instanceof ManagedRoleActorUnavailableError ||
      error instanceof ManagedRoleScopeAuthorizationError ||
      error instanceof ManagementWriteAuthorizationError
    ) {
      throw new ForbiddenException(error.message);
    }
    const code = getPrismaErrorCode(error);
    if (code === 'P2002') {
      throw new ConflictException('Role key already exists');
    }
    if (code === 'P2034') {
      throw new ConflictException(
        'Role changed concurrently; reload and retry',
      );
    }
    throw error;
  }
}

function getPrismaErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const candidate = error as { code?: unknown };
  return typeof candidate.code === 'string' ? candidate.code : null;
}
