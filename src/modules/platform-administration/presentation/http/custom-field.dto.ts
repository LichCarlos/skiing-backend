import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CUSTOM_FIELD_DATA_TYPES,
  type CustomFieldEntityType,
} from '../../domain/custom-field-definition.js';

export class CustomFieldListQueryDto {
  @ApiPropertyOptional({ type: Number, minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @ApiPropertyOptional({
    enum: ['ski_resort', 'article', 'dynamic', 'merchant_profile'],
  })
  @IsOptional()
  @IsString()
  entityType?: CustomFieldEntityType;

  @ApiPropertyOptional({ enum: ['draft', 'active', 'disabled'] })
  @IsOptional()
  @IsString()
  status?: 'draft' | 'active' | 'disabled';
}

export class CreateCustomFieldDto {
  @ApiProperty({
    enum: ['ski_resort', 'article', 'dynamic', 'merchant_profile'],
  })
  @IsString()
  entityType!: CustomFieldEntityType;

  @ApiProperty({ maxLength: 100, pattern: '^[a-z][a-z0-9_]{0,99}$' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  fieldKey!: string;

  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  label!: string;

  @ApiProperty({ enum: CUSTOM_FIELD_DATA_TYPES })
  @IsString()
  dataType!: (typeof CUSTOM_FIELD_DATA_TYPES)[number];

  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  groupKey!: string;

  @ApiPropertyOptional({ type: Number, minimum: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder = 0;

  @ApiPropertyOptional({ type: Boolean, default: false })
  @IsOptional()
  @IsBoolean()
  required = false;

  @ApiPropertyOptional({
    description: 'Optional JSON default value.',
    oneOf: [
      { type: 'string' },
      { type: 'number' },
      { type: 'boolean' },
      { type: 'object', additionalProperties: true },
      { type: 'array', items: {} },
      { type: 'null' },
    ],
  })
  @IsOptional()
  defaultValue?: unknown;

  @ApiPropertyOptional({ type: String, maxLength: 100, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  optionsDictType?: string | null;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
  })
  @IsOptional()
  @IsObject()
  validation?: Record<string, unknown> | null;

  @ApiPropertyOptional({ type: Boolean, default: false })
  @IsOptional()
  @IsBoolean()
  searchable = false;

  @ApiPropertyOptional({ type: Boolean, default: false })
  @IsOptional()
  @IsBoolean()
  filterable = false;

  @ApiPropertyOptional({ type: Boolean, default: false })
  @IsOptional()
  @IsBoolean()
  sortable = false;

  @ApiPropertyOptional({ type: Boolean, default: false })
  @IsOptional()
  @IsBoolean()
  isPublic = false;
}

export class UpdateCustomFieldDto {
  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedSchemaVersion!: number;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  label?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  groupKey?: string;

  @ApiPropertyOptional({ type: Number, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @ApiPropertyOptional({
    description: 'Optional JSON default value.',
    oneOf: [
      { type: 'string' },
      { type: 'number' },
      { type: 'boolean' },
      { type: 'object', additionalProperties: true },
      { type: 'array', items: {} },
      { type: 'null' },
    ],
  })
  @IsOptional()
  defaultValue?: unknown;

  @ApiPropertyOptional({ type: String, maxLength: 100, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  optionsDictType?: string | null;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
  })
  @IsOptional()
  @IsObject()
  validation?: Record<string, unknown> | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  searchable?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  filterable?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  sortable?: boolean;

  @ApiPropertyOptional({
    description: 'Expose this active field in public VOs.',
  })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}

export class CustomFieldSchemaVersionDto {
  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedSchemaVersion!: number;
}

export class CustomFieldGroupListQueryDto {
  @ApiPropertyOptional({
    enum: ['ski_resort', 'article', 'dynamic', 'merchant_profile'],
  })
  @IsOptional()
  @IsString()
  entityType?: CustomFieldEntityType;
}

export class CreateCustomFieldGroupDto {
  @ApiProperty({
    enum: ['ski_resort', 'article', 'dynamic', 'merchant_profile'],
  })
  @IsString()
  entityType!: CustomFieldEntityType;

  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  groupKey!: string;

  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  label!: string;

  @ApiPropertyOptional({ type: Number, minimum: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder = 0;
}

export class UpdateCustomFieldGroupDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  label?: string;

  @ApiPropertyOptional({ type: Number, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
