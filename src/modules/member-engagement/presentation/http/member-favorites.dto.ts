import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const FAVORITE_TARGET_TYPES = ['resort', 'article', 'dynamic'] as const;

export class FavoriteTargetDto {
  @ApiProperty({ enum: FAVORITE_TARGET_TYPES })
  @IsIn(FAVORITE_TARGET_TYPES)
  targetType!: (typeof FAVORITE_TARGET_TYPES)[number];

  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  targetId!: number;
}

export class FavoriteListQueryDto {
  @ApiPropertyOptional({ enum: FAVORITE_TARGET_TYPES })
  @IsOptional()
  @IsIn(FAVORITE_TARGET_TYPES)
  targetType?: (typeof FAVORITE_TARGET_TYPES)[number];

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}
