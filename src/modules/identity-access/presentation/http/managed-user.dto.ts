import { Transform, Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  Validate,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  normalizeAccount,
  normalizeNickname,
} from '../../domain/registration-rules.js';
import { MANAGED_USER_STATUSES } from '../../domain/managed-user.js';
import { PasswordByteLengthConstraint } from './auth.dto.js';

export class ManagedUserListQueryDto {
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

  @ApiPropertyOptional({ enum: MANAGED_USER_STATUSES })
  @IsOptional()
  @IsEnum(MANAGED_USER_STATUSES)
  status?: (typeof MANAGED_USER_STATUSES)[number];
}

export class CreateManagedUserDto {
  @ApiProperty({ maxLength: 50 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizeAccount(value) : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  account!: string;

  @ApiProperty({ maxLength: 50 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizeNickname(value) : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  nickname!: string;

  @ApiProperty({ minLength: 8, maxLength: 72 })
  @IsString()
  @Validate(PasswordByteLengthConstraint)
  password!: string;

  @ApiPropertyOptional({ type: Number, isArray: true, default: [] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  roleIds: number[] = [];
}

export class ReplaceManagedUserRolesDto {
  @ApiProperty({ type: Number, isArray: true, uniqueItems: true })
  @IsArray()
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  roleIds!: number[];
}

export class SetManagedUserStatusDto {
  @ApiProperty({ enum: MANAGED_USER_STATUSES })
  @IsEnum(MANAGED_USER_STATUSES)
  status!: (typeof MANAGED_USER_STATUSES)[number];
}
