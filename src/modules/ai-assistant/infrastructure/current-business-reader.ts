import { Injectable } from '@nestjs/common';
import { QueryBusinessData } from '../../platform-administration/application/query-business-data.js';
import type {
  BusinessEntity,
  BusinessQuery,
} from '../../platform-administration/domain/business-query.js';
import type { ExactBusinessReader } from '../application/ports/exact-business-reader.js';
@Injectable()
export class CurrentBusinessReader implements ExactBusinessReader {
  constructor(private readonly queries: QueryBusinessData) {}
  fields(entity: BusinessEntity) {
    return this.queries.fields(entity);
  }
  query(entity: BusinessEntity, input: BusinessQuery) {
    return this.queries.query(entity, input);
  }
}
