import type { UserManagementAudit } from './managed-user-repository.js';
import type { CustomFieldValue } from '../../../platform-administration/domain/custom-field-validation.js';

export const MERCHANT_PROFILE_REPOSITORY = Symbol(
  'MERCHANT_PROFILE_REPOSITORY',
);
export interface AdminMerchantProfile {
  merchantId: number;
  userId: number;
  businessName: string;
  contact: string | null;
  status: string;
  customFields: Record<string, CustomFieldValue>;
  schemaVersion: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}
export interface MerchantProfilePatch {
  businessName?: string;
  contact?: string | null;
  customFields?: Record<string, unknown>;
}
export interface MerchantProfileCommand {
  userId: number;
  kind: 'create' | 'update' | 'status';
  expectedVersion?: number;
  patch: MerchantProfilePatch;
  status?: 'active' | 'disabled';
  reason: string;
  audit: UserManagementAudit;
}
export interface MerchantProfileRepository {
  read(
    userId: number,
    actorUserId: number,
  ): Promise<AdminMerchantProfile | null>;
  schema(actorUserId: number): Promise<unknown>;
  write(command: MerchantProfileCommand): Promise<AdminMerchantProfile>;
}
