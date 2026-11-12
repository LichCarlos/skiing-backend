import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import type { AuthorizationPrincipal } from '../../domain/authorization.js';
import type { PermissionCatalogRecord } from '../../domain/permission-catalog.js';
import { ManagePermissionCatalog } from '../../application/manage-permission-catalog.js';
import { RequireManagementPermissions } from './authorization.decorators.js';
import {
  CreatePermissionCatalogDto,
  UpdatePermissionCatalogDto,
} from './permission-catalog.dto.js';

interface PermissionRequest extends Request {
  traceId: string;
  user: AuthorizationPrincipal;
}

class PermissionCatalogVO implements PermissionCatalogRecord {
  @ApiProperty()
  permissionId!: number;
  @ApiProperty({ type: Number, nullable: true })
  parentId!: number | null;
  @ApiProperty()
  permissionKey!: string;
  @ApiProperty()
  permissionName!: string;
  @ApiProperty({ enum: ['directory', 'menu', 'button', 'api'] })
  permissionType!: PermissionCatalogRecord['permissionType'];
  @ApiProperty({ enum: ['code', 'custom'] })
  source!: PermissionCatalogRecord['source'];
  @ApiProperty({ type: String, nullable: true })
  route!: string | null;
  @ApiProperty({ type: String, nullable: true })
  icon!: string | null;
  @ApiProperty()
  sortOrder!: number;
  @ApiProperty()
  visible!: boolean;
  @ApiProperty({ enum: ['active', 'disabled'] })
  status!: PermissionCatalogRecord['status'];
  @ApiProperty({ type: () => PermissionCatalogVO, isArray: true })
  children!: PermissionCatalogVO[];
}

@ApiTags('identity-access')
@Controller('admin/permissions')
export class PermissionCatalogController {
  constructor(private readonly catalog: ManagePermissionCatalog) {}

  @Get()
  @RequireManagementPermissions('system:permission:list')
  @ApiOperation({ summary: 'List the complete permission catalog tree' })
  @ApiOkResponse({ type: PermissionCatalogVO, isArray: true })
  list() {
    return this.catalog.list();
  }

  @Get(':permissionId')
  @RequireManagementPermissions('system:permission:list')
  @ApiOperation({ summary: 'Get a permission catalog node and its subtree' })
  @ApiOkResponse({ type: PermissionCatalogVO })
  @ApiNotFoundResponse({ description: 'Permission not found' })
  detail(@Param('permissionId', ParseIntPipe) permissionId: number) {
    return this.catalog.detail(permissionId);
  }

  @Post()
  @RequireManagementPermissions('system:permission:create')
  @ApiOperation({ summary: 'Create a custom menu catalog node' })
  @ApiCreatedResponse({ type: PermissionCatalogVO })
  create(
    @Body() body: CreatePermissionCatalogDto,
    @Req() request: PermissionRequest,
  ) {
    return this.catalog.create({ body, audit: auditContext(request) });
  }

  @Patch(':permissionId')
  @RequireManagementPermissions('system:permission:update')
  @ApiOperation({ summary: 'Update a permission catalog node' })
  @ApiOkResponse({ type: PermissionCatalogVO })
  update(
    @Param('permissionId', ParseIntPipe) permissionId: number,
    @Body() body: UpdatePermissionCatalogDto,
    @Req() request: PermissionRequest,
  ) {
    return this.catalog.update({
      permissionId,
      body,
      audit: auditContext(request),
    });
  }

  @Delete(':permissionId')
  @RequireManagementPermissions('system:permission:delete')
  @HttpCode(204)
  @ApiOperation({ summary: 'Soft-disable an unused custom menu/button node' })
  @ApiNoContentResponse()
  disable(
    @Param('permissionId', ParseIntPipe) permissionId: number,
    @Req() request: PermissionRequest,
  ) {
    return this.catalog.disable({ permissionId, audit: auditContext(request) });
  }

  @Post('sync')
  @HttpCode(200)
  @RequireManagementPermissions('system:permission:update')
  @ApiOperation({ summary: 'Synchronize registered API permissions' })
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['created', 'updated', 'disabled'],
      properties: {
        created: { type: 'integer' },
        updated: { type: 'integer' },
        disabled: { type: 'integer' },
      },
    },
  })
  sync(@Req() request: PermissionRequest) {
    if (!isSystemAdmin(request.user))
      throw new ForbiddenException('Only system_admin may sync permissions');
    return this.catalog.sync({ audit: auditContext(request) });
  }
}

function isSystemAdmin(principal: AuthorizationPrincipal) {
  return principal.roles.some(
    (role) => role.active && role.roleKey === 'system_admin',
  );
}

function auditContext(request: PermissionRequest) {
  return {
    actorUserId: request.user.userId,
    traceId: request.traceId,
    clientIp: request.ip?.slice(0, 64) || null,
    userAgent: request.get('user-agent')?.slice(0, 500) || null,
  };
}
