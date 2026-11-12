import type {
  BusinessEntity,
  BusinessQuery,
  QueryField,
} from '../../domain/business-query.js';
export const BUSINESS_QUERY_READER = Symbol('BUSINESS_QUERY_READER');
export interface BusinessRow {
  id: number;
  title: string;
  fields: Record<string, unknown>;
  customFields: Record<string, unknown>;
}
export interface BusinessQueryResult {
  items: BusinessRow[];
  total: number;
  page: number;
  pageSize: number;
  asOf: string;
}
export interface BusinessQueryReader {
  fields(entity: BusinessEntity): Promise<QueryField[]>;
  query(
    entity: BusinessEntity,
    query: BusinessQuery,
  ): Promise<BusinessQueryResult>;
}
