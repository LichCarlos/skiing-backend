import { Inject, Injectable } from '@nestjs/common';
import {
  BUSINESS_QUERY_READER,
  type BusinessQueryReader,
} from './ports/business-query-reader.js';
import type {
  BusinessEntity,
  BusinessQuery,
} from '../domain/business-query.js';
@Injectable()
export class QueryBusinessData {
  constructor(
    @Inject(BUSINESS_QUERY_READER) private readonly reader: BusinessQueryReader,
  ) {}
  fields(entity: BusinessEntity) {
    return this.reader.fields(entity);
  }
  query(entity: BusinessEntity, input: BusinessQuery) {
    return this.reader.query(entity, input);
  }
}
