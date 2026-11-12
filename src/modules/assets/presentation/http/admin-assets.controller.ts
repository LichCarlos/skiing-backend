import {
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiNoContentResponse,
  ApiOkResponse,
  ApiProperty,
  ApiPropertyOptional,
  ApiOperation,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import type { Request } from 'express';
import { RequireManagementResourcePermissions } from '../../../identity-access/presentation/http/authorization.decorators.js';
import { ManageAdminAssets } from '../../application/manage-admin-assets.js';
import type { ResolvedDataScope } from '../../../identity-access/domain/authorization.js';
import { resolveAdminAssetAccess } from '../../domain/admin-asset-access.js';

class AdminAssetListQueryDto {
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

  @ApiPropertyOptional({
    enum: ['pending_scan', 'ready', 'rejected', 'deleted'],
  })
  @IsOptional()
  @IsIn(['pending_scan', 'ready', 'rejected', 'deleted'])
  status?: string;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  ownerUserId?: number;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  keyword?: string;
}

class AdminAssetReferenceCountsVO {
  @ApiProperty() coverResorts!: number;
  @ApiProperty() resortImages!: number;
  @ApiProperty() articleCovers!: number;
  @ApiProperty() dynamicImages!: number;
  @ApiProperty() userAvatars!: number;
}

class AdminAssetVO {
  @ApiProperty({ example: '42' }) assetId!: string;
  @ApiProperty() ownerUserId!: number;
  @ApiProperty() ownerAccount!: string;
  @ApiProperty() originalName!: string;
  @ApiProperty() mimeType!: string;
  @ApiProperty({ example: '2048' }) sizeBytes!: string;
  @ApiProperty({ enum: ['pending_scan', 'ready', 'rejected', 'deleted'] })
  status!: string;
  @ApiProperty({ type: String, nullable: true }) url!: string | null;
  @ApiProperty({ type: AdminAssetReferenceCountsVO })
  references!: AdminAssetReferenceCountsVO;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

interface AdminAssetRequest extends Request {
  authenticatedUserId?: number;
  traceId: string;
  authorizationDataScopes?: Readonly<Record<string, ResolvedDataScope>>;
}

@ApiTags('admin-assets')
@Controller('admin/assets')
export class AdminAssetsController {
  constructor(private readonly assets: ManageAdminAssets) {}

  @Get()
  @RequireManagementResourcePermissions('asset', 'content:asset:list')
  @ApiOperation({
    summary: 'List assets with reference information',
    description:
      'Requires asset action permission and scope: all, self (OwnerUserId), or selected (AssetId). Filters and total intersect the scope. Missing, conflicting, or merchant scopes are forbidden.',
  })
  @ApiOkResponse({
    description: 'Offset-paginated inventory and reference counts.',
    schema: {
      type: 'object',
      properties: {
        items: { type: 'array', items: { $ref: getSchemaPath(AdminAssetVO) } },
        total: { type: 'integer' },
        page: { type: 'integer' },
        pageSize: { type: 'integer' },
        hasNext: { type: 'boolean' },
      },
      required: ['items', 'total', 'page', 'pageSize', 'hasNext'],
    },
  })
  list(
    @Query() query: AdminAssetListQueryDto,
    @Req() request: AdminAssetRequest,
  ) {
    return this.assets.list(
      query,
      requireAssetAccess(request),
      requireActor(request),
    );
  }

  @Get(':assetId')
  @RequireManagementResourcePermissions('asset', 'content:asset:list')
  @ApiOperation({
    summary: 'Read an asset with reference information',
    description:
      'Applies the same asset scope as the list. An asset outside the scope returns 404 without a read URL.',
  })
  @ApiOkResponse({
    description: 'Asset details, owner, short-lived URL, and reference counts.',
    type: AdminAssetVO,
  })
  get(@Param('assetId') assetId: string, @Req() request: AdminAssetRequest) {
    return this.assets.get(
      assetId,
      requireAssetAccess(request),
      requireActor(request),
    );
  }

  @Delete(':assetId')
  @RequireManagementResourcePermissions('asset', 'content:asset:delete')
  @HttpCode(204)
  @ApiNoContentResponse()
  @ApiOperation({
    summary: 'Soft-delete an unreferenced asset',
    description:
      'Applies asset scope to both preflight and transactional update; outside-scope assets return 404. Reference protection and successful audit are committed with soft deletion before object removal.',
  })
  async remove(
    @Param('assetId') assetId: string,
    @Req() request: AdminAssetRequest,
  ): Promise<void> {
    const access = requireAssetAccess(request);
    if (!request.authenticatedUserId) {
      throw new UnauthorizedException('Authenticated user is required');
    }
    await this.assets.remove(
      assetId,
      {
        actorUserId: request.authenticatedUserId,
        traceId: request.traceId,
        clientIp: request.ip || null,
        userAgent: request.get('user-agent')?.slice(0, 500) ?? null,
      },
      access,
    );
  }
}

function requireAssetAccess(request: AdminAssetRequest) {
  const access = resolveAdminAssetAccess(
    request.authorizationDataScopes?.asset,
    request.authenticatedUserId,
  );
  if (!access)
    throw new ForbiddenException('Supported asset scope is required');
  return access;
}

function requireActor(request: AdminAssetRequest): number {
  if (!request.authenticatedUserId)
    throw new UnauthorizedException('Authenticated user is required');
  return request.authenticatedUserId;
}
