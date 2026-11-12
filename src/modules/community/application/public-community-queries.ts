import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { DynamicFeedQuery, PageQuery } from './community-models.js';
import {
  assertCommunityId,
  assertCommunityPage,
} from '../domain/community-rules.js';
import { communityInput } from './community-transaction.js';
import {
  PUBLIC_COMMUNITY_READER,
  type PublicCommunityReader,
} from './ports/public-community-reader.js';
@Injectable()
export class PublicCommunityQueries {
  constructor(
    @Inject(PUBLIC_COMMUNITY_READER)
    private readonly reader: PublicCommunityReader,
  ) {}
  async dynamics(query: DynamicFeedQuery, userId?: number) {
    const limit = query.limit ?? 20;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new BadRequestException('Invalid feed limit');
    const slice = await this.reader.dynamics(
      {
        limit,
        keyword: query.keyword,
        before: query.cursor !== undefined ? decodeCursor(query.cursor) : null,
      },
      userId,
    );
    const last = slice.items.at(-1);
    return {
      ...slice,
      nextCursor:
        slice.hasNext && last
          ? Buffer.from(
              JSON.stringify({
                createdAt: last.createdAt,
                dynamicId: last.dynamicId,
              }),
            ).toString('base64url')
          : null,
    };
  }
  async dynamic(id: number, userId?: number) {
    communityInput(() => assertCommunityId(id));
    const detail = await this.reader.dynamic(id, userId);
    if (!detail) throw new NotFoundException('Dynamic not found');
    return detail;
  }
  async comments(id: number, query: PageQuery) {
    communityInput(() => {
      assertCommunityId(id);
      assertCommunityPage(query);
    });
    const result = await this.reader.comments(id, query);
    if (!result) throw new NotFoundException('Dynamic not found');
    return result;
  }
}
function decodeCursor(value: string): { createdAt: Date; dynamicId: number } {
  try {
    if (
      typeof value !== 'string' ||
      value.length > 512 ||
      !/^[A-Za-z0-9_-]+$/.test(value)
    )
      throw new Error();
    const bytes = Buffer.from(value, 'base64url');
    if (bytes.toString('base64url') !== value) throw new Error();
    const parsed: unknown = JSON.parse(bytes.toString('utf8'));
    if (!parsed || typeof parsed !== 'object') throw new Error();
    const candidate = parsed as { createdAt?: unknown; dynamicId?: unknown };
    if (
      Object.keys(candidate).length !== 2 ||
      typeof candidate.createdAt !== 'string'
    )
      throw new Error();
    const createdAt = new Date(candidate.createdAt);
    assertCommunityId(candidate.dynamicId as number);
    if (
      Number.isNaN(createdAt.getTime()) ||
      candidate.createdAt !== createdAt.toISOString()
    )
      throw new Error();
    return { createdAt, dynamicId: Number(candidate.dynamicId) };
  } catch {
    throw new BadRequestException('Invalid cursor');
  }
}
