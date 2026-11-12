import type {
  BusinessEntity,
  BusinessQuery,
  QueryField,
} from '../../../platform-administration/domain/business-query.js';
export const EXACT_BUSINESS_READER = Symbol('EXACT_BUSINESS_READER');
export interface ExactBusinessReader {
  fields(entity: BusinessEntity): Promise<QueryField[]>;
  query(
    entity: BusinessEntity,
    input: BusinessQuery,
  ): Promise<{
    items: {
      id: number;
      title: string;
      fields: Record<string, unknown>;
      customFields: Record<string, unknown>;
    }[];
    total: number;
    asOf: string;
  }>;
}
