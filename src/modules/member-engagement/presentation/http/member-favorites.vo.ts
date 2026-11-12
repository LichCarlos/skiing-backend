import { ApiExtraModels, ApiProperty, getSchemaPath } from '@nestjs/swagger';
export class FavoriteStateVO {
  @ApiProperty() favorited!: boolean;
}

export class ResortFavoriteSummaryVO {
  @ApiProperty({ enum: ['resort'] })
  targetType!: 'resort';

  @ApiProperty()
  id!: number;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: String, nullable: true })
  province!: string | null;

  @ApiProperty({ type: String, nullable: true })
  city!: string | null;

  @ApiProperty({ type: String, nullable: true })
  district!: string | null;

  @ApiProperty({ type: Number, nullable: true })
  rating!: number | null;

  @ApiProperty()
  startingPrice!: string;
}

export class ArticleFavoriteSummaryVO {
  @ApiProperty({ enum: ['article'] })
  targetType!: 'article';

  @ApiProperty()
  id!: number;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  summary!: string;

  @ApiProperty()
  category!: string;

  @ApiProperty({ format: 'date-time' })
  publishedAt!: string;
}

export class DynamicFavoriteSummaryVO {
  @ApiProperty({ enum: ['dynamic'] }) targetType!: 'dynamic';
  @ApiProperty() id!: number;
  @ApiProperty() summary!: string;
  @ApiProperty() authorNickname!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

@ApiExtraModels(
  ResortFavoriteSummaryVO,
  ArticleFavoriteSummaryVO,
  DynamicFavoriteSummaryVO,
)
export class FavoriteItemVO {
  @ApiProperty()
  favoriteId!: string;

  @ApiProperty({ enum: ['resort', 'article', 'dynamic'] })
  targetType!: 'resort' | 'article' | 'dynamic';

  @ApiProperty({ format: 'date-time' })
  favoritedAt!: string;

  @ApiProperty({
    oneOf: [
      { $ref: getSchemaPath(ResortFavoriteSummaryVO) },
      { $ref: getSchemaPath(ArticleFavoriteSummaryVO) },
      { $ref: getSchemaPath(DynamicFavoriteSummaryVO) },
    ],
  })
  target!:
    | ResortFavoriteSummaryVO
    | ArticleFavoriteSummaryVO
    | DynamicFavoriteSummaryVO;
}

export class FavoritePageVO {
  @ApiProperty({ type: () => FavoriteItemVO, isArray: true })
  items!: FavoriteItemVO[];

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiProperty()
  total!: number;
}
