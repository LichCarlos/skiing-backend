import type { FavoriteTargetType } from '../../domain/favorite-rules.js';

export const FAVORITE_REPOSITORY = Symbol('FAVORITE_REPOSITORY');

export type FavoriteTargetRecord =
  | {
      targetType: 'resort';
      id: number;
      name: string;
      province: string | null;
      city: string | null;
      district: string | null;
      rating: number | null;
      startingPrice: string;
    }
  | {
      targetType: 'article';
      id: number;
      title: string;
      summary: string;
      category: string;
      publishedAt: Date;
    }
  | {
      targetType: 'dynamic';
      id: number;
      summary: string;
      authorNickname: string;
      createdAt: Date;
    };

export interface FavoriteRecord {
  favoriteId: string;
  favoritedAt: Date;
  target: FavoriteTargetRecord;
}

export interface FavoritePageQuery {
  userId: number;
  skip: number;
  take: number;
  targetType?: FavoriteTargetType;
}

export interface FavoriteRepository {
  hasPublicTarget(
    userId: number,
    type: FavoriteTargetType,
    id: number,
  ): Promise<boolean>;
  /** Checks public availability and upserts the owner relation in one transaction. */
  addPublicTarget(
    userId: number,
    type: FavoriteTargetType,
    id: number,
  ): Promise<boolean>;
  /** Also permits removing a relation whose target is no longer public. */
  remove(userId: number, type: FavoriteTargetType, id: number): Promise<void>;
  findPage(
    query: FavoritePageQuery,
  ): Promise<{ items: FavoriteRecord[]; total: number }>;
}
