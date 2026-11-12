import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
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
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DICTIONARY_STATUSES } from '../../domain/managed-dictionary.js';

export class DictionaryTypeListQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @ValidateIf((_object, value) => value !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @ValidateIf((_object, value) => value !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @ApiPropertyOptional({ maxLength: 100, pattern: '^[a-z][a-z0-9._:-]{0,99}$' })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(100)
  @Matches(/^[a-z][a-z0-9._:-]{0,99}$/)
  groupKey?: string;

  @ApiPropertyOptional({ enum: DICTIONARY_STATUSES })
  @ValidateIf((_object, value) => value !== undefined)
  @IsEnum(DICTIONARY_STATUSES)
  status?: (typeof DICTIONARY_STATUSES)[number];
}

export class CreateDictionaryTypeDto {
  @ApiProperty({ maxLength: 100, pattern: '^[a-z][a-z0-9._:-]{0,99}$' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(/^[a-z][a-z0-9._:-]{0,99}$/)
  dictType!: string;

  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  dictName!: string;

  @ApiProperty({ maxLength: 100, pattern: '^[a-z][a-z0-9._:-]{0,99}$' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(/^[a-z][a-z0-9._:-]{0,99}$/)
  groupKey!: string;

  @ApiPropertyOptional({ default: false })
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  publiclyReadable?: boolean;
}

export class UpdateDictionaryTypeDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  dictName?: string;

  @ApiPropertyOptional({ maxLength: 100, pattern: '^[a-z][a-z0-9._:-]{0,99}$' })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(/^[a-z][a-z0-9._:-]{0,99}$/)
  groupKey?: string;

  @ApiPropertyOptional({ enum: DICTIONARY_STATUSES })
  @ValidateIf((_object, value) => value !== undefined)
  @IsEnum(DICTIONARY_STATUSES)
  status?: (typeof DICTIONARY_STATUSES)[number];

  @ApiPropertyOptional()
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  publiclyReadable?: boolean;
}

export class CreateDictionaryItemDto {
  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  label!: string;

  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  value!: string;

  @ApiPropertyOptional({ type: Number, minimum: 1, nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  parentId?: number | null;

  @ApiPropertyOptional({ type: String, maxLength: 20, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  color?: string | null;

  @ApiPropertyOptional({ type: Number, default: 0 })
  @ValidateIf((_object, value) => value !== undefined)
  @Type(() => Number)
  @IsInt()
  sortOrder!: number;

  @ApiPropertyOptional({ type: Boolean, default: false })
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  isDefault!: boolean;
}

export class UpdateDictionaryItemDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  label?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  value?: string;

  @ApiPropertyOptional({ type: Number, minimum: 1, nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  parentId?: number | null;

  @ApiPropertyOptional({ type: String, maxLength: 20, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  color?: string | null;

  @ApiPropertyOptional()
  @ValidateIf((_object, value) => value !== undefined)
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;

  @ApiPropertyOptional()
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ enum: DICTIONARY_STATUSES })
  @ValidateIf((_object, value) => value !== undefined)
  @IsEnum(DICTIONARY_STATUSES)
  status?: (typeof DICTIONARY_STATUSES)[number];
}
