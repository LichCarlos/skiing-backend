import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsObject,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from '@nestjs/swagger';

export class DynamicListQueryDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  keyword?: string;

  @ApiPropertyOptional({
    description: 'Opaque cursor returned by the server',
    maxLength: 512,
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;

  @ApiPropertyOptional({ type: Number, default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export class CommentListQueryDto {
  @ApiPropertyOptional({ type: Number, default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ type: Number, default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}

export class OwnDynamicListQueryDto extends CommentListQueryDto {
  @ApiPropertyOptional({ enum: ['pending', 'published', 'hidden'] })
  @IsOptional()
  @IsIn(['pending', 'published', 'hidden'])
  status?: 'pending' | 'published' | 'hidden';
}

export class DynamicWriteDto {
  @ApiPropertyOptional({ enum: ['plain_text', 'markdown_v1'] })
  @ValidateIf((_o, value) => value !== undefined)
  @IsIn(['plain_text', 'markdown_v1'])
  contentFormat?: 'plain_text' | 'markdown_v1';
  @ApiPropertyOptional({
    minimum: 1,
    maximum: 2147483647,
    description: 'Required for Markdown updates.',
  })
  @ValidateIf((_o, value) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  expectedVersion?: number;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @ValidateIf((_o, v) => v !== undefined)
  @IsObject()
  customFields?: Record<string, unknown>;

  @ApiProperty({ minLength: 1, maxLength: 10000 })
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  content!: string;

  @ApiProperty({
    type: [String],
    description: 'Ready image Asset IDs owned by the current user',
  })
  @IsArray()
  @ArrayUnique()
  @MaxLength(19, { each: true })
  @Matches(/^[1-9]\d*$/, { each: true })
  imageAssetIds!: string[];

  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 2147483647 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  resortId?: number;
}

export class UpdateDynamicDto extends PartialType(
  OmitType(DynamicWriteDto, ['resortId'] as const),
  { skipNullProperties: false },
) {
  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    minimum: 1,
    maximum: 2147483647,
    description:
      'Omit to retain the resort; null unlinks it; a positive integer links a published resort',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2147483647)
  resortId?: number | null;
}

export class CreateCommentDto {
  @ApiProperty({ minLength: 1, maxLength: 2000 })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content!: string;
}

export class AdminDynamicListQueryDto {
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

  @ApiPropertyOptional({ enum: ['pending', 'published', 'hidden'] })
  @IsOptional()
  @IsIn(['pending', 'published', 'hidden'])
  status?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  keyword?: string;
}

export class AdminCommentListQueryDto {
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
}

export class DynamicModerationDto {
  @ApiProperty({ enum: ['approve', 'hide', 'restore'] })
  @IsIn(['approve', 'hide', 'restore'])
  action!: 'approve' | 'hide' | 'restore';

  @ApiPropertyOptional({ maxLength: 500 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class CommentModerationDto {
  @ApiProperty({ enum: ['hide', 'restore'] })
  @IsIn(['hide', 'restore'])
  action!: 'hide' | 'restore';

  @ApiPropertyOptional({ maxLength: 500 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(500)
  reason?: string;
}
