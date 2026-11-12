import type { UserManagementAudit } from './managed-user-repository.js';

export const ADMIN_PASSWORD_RESET_REPOSITORY = Symbol(
  'ADMIN_PASSWORD_RESET_REPOSITORY',
);

export interface AdminPasswordResetRepository {
  reset(input: {
    userId: number;
    passwordHash: string;
    reason: string;
    audit: UserManagementAudit;
    now: Date;
  }): Promise<void>;
}
