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
  ROLE_AUTHORIZATION_REPOSITORY,
  type RoleAuthorizationAuditContext,
  type RoleAuthorizationInput,
  type RoleAuthorizationRepository,
  type RoleAuthorizationSnapshot,
} from './ports/role-authorization-repository.js';
import {
  InvalidRoleAuthorizationReferenceError,
  ProtectedSystemRoleError,
  RoleAuthorizationActorUnavailableError,
  RoleAuthorizationAdministratorRequiredError,
  RoleAuthorizationNotFoundError,
} from './role-authorization-errors.js';
import { validateRoleAuthorization } from '../domain/role-authorization.js';

@Injectable()
export class ManageRoleAuthorization {
  constructor(
    @Inject(ROLE_AUTHORIZATION_REPOSITORY)
    private readonly authorizations: RoleAuthorizationRepository,
  ) {}

  async get(roleId: number): Promise<RoleAuthorizationSnapshot> {
    this.validateRoleId(roleId);
    const snapshot = await this.authorizations.findSnapshot(roleId);
    if (!snapshot) throw new NotFoundException('Role not found');
    return snapshot;
  }

  async replace(input: {
    roleId: number;
    authorization: RoleAuthorizationInput;
    audit: RoleAuthorizationAuditContext;
  }): Promise<RoleAuthorizationSnapshot> {
    this.validateRoleId(input.roleId);
    const issues = validateRoleAuthorization(input.authorization);
    if (issues.length > 0) {
      throw new BadRequestException({
        message: 'Role authorization snapshot is invalid',
        details: issues.map((code) => ({ code, message: code })),
      });
    }
    try {
      const snapshot = await this.authorizations.replaceAuthorization(input);
      if (!snapshot) throw new NotFoundException('Role not found');
      return snapshot;
    } catch (error) {
      if (
        error instanceof ProtectedSystemRoleError ||
        error instanceof RoleAuthorizationAdministratorRequiredError ||
        error instanceof ManagementWriteAuthorizationError
      ) {
        throw new ForbiddenException(error.message);
      }
      if (error instanceof RoleAuthorizationNotFoundError) {
        throw new NotFoundException(error.message);
      }
      if (
        error instanceof InvalidRoleAuthorizationReferenceError ||
        error instanceof RoleAuthorizationActorUnavailableError
      ) {
        throw new BadRequestException(error.message);
      }
      if (getPrismaErrorCode(error) === 'P2034') {
        throw new ConflictException(
          'Role authorization changed concurrently; reload and retry',
        );
      }
      throw error;
    }
  }

  private validateRoleId(roleId: number): void {
    if (!Number.isSafeInteger(roleId) || roleId < 1) {
      throw new BadRequestException('Role ID is invalid');
    }
  }
}

function getPrismaErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const candidate = error as { code?: unknown };
  return typeof candidate.code === 'string' ? candidate.code : null;
}
