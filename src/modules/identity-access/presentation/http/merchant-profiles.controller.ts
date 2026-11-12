import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiExtraModels,
  getSchemaPath,
  ApiOkResponse,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsObject,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import type { Request } from 'express';
import { ManageMerchantProfiles } from '../../application/manage-merchant-profiles.js';
import { RequireManagementResourcePermissions } from './authorization.decorators.js';
import type {
  MerchantProfileCommand,
  MerchantProfilePatch,
} from '../../application/ports/merchant-profile-repository.js';
import { resortCustomFieldSchemaResponse } from '../../../resort-management/presentation/http/resort-field-schema.openapi.js';

export class MerchantReasonDto {
  @ApiProperty({ minLength: 1, maxLength: 500 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}
export class CreateMerchantProfileDto extends MerchantReasonDto {
  @ApiProperty({ minLength: 1, maxLength: 100 })
  @IsString()
  @MaxLength(100)
  businessName!: string;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 100 })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsString()
  @MaxLength(100)
  contact?: string | null;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @ValidateIf((_o, v) => v !== undefined)
  @IsObject()
  customFields?: Record<string, unknown>;
}
export class UpdateMerchantProfileDto extends MerchantReasonDto {
  @ApiProperty({ minimum: 1, maximum: 2147483646 })
  @IsInt()
  @Min(1)
  @Max(2147483646)
  expectedVersion!: number;
  @ApiPropertyOptional({ minLength: 1, maxLength: 100 })
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @MaxLength(100)
  businessName?: string;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 100 })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsString()
  @MaxLength(100)
  contact?: string | null;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @ValidateIf((_o, v) => v !== undefined)
  @IsObject()
  customFields?: Record<string, unknown>;
}
export class ChangeMerchantProfileStatusDto extends MerchantReasonDto {
  @ApiProperty({ minimum: 1, maximum: 2147483646 })
  @IsInt()
  @Min(1)
  @Max(2147483646)
  expectedVersion!: number;
  @ApiProperty({ enum: ['active', 'disabled'] })
  @IsIn(['active', 'disabled'])
  status!: 'active' | 'disabled';
}
export class AdminMerchantProfileVO {
  @ApiProperty() merchantId!: number;
  @ApiProperty() userId!: number;
  @ApiProperty() businessName!: string;
  @ApiProperty({ type: String, nullable: true }) contact!: string | null;
  @ApiProperty({ enum: ['active', 'disabled'] }) status!: string;
  @ApiProperty({ type: 'object', additionalProperties: true })
  customFields!: Record<string, unknown>;
  @ApiProperty() schemaVersion!: number;
  @ApiProperty() version!: number;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: Date;
}
interface ProfileRequest extends Request {
  authenticatedUserId: number;
  traceId: string;
}
@ApiExtraModels(AdminMerchantProfileVO)
@ApiTags('identity-access')
@Controller('admin')
export class MerchantProfilesController {
  constructor(private readonly profiles: ManageMerchantProfiles) {}
  @Get('merchant-profiles/custom-fields')
  @Header('Cache-Control', 'no-store')
  @RequireManagementResourcePermissions('user', 'system:merchant-profile:read')
  @ApiOkResponse(resortCustomFieldSchemaResponse)
  schema(@Req() request: ProfileRequest) {
    return this.profiles.schema(request.authenticatedUserId);
  }
  @Get('users/:id/merchant-profile')
  @Header('Cache-Control', 'no-store')
  @RequireManagementResourcePermissions('user', 'system:merchant-profile:read')
  @ApiOkResponse({
    schema: {
      allOf: [{ $ref: getSchemaPath(AdminMerchantProfileVO) }],
      nullable: true,
    },
    description: 'Profile or null when this existing account has no profile.',
  })
  read(@Param('id', ParseIntPipe) id: number, @Req() request: ProfileRequest) {
    return this.profiles.read(id, request.authenticatedUserId);
  }
  @Post('users/:id/merchant-profile')
  @RequireManagementResourcePermissions(
    'user',
    'system:merchant-profile:create',
  )
  @ApiCreatedResponse({ type: AdminMerchantProfileVO })
  create(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: CreateMerchantProfileDto,
    @Req() request: ProfileRequest,
  ) {
    return this.write(id, 'create', body, request);
  }
  @Patch('users/:id/merchant-profile')
  @RequireManagementResourcePermissions(
    'user',
    'system:merchant-profile:update',
  )
  @ApiOkResponse({ type: AdminMerchantProfileVO })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateMerchantProfileDto,
    @Req() request: ProfileRequest,
  ) {
    return this.write(id, 'update', body, request);
  }
  @Patch('users/:id/merchant-profile/status')
  @RequireManagementResourcePermissions(
    'user',
    'system:merchant-profile:update-status',
  )
  @ApiOkResponse({ type: AdminMerchantProfileVO })
  status(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: ChangeMerchantProfileStatusDto,
    @Req() request: ProfileRequest,
  ) {
    return this.write(id, 'status', body, request);
  }
  private write(
    id: number,
    kind: MerchantProfileCommand['kind'],
    body: MerchantProfilePatch & {
      reason: string;
      expectedVersion?: number;
      status?: 'active' | 'disabled';
    },
    request: ProfileRequest,
  ) {
    const patch: MerchantProfilePatch = {};
    for (const key of ['businessName', 'contact', 'customFields'] as const)
      if (Object.hasOwn(body, key)) Object.assign(patch, { [key]: body[key] });
    return this.profiles.write({
      userId: id,
      kind,
      patch,
      expectedVersion: body.expectedVersion,
      status: body.status,
      reason: body.reason,
      audit: {
        actorUserId: request.authenticatedUserId,
        traceId: request.traceId,
        clientIp: request.ip ?? null,
        userAgent: request.get('user-agent')?.slice(0, 500) ?? null,
      },
    });
  }
}
