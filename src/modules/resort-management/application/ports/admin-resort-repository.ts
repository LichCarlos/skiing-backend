import type { MerchantResortStatus } from '../../domain/merchant-resort.js';
import type { ResortRelations } from '../merchant-resort-models.js';
import type {
  AdminResortAuditContext,
  AdminResortRecord,
  AdminResortValues,
  AdminResortQuery,
} from '../admin-resort-models.js';
import type { CustomFieldSchemaGroup } from '../../../platform-administration/application/ports/custom-field-repository.js';

export const ADMIN_RESORT_REPOSITORY = Symbol('ADMIN_RESORT_REPOSITORY');
export interface AdminResortTransaction {
  authorize(actorUserId: number, permission: string): Promise<void>;
  fieldContext(actorUserId: number): Promise<{
    definitions: readonly import('../../../platform-administration/domain/custom-field-validation.js').CustomFieldDefinition[];
    policies: ReadonlyMap<
      string,
      import('../../../platform-administration/domain/custom-field-validation.js').CustomFieldAccessPolicy
    >;
    dictionaryValues: ReadonlyMap<string, ReadonlySet<string>>;
  }>;
  find(resortId: number): Promise<AdminResortRecord | null>;
  assertReferences(
    actorUserId: number,
    merchantId: number | null,
    relations: ResortRelations,
    // Only the application derives this flag from explicitly submitted IDs;
    // retained references still receive readiness/MIME checks and shared locks.
    options?: { requireAssetAssociationPermission: boolean },
  ): Promise<void>;
  create(values: AdminResortValues): Promise<number>;
  update(
    resortId: number,
    expectedUpdatedAt: Date,
    change: {
      values?: AdminResortValues;
      status?: MerchantResortStatus;
      deletedAt?: Date;
    },
  ): Promise<boolean>;
  replaceRelations(resortId: number, relations: ResortRelations): Promise<void>;
  appendChanged(
    resortId: number,
    merchantId: number | null,
    status: string,
  ): Promise<void>;
  audit(
    context: AdminResortAuditContext,
    change: {
      actionKey: string;
      resortId: number;
      metadata: Record<string, unknown>;
      reason?: string | null;
    },
  ): Promise<void>;
}
export interface AdminResortRepository {
  findPage(
    query: AdminResortQuery,
  ): Promise<{ items: AdminResortRecord[]; total: number }>;
  find(resortId: number): Promise<AdminResortRecord | null>;
  findCustomFieldSchema(actorUserId: number): Promise<{
    groups: CustomFieldSchemaGroup[];
    policies: ReadonlyMap<string, { canRead: boolean; canWrite: boolean }>;
  }>;
  runWrite<T>(
    work: (transaction: AdminResortTransaction) => Promise<T>,
  ): Promise<T>;
}
