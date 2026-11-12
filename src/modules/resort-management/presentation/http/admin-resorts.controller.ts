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
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import type {
  AuthorizationPrincipal,
  ResolvedDataScope,
} from '../../../identity-access/domain/authorization.js';
import { RequireManagementResourcePermissions } from '../../../identity-access/presentation/http/authorization.decorators.js';
import { AdminResortService } from '../../application/admin-resort-service.js';
import { permitsGlobalResortManagement } from '../../domain/resort-management-scope.js';
import {
  ResortTransitionDto,
  AdminResortListQueryDto,
  CreateAdminResortDto,
  UpdateAdminResortDto,
} from './admin-resort.dto.js';
import { AdminResortPageVO, AdminResortVO } from './admin-resort.vo.js';
import { resortCustomFieldSchemaResponse } from './resort-field-schema.openapi.js';

interface AdminRequest extends Request {
  user: AuthorizationPrincipal;
  traceId: string;
  authorizationDataScopes?: Readonly<Record<string, ResolvedDataScope>>;
}

@ApiTags('admin-resorts')
@Controller('admin/resorts')
export class AdminResortsController {
  constructor(private readonly resorts: AdminResortService) {}

  @Get()
  @ApiOkResponse({ type: AdminResortPageVO })
  @RequireManagementResourcePermissions('resort', 'content:resort:list-all')
  list(@Query() query: AdminResortListQueryDto, @Req() request: AdminRequest) {
    return this.resorts.list(query, globalScope(request), request.user.userId);
  }

  @Get('custom-fields')
  @ApiOkResponse(resortCustomFieldSchemaResponse)
  @RequireManagementResourcePermissions('resort', 'content:resort:list-all')
  customFieldSchema(@Req() request: AdminRequest) {
    return this.resorts.customFieldSchema(
      request.user.userId,
      globalScope(request),
    );
  }

  @Get(':id')
  @ApiOkResponse({ type: AdminResortVO })
  @RequireManagementResourcePermissions('resort', 'content:resort:list-all')
  get(@Param('id', ParseIntPipe) id: number, @Req() request: AdminRequest) {
    return this.resorts.get(id, globalScope(request), request.user.userId);
  }

  @Post()
  @ApiCreatedResponse({ type: AdminResortVO })
  @RequireManagementResourcePermissions('resort', 'content:resort:create-all')
  create(@Body() body: CreateAdminResortDto, @Req() request: AdminRequest) {
    return this.resorts.create(
      body,
      auditContext(request),
      globalScope(request),
    );
  }

  @Patch(':id')
  @ApiOkResponse({ type: AdminResortVO })
  @RequireManagementResourcePermissions('resort', 'content:resort:update-all')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateAdminResortDto,
    @Req() request: AdminRequest,
  ) {
    return this.resorts.update(
      id,
      body,
      auditContext(request),
      globalScope(request),
    );
  }

  @Delete(':id')
  @RequireManagementResourcePermissions('resort', 'content:resort:delete-all')
  @HttpCode(204)
  @ApiNoContentResponse()
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AdminRequest,
  ): Promise<void> {
    await this.resorts.remove(id, auditContext(request), globalScope(request));
  }

  @Patch(':id/publish')
  @ApiOkResponse({ type: AdminResortVO })
  @RequireManagementResourcePermissions('resort', 'content:resort:publish')
  publish(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: ResortTransitionDto,
    @Req() request: AdminRequest,
  ) {
    return this.resorts.publish(
      id,
      auditContext(request),
      globalScope(request),
      body?.reason,
    );
  }

  @Patch(':id/offline')
  @ApiOkResponse({ type: AdminResortVO })
  @RequireManagementResourcePermissions('resort', 'content:resort:offline')
  offline(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: ResortTransitionDto,
    @Req() request: AdminRequest,
  ) {
    return this.resorts.offline(
      id,
      auditContext(request),
      globalScope(request),
      body?.reason,
    );
  }
}

function auditContext(request: AdminRequest) {
  return {
    actorUserId: request.user.userId,
    traceId: request.traceId,
    clientIp: request.ip || null,
    userAgent: request.get('user-agent')?.slice(0, 500) ?? null,
  };
}

function globalScope(request: AdminRequest): ResolvedDataScope {
  const scope = request.authorizationDataScopes?.resort;
  if (!scope || !permitsGlobalResortManagement(scope)) {
    throw new ForbiddenException('Global resort management requires all scope');
  }
  return scope;
}
