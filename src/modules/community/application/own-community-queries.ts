import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  assertCommunityId,
  assertCommunityPage,
} from '../domain/community-rules.js';
import { communityInput } from './community-transaction.js';
import {
  OWN_DYNAMICS_READER,
  type OwnDynamicsQuery,
  type OwnDynamicsReader,
} from './ports/own-dynamics-reader.js';

@Injectable()
export class OwnCommunityQueries {
  constructor(
    @Inject(OWN_DYNAMICS_READER) private readonly reader: OwnDynamicsReader,
  ) {}

  schema(userId: number) {
    return this.reader.schema(userId);
  }
  list(userId: number, query: OwnDynamicsQuery) {
    communityInput(() => assertCommunityPage(query));
    return this.reader.list(userId, query);
  }

  async get(userId: number, dynamicId: number) {
    communityInput(() => assertCommunityId(dynamicId));
    const detail = await this.reader.find(userId, dynamicId);
    if (!detail) throw new NotFoundException('Dynamic not found');
    return detail;
  }
}
