import type { MerchantResortAccess } from '../../domain/resort-management-scope.js';
import type {
  CustomFieldDefinition,
  CustomFieldAccessPolicy,
} from '../../../platform-administration/domain/custom-field-validation.js';
import type {
  MerchantResortFieldGrant,
  MerchantResortStatus,
} from '../../domain/merchant-resort.js';
import type {
  MerchantResortAuditChange,
  MerchantResortAuditContext,
  MerchantResortRecord,
  MerchantResortValues,
  ResortRelations,
} from '../merchant-resort-models.js';

export const MERCHANT_RESORT_REPOSITORY = Symbol('MERCHANT_RESORT_REPOSITORY');

export interface MerchantResortTransaction {
  authorize(access: MerchantResortAccess, permission: string): Promise<string>;
  fieldContext(userId: number): Promise<{
    definitions: CustomFieldDefinition[];
    policies: ReadonlyMap<string, CustomFieldAccessPolicy>;
    dictionaryValues: ReadonlyMap<string, ReadonlySet<string>>;
  }>;
  requireActiveActor(access: MerchantResortAccess): Promise<string>;
  find(
    access: MerchantResortAccess,
    resortId: number,
  ): Promise<MerchantResortRecord | null>;
  assertReferences(userId: number, relations: ResortRelations): Promise<void>;
  create(merchantId: number, data: MerchantResortValues): Promise<number>;
  update(
    access: MerchantResortAccess,
    resortId: number,
    expectedUpdatedAt: Date,
    change: {
      values?: MerchantResortValues;
      status?: MerchantResortStatus;
      deletedAt?: Date;
    },
  ): Promise<boolean>;
  replaceRelations(resortId: number, relations: ResortRelations): Promise<void>;
  appendChanged(
    resortId: number,
    merchantId: number,
    status: string,
  ): Promise<void>;
  audit(
    userId: number,
    account: string,
    context: MerchantResortAuditContext,
    change: MerchantResortAuditChange,
  ): Promise<void>;
}

export interface MerchantResortRepository {
  findPage(
    access: MerchantResortAccess,
    query: { status?: string; skip: number; take: number },
  ): Promise<{ items: MerchantResortRecord[]; total: number }>;
  find(
    access: MerchantResortAccess,
    resortId: number,
  ): Promise<MerchantResortRecord | null>;
  requireActiveActor(access: MerchantResortAccess): Promise<string>;
  fieldGrants(userId: number): Promise<MerchantResortFieldGrant[][]>;
  runWrite<T>(
    work: (transaction: MerchantResortTransaction) => Promise<T>,
  ): Promise<T>;
}
