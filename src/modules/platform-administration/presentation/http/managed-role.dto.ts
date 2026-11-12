import { Type } from 'class-transformer';
import {
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
import { ROLE_STATUSES } from '../../domain/managed-role.js';

const ROLE_DATA_SCOPES = ['self', 'merchant', 'all'] as const;

export class ManagedRoleListQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  keyword?: string;

  @ApiPropertyOptional({ enum: ROLE_STATUSES })
  @IsOptional()
  @IsEnum(ROLE_STATUSES)
  status?: (typeof ROLE_STATUSES)[number];
}

export class CreateManagedRoleDto {
  @ApiProperty({ maxLength: 50, pattern: '^[a-z][a-z0-9._-]{0,49}$' })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  @Matches(/^[a-z][a-z0-9._-]{0,49}$/)
  roleKey!: string;

  @ApiProperty({ maxLength: 50 })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  roleName!: string;

  @ApiPropertyOptional({ type: String, maxLength: 300, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string | null;

  @ApiProperty({ enum: ROLE_DATA_SCOPES })
  @IsEnum(ROLE_DATA_SCOPES)
  dataScope!: (typeof ROLE_DATA_SCOPES)[number];
}

export class UpdateManagedRoleDto {
  @ApiPropertyOptional({ maxLength: 50, pattern: '^[a-z][a-z0-9._-]{0,49}$' })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  @Matches(/^[a-z][a-z0-9._-]{0,49}$/)
  roleKey?: string;

  @ApiPropertyOptional({ maxLength: 50 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  roleName?: string;

  @ApiPropertyOptional({ type: String, maxLength: 300, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string | null;

  @ApiPropertyOptional({ enum: ROLE_DATA_SCOPES })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsEnum(ROLE_DATA_SCOPES)
  dataScope?: (typeof ROLE_DATA_SCOPES)[number];

  @ApiPropertyOptional({ enum: ROLE_STATUSES })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsEnum(ROLE_STATUSES)
  status?: (typeof ROLE_STATUSES)[number];
}
