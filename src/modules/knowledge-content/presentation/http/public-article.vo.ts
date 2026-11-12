import { ArticleBodyAssetVO } from './article-body.vo.js';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PublicArticleCategoryVO {
  @ApiProperty()
  value!: string;

  @ApiProperty()
  label!: string;
}

export class PublicArticleSummaryVO {
  @ApiProperty({
    description: 'Current authenticated user favorite; false for guests',
  })
  favoriteByMe!: boolean;

  @ApiProperty()
  articleId!: number;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  summary!: string;

  @ApiProperty({ type: String, nullable: true })
  coverUrl!: string | null;

  @ApiProperty({ type: () => PublicArticleCategoryVO })
  category!: PublicArticleCategoryVO;

  @ApiProperty({ type: String, nullable: true })
  authorName!: string | null;

  @ApiProperty({ format: 'date-time' })
  publishTime!: string;
}

export class PublicArticleDetailVO extends PublicArticleSummaryVO {
  @ApiPropertyOptional({ enum: ['plain_text', 'markdown_v1'] })
  contentFormat?: 'plain_text' | 'markdown_v1';
  @ApiPropertyOptional({ type: () => ArticleBodyAssetVO, isArray: true })
  bodyAssets?: ArticleBodyAssetVO[];

  @ApiProperty()
  body!: string;
}

export class PublicArticlePageVO {
  @ApiProperty({ type: () => PublicArticleSummaryVO, isArray: true })
  items!: PublicArticleSummaryVO[];

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiProperty()
  total!: number;

  @ApiProperty()
  hasNext!: boolean;
}
