import type { NormalizedPublicResortQuery } from '../../domain/public-resort-query.js';
import type { PublicResortRecord } from '../public-resort-models.js';

export const PUBLIC_RESORT_READER = Symbol('PUBLIC_RESORT_READER');
export interface PublicResortReader {
  findPublicFitTags(): Promise<{ value: string; label: string }[]>;
  findPage(
    query: NormalizedPublicResortQuery,
    userId?: number,
  ): Promise<{ items: PublicResortRecord[]; total: number }>;
  find(resortId: number, userId?: number): Promise<PublicResortRecord | null>;
}
