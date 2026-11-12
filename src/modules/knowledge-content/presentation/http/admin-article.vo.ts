import { ArticleBodyAssetVO } from './article-body.vo.js';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AdminArticleCategoryVO {
  @ApiProperty()
  value!: string;

  @ApiProperty()
  label!: string;
}

export class AdminArticleVO {
  @ApiPropertyOptional({ enum: ['plain_text', 'markdown_v1'] })
  contentFormat?: 'plain_text' | 'markdown_v1';
  @ApiPropertyOptional({ type: () => ArticleBodyAssetVO, isArray: true })
  bodyAssets?: ArticleBodyAssetVO[];

  @ApiProperty()
  articleId!: number;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  summary!: string;

  @ApiProperty()
  body!: string;

  @ApiProperty({ type: String, nullable: true })
  coverAssetId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  coverUrl!: string | null;

  @ApiProperty({ type: () => AdminArticleCategoryVO })
  category!: AdminArticleCategoryVO;

  @ApiProperty({ type: String, nullable: true })
  authorName!: string | null;

  @ApiProperty({ enum: ['draft', 'published', 'withdrawn'] })
  status!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  publishTime!: string | null;

  @ApiProperty()
  version!: number;

  @ApiProperty({ type: 'object', additionalProperties: true })
  customFields!: Record<string, unknown>;

  @ApiProperty({ format: 'date-time' })
  createTime!: string;

  @ApiProperty({ format: 'date-time' })
  updateTime!: string;
}

export class AdminArticleListItemVO extends AdminArticleVO {}

export class AdminArticlePageVO {
  @ApiProperty({ type: () => AdminArticleListItemVO, isArray: true })
  items!: AdminArticleListItemVO[];

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiProperty()
  total!: number;

  @ApiPropertyOptional()
  hasNext?: boolean;
}
