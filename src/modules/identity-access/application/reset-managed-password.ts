import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ADMIN_PASSWORD_RESET_REPOSITORY,
  type AdminPasswordResetRepository,
} from './ports/admin-password-reset-repository.js';
import {
  PASSWORD_HASHER,
  type PasswordHasher,
} from './ports/password-hasher.js';
import type { UserManagementAudit } from './ports/managed-user-repository.js';
import { isValidPasswordLength } from '../domain/registration-rules.js';
import {
  passwordResetReason,
  PasswordResetConflictError,
  PasswordResetTargetMissingError,
  validPasswordResetTarget,
} from '../domain/password-reset.js';
import { ManagementWriteAuthorizationError } from '../domain/management-write-authorization.js';

@Injectable()
export class ResetManagedPassword {
  constructor(
    @Inject(ADMIN_PASSWORD_RESET_REPOSITORY)
    private readonly repository: AdminPasswordResetRepository,
    @Inject(PASSWORD_HASHER) private readonly passwords: PasswordHasher,
  ) {}

  async execute(input: {
    userId: number;
    newPassword: string;
    reason: string;
    audit: UserManagementAudit;
  }): Promise<void> {
    const reason = passwordResetReason(input.reason);
    if (
      !validPasswordResetTarget(input.userId) ||
      typeof input.newPassword !== 'string' ||
      !isValidPasswordLength(input.newPassword) ||
      !reason
    )
      throw new BadRequestException('Invalid password reset input');
    const passwordHash = await this.passwords.hash(input.newPassword);
    try {
      await this.repository.reset({
        userId: input.userId,
        passwordHash,
        reason,
        audit: input.audit,
        now: new Date(),
      });
    } catch (error) {
      if (error instanceof ManagementWriteAuthorizationError)
        throw new ForbiddenException(
          'Password reset authorization is unavailable',
        );
      if (error instanceof PasswordResetTargetMissingError)
        throw new NotFoundException('User not found');
      if (error instanceof PasswordResetConflictError)
        throw new ConflictException(
          'Password reset conflicted; read the target and explicitly retry',
        );
      throw error;
    }
  }
}
