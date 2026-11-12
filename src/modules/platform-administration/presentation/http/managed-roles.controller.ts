import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
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
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type {
  AuthorizationPrincipal,
  ResolvedDataScope,
} from '../../../identity-access/domain/authorization.js';
import { RequireManagementResourcePermissions } from '../../../identity-access/presentation/http/authorization.decorators.js';
import { ManageRoles } from '../../application/manage-roles.js';
import type { ManagedRole } from '../../domain/managed-role.js';
import {
  CreateManagedRoleDto,
  ManagedRoleListQueryDto,
  UpdateManagedRoleDto,
} from './managed-role.dto.js';

interface RoleManagementRequest extends Request {
  traceId: string;
  user: AuthorizationPrincipal;
  authorizationDataScopes: Readonly<Record<string, ResolvedDataScope>>;
}

class ManagedRoleVO implements ManagedRole {
  @ApiProperty()
  roleId!: number;

  @ApiProperty()
  roleKey!: string;

  @ApiProperty()
  roleName!: string;

  @ApiPropertyOptional({ type: String, maxLength: 300, nullable: true })
  description!: string | null;

  @ApiProperty({ enum: ['self', 'merchant', 'all'] })
  dataScope!: ManagedRole['dataScope'];

  @ApiProperty({ enum: ['active', 'disabled'] })
  status!: ManagedRole['status'];

  @ApiProperty()
  userCount!: number;

  @ApiProperty()
  permissionCount!: number;

  @ApiProperty()
  fieldPolicyCount!: number;

  @ApiProperty({
    type: 'array',
    items: {
      type: 'object',
      required: ['resourceKey', 'scopeType'],
      properties: {
        resourceKey: { type: 'string' },
        scopeType: { type: 'string' },
      },
    },
  })
  dataScopes!: ManagedRole['dataScopes'];
}

class ManagedRolePageVO {
  @ApiProperty({ type: ManagedRoleVO, isArray: true })
  items!: ManagedRoleVO[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiProperty()
  hasNext!: boolean;
}

@ApiTags('platform-administration')
@Controller('admin/roles')
export class ManagedRolesController {
  constructor(private readonly roles: ManageRoles) {}

  @Get()
  @RequireManagementResourcePermissions('role', 'system:role:list')
  @ApiOperation({ summary: 'List roles visible within the caller role scope' })
  @ApiOkResponse({ type: ManagedRolePageVO })
  @ApiUnauthorizedResponse({ description: 'Authentication is required.' })
  @ApiForbiddenResponse({
    description: 'The role scope or permission is denied.',
  })
  list(
    @Query() query: ManagedRoleListQueryDto,
    @Req() request: RoleManagementRequest,
  ) {
    return this.roles.list({
      page: query.page,
      pageSize: query.pageSize,
      ...(query.keyword !== undefined ? { keyword: query.keyword } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...roleScopeFilter(request),
    });
  }

  @Get(':id')
  @RequireManagementResourcePermissions('role', 'system:role:list')
  @ApiOperation({ summary: 'Read a role visible within the caller role scope' })
  @ApiOkResponse({ type: ManagedRoleVO })
  @ApiNotFoundResponse({ description: 'Role not found.' })
  @ApiForbiddenResponse({
    description: 'The role is outside the caller scope.',
  })
  get(
    @Param('id', ParseIntPipe) roleId: number,
    @Req() request: RoleManagementRequest,
  ) {
    assertRoleScope(request, roleId);
    return this.roles.get(roleId);
  }

  @Post()
  @RequireManagementResourcePermissions('role', 'system:role:create')
  @ApiOperation({ summary: 'Create a role' })
  @ApiCreatedResponse({ type: ManagedRoleVO })
  @ApiBadRequestResponse({ description: 'The role definition is invalid.' })
  @ApiConflictResponse({ description: 'The role key already exists.' })
  @ApiForbiddenResponse({
    description: 'Role creation requires all-role scope.',
  })
  create(
    @Body() role: CreateManagedRoleDto,
    @Req() request: RoleManagementRequest,
  ) {
    if (request.authorizationDataScopes.role?.kind !== 'all') {
      throw new ForbiddenException('Role creation requires all-role scope');
    }
    if (role.dataScope !== 'self') assertScopeAdministrator(request.user);
    return this.roles.create({
      role: {
        roleKey: role.roleKey,
        roleName: role.roleName,
        description: role.description ?? null,
        dataScope: role.dataScope,
      },
      audit: auditContext(request),
    });
  }

  @Patch(':id')
  @RequireManagementResourcePermissions('role', 'system:role:update')
  @ApiOperation({ summary: 'Update role metadata, data scope, or status' })
  @ApiOkResponse({ type: ManagedRoleVO })
  @ApiBadRequestResponse({ description: 'The role patch is invalid.' })
  @ApiConflictResponse({ description: 'The role key already exists.' })
  @ApiForbiddenResponse({
    description: 'The role is protected or outside scope.',
  })
  @ApiNotFoundResponse({ description: 'Role not found.' })
  update(
    @Param('id', ParseIntPipe) roleId: number,
    @Body() patch: UpdateManagedRoleDto,
    @Req() request: RoleManagementRequest,
  ) {
    assertRoleScope(request, roleId);
    if (patch.dataScope !== undefined) assertScopeAdministrator(request.user);
    return this.roles.update({ roleId, patch, audit: auditContext(request) });
  }

  @Delete(':id')
  @RequireManagementResourcePermissions('role', 'system:role:delete')
  @HttpCode(204)
  @ApiOperation({ summary: 'Soft-disable a role' })
  @ApiNoContentResponse({ description: 'Role disabled.' })
  @ApiForbiddenResponse({
    description: 'The role is protected or outside scope.',
  })
  @ApiNotFoundResponse({ description: 'Role not found.' })
  async disable(
    @Param('id', ParseIntPipe) roleId: number,
    @Req() request: RoleManagementRequest,
  ): Promise<void> {
    assertRoleScope(request, roleId);
    await this.roles.disable({ roleId, audit: auditContext(request) });
  }
}

function roleScopeFilter(request: RoleManagementRequest): {
  roleIds?: readonly number[];
} {
  const scope = request.authorizationDataScopes.role;
  if (scope?.kind === 'all') return {};
  if (scope?.kind === 'selected') return { roleIds: scope.ids };
  throw new ForbiddenException(
    'Role management requires all or selected scope',
  );
}

function assertRoleScope(request: RoleManagementRequest, roleId: number): void {
  const scope = request.authorizationDataScopes.role;
  if (scope?.kind === 'all') return;
  if (scope?.kind === 'selected' && scope.ids.includes(roleId)) return;
  throw new ForbiddenException('The role is outside the caller scope');
}

function auditContext(request: RoleManagementRequest) {
  return {
    actorUserId: request.user.userId,
    traceId: request.traceId,
    clientIp: request.ip || null,
    userAgent: request.get('user-agent')?.slice(0, 500) ?? null,
  };
}

function assertScopeAdministrator(principal: AuthorizationPrincipal): void {
  if (
    !principal.roles.some(
      (role) => role.active && role.roleKey === 'system_admin',
    )
  ) {
    throw new ForbiddenException(
      'Only system_admin may configure the default role data scope',
    );
  }
}
