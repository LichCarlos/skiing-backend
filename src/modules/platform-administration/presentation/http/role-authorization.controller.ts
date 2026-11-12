import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseIntPipe,
  Put,
  Req,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import type {
  AuthorizationPrincipal,
  ResolvedDataScope,
} from '../../../identity-access/domain/authorization.js';
import { RequireManagementResourcePermissions } from '../../../identity-access/presentation/http/authorization.decorators.js';
import { ManageRoleAuthorization } from '../../application/manage-role-authorization.js';
import type {
  RoleAuthorizationDataScope,
  RoleAuthorizationFieldPolicy,
} from '../../domain/role-authorization.js';
import { ReplaceRoleAuthorizationDto } from './role-authorization.dto.js';

interface AuthorizationRequest extends Request {
  traceId: string;
  user: AuthorizationPrincipal;
  authorizationDataScopes: Readonly<Record<string, ResolvedDataScope>>;
}

class RoleAuthorizationDataScopeVO implements RoleAuthorizationDataScope {
  @ApiProperty()
  resourceKey!: string;

  @ApiProperty({ enum: ['self', 'merchant', 'selected', 'all'] })
  scopeType!: RoleAuthorizationDataScope['scopeType'];

  @ApiProperty({ type: Number, isArray: true, required: false })
  selectedIds?: readonly number[];
}

class RoleAuthorizationFieldPolicyVO implements RoleAuthorizationFieldPolicy {
  @ApiProperty()
  entityType!: string;

  @ApiProperty()
  fieldKey!: string;

  @ApiProperty()
  canRead!: boolean;

  @ApiProperty()
  canWrite!: boolean;
}

class RoleAuthorizationSnapshotVO {
  @ApiProperty()
  roleId!: number;

  @ApiProperty()
  roleKey!: string;

  @ApiProperty()
  roleName!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty({ type: Number, isArray: true })
  permissionIds!: readonly number[];

  @ApiProperty({ type: RoleAuthorizationDataScopeVO, isArray: true })
  dataScopes!: readonly RoleAuthorizationDataScopeVO[];

  @ApiProperty({ type: RoleAuthorizationFieldPolicyVO, isArray: true })
  fieldPolicies!: readonly RoleAuthorizationFieldPolicyVO[];
}

@ApiTags('platform-administration')
@Controller('admin/roles')
export class RoleAuthorizationController {
  constructor(private readonly authorizations: ManageRoleAuthorization) {}

  @Get(':id/permissions')
  @RequireManagementResourcePermissions('role', 'system:role:list')
  @ApiOperation({
    summary: 'Read a role authorization snapshot',
    description:
      'Returns permission grants, per-resource data scopes, and custom-field policies.',
  })
  @ApiOkResponse({ type: RoleAuthorizationSnapshotVO })
  @ApiUnauthorizedResponse({ description: 'Authentication is required.' })
  @ApiForbiddenResponse({
    description: 'The role scope or permission is denied.',
  })
  @ApiNotFoundResponse({
    description: 'Role not found.',
  })
  async get(
    @Param('id', ParseIntPipe) roleId: number,
    @Req() request: AuthorizationRequest,
  ): Promise<RoleAuthorizationSnapshotVO> {
    this.assertRoleScope(request, roleId);
    return this.authorizations.get(roleId);
  }

  @Put(':id/permissions')
  @RequireManagementResourcePermissions(
    'role',
    'system:role:update',
    'system:permission:assign',
  )
  @ApiOperation({
    summary: 'Atomically replace a role authorization snapshot',
    description:
      'Only the protected system_admin role may replace permissions, resource data scopes, and field policies. The complete snapshot is saved in one serializable transaction with an operation audit record.',
  })
  @ApiOkResponse({ type: RoleAuthorizationSnapshotVO })
  @ApiBadRequestResponse({
    description: 'The snapshot or referenced IDs are invalid.',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication is required.' })
  @ApiForbiddenResponse({
    description: 'The role scope or permission is denied.',
  })
  @ApiNotFoundResponse({
    description: 'Role not found.',
  })
  @ApiConflictResponse({
    description: 'A concurrent authorization update conflicted.',
  })
  async replace(
    @Param('id', ParseIntPipe) roleId: number,
    @Body() input: ReplaceRoleAuthorizationDto,
    @Req() request: AuthorizationRequest,
  ): Promise<RoleAuthorizationSnapshotVO> {
    this.assertSystemAdministrator(request.user);
    this.assertRoleScope(request, roleId);
    return this.authorizations.replace({
      roleId,
      authorization: {
        permissionIds: input.permissionIds,
        dataScopes: input.dataScopes,
        fieldPolicies: input.fieldPolicies,
      },
      audit: {
        actorUserId: request.user.userId,
        traceId: request.traceId,
        clientIp: request.ip || null,
        userAgent: request.get('user-agent')?.slice(0, 500) ?? null,
      },
    });
  }

  private assertRoleScope(request: AuthorizationRequest, roleId: number): void {
    const scope = request.authorizationDataScopes.role;
    if (scope?.kind === 'all') return;
    if (scope?.kind === 'selected' && scope.ids.includes(roleId)) return;
    if (scope?.kind === 'selected') {
      throw new ForbiddenException('The role is outside the selected scope');
    }
    throw new ForbiddenException(
      'Role management requires all or selected scope',
    );
  }

  private assertSystemAdministrator(principal: AuthorizationPrincipal): void {
    if (
      !principal.active ||
      !principal.roles.some(
        ({ roleKey, active }) => active && roleKey === 'system_admin',
      )
    ) {
      throw new ForbiddenException(
        'Only the system administrator may configure role authorization',
      );
    }
  }
}
