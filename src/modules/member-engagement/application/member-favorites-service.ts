import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  favoriteIdentity,
  favoritePage,
  favoriteTargetType,
  type FavoriteTargetType,
} from '../domain/favorite-rules.js';
import {
  FAVORITE_REPOSITORY,
  type FavoriteRepository,
} from './ports/favorite-repository.js';

export type { FavoriteTargetType } from '../domain/favorite-rules.js';

@Injectable()
export class MemberFavoritesService {
  constructor(
    @Inject(FAVORITE_REPOSITORY) private readonly favorites: FavoriteRepository,
  ) {}
  async state(
    userId: number,
    targetType: FavoriteTargetType,
    targetId: number,
  ) {
    validate(() => {
      favoriteIdentity(userId);
      favoriteIdentity(targetId);
      favoriteTargetType(targetType);
    });
    return {
      favorited: await this.favorites.hasPublicTarget(
        userId,
        targetType,
        targetId,
      ),
    };
  }

  async add(userId: number, targetType: FavoriteTargetType, targetId: number) {
    validate(() => {
      favoriteIdentity(userId);
      favoriteIdentity(targetId);
      favoriteTargetType(targetType);
    });
    if (!(await this.favorites.addPublicTarget(userId, targetType, targetId)))
      throw new NotFoundException('Favorite target not found');
  }

  async remove(
    userId: number,
    targetType: FavoriteTargetType,
    targetId: number,
  ) {
    validate(() => {
      favoriteIdentity(userId);
      favoriteIdentity(targetId);
      favoriteTargetType(targetType);
    });
    await this.favorites.remove(userId, targetType, targetId);
  }

  async list(
    userId: number,
    page: number,
    pageSize: number,
    targetType?: FavoriteTargetType,
  ) {
    const paging = validate(() => {
      favoriteIdentity(userId);
      if (targetType !== undefined) favoriteTargetType(targetType);
      return favoritePage(page, pageSize);
    });
    const result = await this.favorites.findPage({
      userId,
      skip: paging.skip,
      take: paging.pageSize,
      targetType,
    });
    return {
      items: result.items.map((row) => ({
        favoriteId: row.favoriteId,
        targetType: row.target.targetType,
        favoritedAt: row.favoritedAt.toISOString(),
        target:
          row.target.targetType === 'article'
            ? {
                ...row.target,
                publishedAt: row.target.publishedAt.toISOString(),
              }
            : row.target.targetType === 'dynamic'
              ? { ...row.target, createdAt: row.target.createdAt.toISOString() }
              : { ...row.target },
      })),
      page: paging.page,
      pageSize: paging.pageSize,
      total: result.total,
    };
  }
}

function validate<T>(work: () => T): T {
  try {
    return work();
  } catch (error) {
    if (error instanceof RangeError)
      throw new BadRequestException(error.message);
    throw error;
  }
}
