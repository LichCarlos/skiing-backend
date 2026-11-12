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

export class CreatePermissionCatalogDto {
  @ApiProperty({
    maxLength: 100,
    pattern: '^custom:[a-z0-9][a-z0-9._:-]{0,92}$',
  })
  @IsString()
  @MaxLength(100)
  @Matches(/^custom:[a-z0-9][a-z0-9._:-]{0,92}$/)
  permissionKey!: string;

  @ApiPropertyOptional({ type: Number, minimum: 1, nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  parentId?: number | null;

  @ApiProperty({ minLength: 1, maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  permissionName!: string;

  @ApiProperty({ enum: ['directory', 'menu', 'button'] })
  @IsEnum(['directory', 'menu', 'button'])
  permissionType!: 'directory' | 'menu' | 'button';

  @ApiPropertyOptional({ type: String, maxLength: 200, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  route?: string | null;

  @ApiPropertyOptional({ type: String, maxLength: 100, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  icon?: string | null;

  @ApiPropertyOptional({
    type: Number,
    minimum: -100000,
    maximum: 100000,
    default: 0,
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(-100000)
  @Max(100000)
  sortOrder = 0;

  @ApiPropertyOptional({ type: Boolean, default: true })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean()
  visible = true;
}

export class UpdatePermissionCatalogDto {
  @ApiPropertyOptional({ type: Number, minimum: 1, nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  parentId?: number | null;

  @ApiPropertyOptional({ minLength: 1, maxLength: 100 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  permissionName?: string;

  @ApiPropertyOptional({ type: String, maxLength: 200, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  route?: string | null;

  @ApiPropertyOptional({ type: String, maxLength: 100, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  icon?: string | null;

  @ApiPropertyOptional({ minimum: -100000, maximum: 100000 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(-100000)
  @Max(100000)
  sortOrder?: number;

  @ApiPropertyOptional()
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean()
  visible?: boolean;

  @ApiPropertyOptional({ enum: ['active', 'disabled'] })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsEnum(['active', 'disabled'])
  status?: 'active' | 'disabled';
}
