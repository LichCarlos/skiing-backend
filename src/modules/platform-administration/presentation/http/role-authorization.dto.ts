import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

const RESOURCE_SCOPE_TYPES = ['self', 'merchant', 'selected', 'all'] as const;

export class RoleAuthorizationDataScopeDto {
  @ApiProperty({ maxLength: 100, pattern: '^[a-z][a-z0-9._:-]{0,99}$' })
  @IsString()
  @MaxLength(100)
  @Matches(/^[a-z][a-z0-9._:-]{0,99}$/)
  resourceKey!: string;

  @ApiProperty({ enum: RESOURCE_SCOPE_TYPES })
  @IsEnum(RESOURCE_SCOPE_TYPES)
  scopeType!: (typeof RESOURCE_SCOPE_TYPES)[number];

  @ApiProperty({
    type: Number,
    isArray: true,
    required: false,
    description: 'Required and non-empty only for selected scopeType.',
  })
  @ValidateIf(
    (input: RoleAuthorizationDataScopeDto) => input.scopeType === 'selected',
  )
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  selectedIds?: number[];
}

export class RoleAuthorizationFieldPolicyDto {
  @ApiProperty({
    enum: ['ski_resort', 'article', 'dynamic', 'merchant_profile'],
  })
  @IsString()
  @MaxLength(50)
  @Matches(/^(ski_resort|article|dynamic|merchant_profile)$/)
  entityType!: string;

  @ApiProperty({ maxLength: 100, pattern: '^[a-z][a-z0-9_]{0,99}$' })
  @IsString()
  @MaxLength(100)
  @Matches(/^[a-z][a-z0-9_]{0,99}$/)
  fieldKey!: string;

  @ApiProperty()
  @IsBoolean()
  canRead!: boolean;

  @ApiProperty()
  @IsBoolean()
  canWrite!: boolean;
}

export class ReplaceRoleAuthorizationDto {
  @ApiProperty({ type: Number, isArray: true, uniqueItems: true })
  @IsArray()
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  permissionIds!: number[];

  @ApiProperty({ type: RoleAuthorizationDataScopeDto, isArray: true })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoleAuthorizationDataScopeDto)
  dataScopes!: RoleAuthorizationDataScopeDto[];

  @ApiProperty({ type: RoleAuthorizationFieldPolicyDto, isArray: true })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoleAuthorizationFieldPolicyDto)
  fieldPolicies!: RoleAuthorizationFieldPolicyDto[];
}
