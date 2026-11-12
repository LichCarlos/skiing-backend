import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  NotFoundException,
  Param,
  Patch,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { Request } from 'express';
import type { AuthorizationPrincipal } from '../../../identity-access/domain/authorization.js';
import {
  Public,
  RequireManagementPermissions,
} from '../../../identity-access/presentation/http/authorization.decorators.js';
import { ManageSystemConfig } from '../../application/manage-system-config.js';
import { SystemConfigError } from '../../domain/system-config.js';

export class SystemConfigListQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(100)
  keyword?: string;
}
export class UpdateSystemConfigDto {
  @ApiProperty({
    maxLength: 30000,
    description:
      'Plain text. Trimmed and validated against the selected key; per-key maxLength from the catalog.',
  })
  @IsString()
  @MaxLength(30000)
  value!: string;
  @ApiProperty({ minimum: 0, maximum: 2147483647 })
  @IsInt()
  @Min(0)
  @Max(2147483647)
  expectedVersion!: number;
}
export class SystemConfigVO {
  @ApiProperty() configKey!: string;
  @ApiProperty() label!: string;
  @ApiProperty({ enum: ['text'] }) valueType!: 'text';
  @ApiProperty({ type: String, nullable: true }) value!: string | null;
  @ApiProperty({ type: String, nullable: true }) defaultValue!: string | null;
  @ApiProperty() maxLength!: number;
  @ApiProperty({ minimum: 0 }) version!: number;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  updatedAt!: string | null;
  @ApiProperty({ type: Number, nullable: true }) updatedByUserId!:
    number | null;
}
export class SystemConfigPageVO {
  @ApiProperty({ type: [SystemConfigVO] }) items!: SystemConfigVO[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
  @ApiProperty() hasNext!: boolean;
}
export class PublicSiteConfigVO {
  @ApiProperty() siteName!: string;
  @ApiProperty() tagline!: string;
  @ApiProperty({ type: String, nullable: true }) about!: string | null;
  @ApiProperty({ type: String, nullable: true }) contactEmail!: string | null;
  @ApiProperty({ type: String, nullable: true }) privacyPolicy!: string | null;
  @ApiProperty({ type: String, nullable: true }) termsOfService!: string | null;
  @ApiProperty({ description: 'SHA-256 of ordered public key/version pairs' })
  revision!: string;
}
interface ConfigRequest extends Request {
  user: AuthorizationPrincipal;
  traceId: string;
}

@ApiTags('platform-administration')
@Controller('admin/config')
export class SystemConfigController {
  constructor(private readonly config: ManageSystemConfig) {}
  @Get()
  @RequireManagementPermissions('system:config:list')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'List the system administrator text configuration catalog',
  })
  @ApiOkResponse({ type: SystemConfigPageVO })
  async list(
    @Query() query: SystemConfigListQueryDto,
    @Req() request: ConfigRequest,
  ) {
    try {
      return await this.config.list(request.user.userId, query);
    } catch (error) {
      throw mapError(error);
    }
  }
  @Patch(':configKey')
  @RequireManagementPermissions('system:config:update')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Update a whitelisted text value with optimistic version and atomic audit',
  })
  @ApiOkResponse({ type: SystemConfigVO })
  @ApiConflictResponse()
  @ApiNotFoundResponse()
  async update(
    @Param('configKey') key: string,
    @Body() body: UpdateSystemConfigDto,
    @Req() request: ConfigRequest,
  ) {
    try {
      return await this.config.update(key, body.value, body.expectedVersion, {
        actorUserId: request.user.userId,
        traceId: request.traceId,
        clientIp: request.ip?.slice(0, 64) ?? null,
        userAgent: request.get('user-agent')?.slice(0, 500) ?? null,
      });
    } catch (error) {
      throw mapError(error);
    }
  }
}
@ApiTags('public-config')
@Controller('public/config')
export class PublicSiteConfigController {
  constructor(private readonly config: ManageSystemConfig) {}
  @Get()
  @Public()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Read fixed public brand, contact and policy text values',
  })
  @ApiOkResponse({ type: PublicSiteConfigVO })
  get() {
    return this.config.publicConfig();
  }
}
function mapError(error: unknown) {
  if (!(error instanceof SystemConfigError)) return error;
  if (error.kind === 'invalid') return new BadRequestException(error.message);
  if (error.kind === 'not-found') return new NotFoundException(error.message);
  if (error.kind === 'conflict') return new ConflictException(error.message);
  return new ForbiddenException(error.message);
}
