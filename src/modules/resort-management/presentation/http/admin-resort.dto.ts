import { Transform } from 'class-transformer';
import { ValidateIf, MinLength } from 'class-validator';
import { PartialType } from '@nestjs/swagger';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsNumber,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CreateMerchantResortDto } from './merchant-resort.dto.js';

export class CreateAdminResortDto extends CreateMerchantResortDto {
  @ApiPropertyOptional({ type: 'integer', minimum: 1, nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  merchantId?: number | null;

  @ApiPropertyOptional({ type: Number, minimum: 0, maximum: 5, nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(5)
  rating?: number | null;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  ratingCount?: number;
}

export class UpdateAdminResortDto extends PartialType(CreateAdminResortDto) {}

export class AdminResortListQueryDto {
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
  pageSize?: number;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  keyword?: string;

  @ApiPropertyOptional({
    enum: ['draft', 'pending_review', 'published', 'offline'],
  })
  @IsOptional()
  @IsIn(['draft', 'pending_review', 'published', 'offline'])
  status?: string;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  merchantId?: number;
}

export class ResortTransitionDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 500 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @ValidateIf((_o, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason?: string;
}
