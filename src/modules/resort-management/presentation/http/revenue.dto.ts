import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class RevenueListQueryDto {
  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 2_147_483_647 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  resortId?: number;

  @ApiPropertyOptional({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })
  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN)
  fromDate?: string;

  @ApiPropertyOptional({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })
  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN)
  toDate?: string;

  @ApiPropertyOptional({
    type: Number,
    minimum: 1,
    maximum: 2_147_483_647,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  page = 1;

  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}

export class UpsertRevenueDto {
  @ApiProperty({ type: Number, minimum: 1, maximum: 2_147_483_647 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  resortId!: number;

  @ApiProperty({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })
  @IsString()
  @Matches(DATE_PATTERN)
  reportDate!: string;

  @ApiProperty({ pattern: '^\\d{1,10}(\\.\\d{1,2})?$' })
  @IsString()
  @Matches(/^\d{1,10}(\.\d{1,2})?$/)
  revenueAmount!: string;

  @ApiPropertyOptional({ type: String, maxLength: 300, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string | null;
}
