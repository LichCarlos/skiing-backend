import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpsertArticleDto {
  @ApiPropertyOptional({ enum: ['plain_text', 'markdown_v1'], description: 'Omitted means legacy plain text; explicit format required when updating Markdown.' })
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsIn(['plain_text', 'markdown_v1'])
  contentFormat?: 'plain_text' | 'markdown_v1';

  @ApiPropertyOptional({ minimum: 1, description: 'Required for Markdown updates; compare-and-swap version.' })
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  expectedVersion?: number;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  title!: string;

  @ApiProperty({ maxLength: 1000 })
  @IsString()
  @MaxLength(1000)
  summary!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(100000)
  body!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  coverAssetId?: string | null;

  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MaxLength(100)
  categoryValue!: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsObject()
  customFields?: Record<string, unknown>;
}

export class AdminArticleListQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  keyword?: string;

  @ApiPropertyOptional({ enum: ['draft', 'published', 'withdrawn'] })
  @IsOptional()
  @IsIn(['draft', 'published', 'withdrawn'])
  status?: 'draft' | 'published' | 'withdrawn';
}
