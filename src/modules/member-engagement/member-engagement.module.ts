import { Module } from '@nestjs/common';
import { MemberFavoritesController } from './presentation/http/member-favorites.controller.js';
import { MemberFavoritesService } from './application/member-favorites-service.js';
import { FAVORITE_REPOSITORY } from './application/ports/favorite-repository.js';
import { PrismaFavoriteRepository } from './infrastructure/prisma-favorite.repository.js';

@Module({
  controllers: [MemberFavoritesController],
  providers: [
    MemberFavoritesService,
    { provide: FAVORITE_REPOSITORY, useClass: PrismaFavoriteRepository },
  ],
})
export class MemberEngagementModule {}
