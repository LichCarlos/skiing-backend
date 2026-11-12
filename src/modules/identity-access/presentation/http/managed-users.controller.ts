import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
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
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import type {
  AuthorizationPrincipal,
  ResolvedDataScope,
} from '../../domain/authorization.js';
import { RequireManagementResourcePermissions } from './authorization.decorators.js';
import { ManageUsers } from '../../application/manage-users.js';
import type {
  ManagedUser,
  ManagedUserRole,
} from '../../application/ports/managed-user-repository.js';
import {
  CreateManagedUserDto,
  ManagedUserListQueryDto,
  ReplaceManagedUserRolesDto,
  SetManagedUserStatusDto,
} from './managed-user.dto.js';

interface ManagedUserRequest extends Request {
  traceId: string;
  authenticatedUserId: number;
  user: AuthorizationPrincipal;
  authorizationDataScopes: Readonly<Record<string, ResolvedDataScope>>;
}

class ManagedUserRoleVO implements ManagedUserRole {
  @ApiProperty()
  roleId!: number;
  @ApiProperty()
  roleKey!: string;
  @ApiProperty()
  roleName!: string;
  @ApiProperty({ type: String, nullable: true })
  systemRoleCode!: string | null;
  @ApiProperty()
  status!: string;
}

class ManagedUserMerchantVO {
  @ApiProperty()
  merchantId!: number;
  @ApiProperty()
  businessName!: string;
  @ApiProperty()
  status!: string;
}

class ManagedUserVO implements ManagedUser {
  @ApiProperty()
  userId!: number;
  @ApiProperty()
  account!: string;
  @ApiProperty()
  nickname!: string;
  @ApiProperty({ enum: ['active', 'disabled'] })
  status!: ManagedUser['status'];
  @ApiProperty({ type: ManagedUserRoleVO, isArray: true })
  roles!: ManagedUserRoleVO[];
  @ApiProperty({ type: ManagedUserMerchantVO, nullable: true })
  merchant!: ManagedUser['merchant'];
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}

class ManagedUserPageVO {
  @ApiProperty({ type: ManagedUserVO, isArray: true })
  items!: ManagedUserVO[];
  @ApiProperty()
  total!: number;
  @ApiProperty()
  page!: number;
  @ApiProperty()
  pageSize!: number;
  @ApiProperty()
  hasNext!: boolean;
}

@ApiTags('identity-access')
@Controller('admin/users')
export class ManagedUsersController {
  constructor(private readonly users: ManageUsers) {}

  @Get()
  @RequireManagementResourcePermissions('user', 'system:user:list')
  @ApiOperation({ summary: 'List users in the caller data scope' })
  @ApiOkResponse({ type: ManagedUserPageVO })
  @ApiUnauthorizedResponse({ description: 'Authentication is required.' })
  @ApiForbiddenResponse({ description: 'User listing permission is missing.' })
  list(
    @Query() query: ManagedUserListQueryDto,
    @Req() request: ManagedUserRequest,
  ) {
    return this.users.list({
      page: query.page,
      pageSize: query.pageSize,
      keyword: query.keyword,
      status: query.status,
      scope: request.authorizationDataScopes.user!,
    });
  }

  @Get(':id')
  @RequireManagementResourcePermissions('user', 'system:user:list')
  @ApiOperation({ summary: 'Read a user in the caller data scope' })
  @ApiOkResponse({ type: ManagedUserVO })
  @ApiNotFoundResponse({ description: 'User is missing or out of scope.' })
  get(
    @Param('id', ParseIntPipe) userId: number,
    @Req() request: ManagedUserRequest,
  ) {
    return this.users.get(userId, request.authorizationDataScopes.user!);
  }

  @Post()
  @RequireManagementResourcePermissions('user', 'system:user:create')
  @ApiOperation({ summary: 'Create a user with an initial password' })
  @ApiCreatedResponse({ type: ManagedUserVO })
  @ApiBadRequestResponse({
    description: 'Account, password, or roles are invalid.',
  })
  @ApiConflictResponse({ description: 'The account already exists.' })
  create(
    @Body() input: CreateManagedUserDto,
    @Req() request: ManagedUserRequest,
  ) {
    const scope = request.authorizationDataScopes.user!;
    if (scope.kind !== 'all') {
      throw new ForbiddenException(
        'Global user scope is required to create accounts',
      );
    }
    return this.users.create({
      account: input.account,
      nickname: input.nickname,
      password: input.password,
      roleIds: input.roleIds,
      audit: auditContext(request),
    });
  }

  @Put(':id/roles')
  @RequireManagementResourcePermissions('user', 'system:user:assign-role')
  @ApiOperation({ summary: 'Replace all roles assigned to a user' })
  @ApiOkResponse({ type: ManagedUserVO })
  @ApiBadRequestResponse({ description: 'Role assignment is invalid.' })
  @ApiConflictResponse({
    description: 'Last system administrator is protected.',
  })
  @ApiNotFoundResponse({ description: 'User is missing or out of scope.' })
  replaceRoles(
    @Param('id', ParseIntPipe) userId: number,
    @Body() input: ReplaceManagedUserRolesDto,
    @Req() request: ManagedUserRequest,
  ) {
    return this.users.replaceRoles({
      userId,
      roleIds: input.roleIds,
      audit: auditContext(request),
    });
  }

  @Patch(':id/status')
  @RequireManagementResourcePermissions('user', 'system:user:update')
  @ApiOperation({ summary: 'Change a user active status' })
  @ApiOkResponse({ type: ManagedUserVO })
  @ApiConflictResponse({
    description: 'Last system administrator is protected.',
  })
  @ApiNotFoundResponse({ description: 'User is missing or out of scope.' })
  setStatus(
    @Param('id', ParseIntPipe) userId: number,
    @Body() input: SetManagedUserStatusDto,
    @Req() request: ManagedUserRequest,
  ) {
    return this.users.setStatus({
      userId,
      status: input.status,
      audit: auditContext(request),
    });
  }

  @Delete(':id')
  @RequireManagementResourcePermissions('user', 'system:user:update')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-disable a user account' })
  @ApiNoContentResponse()
  @ApiConflictResponse({
    description: 'Last system administrator is protected.',
  })
  @ApiNotFoundResponse({ description: 'User is missing or out of scope.' })
  async disable(
    @Param('id', ParseIntPipe) userId: number,
    @Req() request: ManagedUserRequest,
  ): Promise<void> {
    await this.users.setStatus({
      userId,
      status: 'disabled',
      audit: auditContext(request),
    });
  }
}

function auditContext(request: ManagedUserRequest) {
  return {
    actorUserId: request.user.userId,
    traceId: request.traceId,
    clientIp: request.ip ?? null,
    userAgent: request.get('user-agent') ?? null,
  };
}
