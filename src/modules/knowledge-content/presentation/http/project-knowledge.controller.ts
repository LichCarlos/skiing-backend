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
import type { AuthorizationPrincipal } from '../../../identity-access/domain/authorization.js';
import { RequireManagementPermissions } from '../../../identity-access/presentation/http/authorization.decorators.js';
import { ProjectKnowledgeService } from '../../application/project-knowledge.service.js';
import {
  ProjectKnowledgeListQueryDto,
  ProjectKnowledgeWriteDto,
  UpdateProjectKnowledgeDto,
} from './project-knowledge.dto.js';
import {
  ProjectKnowledgePageVO,
  ProjectKnowledgeVO,
} from './project-knowledge.vo.js';

interface AdminRequest extends Request {
  user: AuthorizationPrincipal;
  traceId: string;
}
@ApiTags('admin-project-knowledge')
@Controller('admin/project-knowledge')
@RequireManagementPermissions('content:project-knowledge:list')
export class ProjectKnowledgeController {
  constructor(private readonly knowledge: ProjectKnowledgeService) {}
  @Get() @ApiOkResponse({ type: ProjectKnowledgePageVO }) list(
    @Query() query: ProjectKnowledgeListQueryDto,
    @Req() request: AdminRequest,
  ) {
    assertSystemAdmin(request.user);
    return this.knowledge.list(query);
  }
  @Get(':id')
  @RequireManagementPermissions('content:project-knowledge:list')
  @ApiOkResponse({ type: ProjectKnowledgeVO })
  get(@Param('id', ParseIntPipe) id: number, @Req() request: AdminRequest) {
    assertSystemAdmin(request.user);
    return this.knowledge.get(id);
  }
  @Post()
  @RequireManagementPermissions('content:project-knowledge:create')
  @ApiCreatedResponse({ type: ProjectKnowledgeVO })
  create(@Body() body: ProjectKnowledgeWriteDto, @Req() request: AdminRequest) {
    assertSystemAdmin(request.user);
    return this.knowledge.create(body, audit(request));
  }
  @Patch(':id')
  @RequireManagementPermissions('content:project-knowledge:update')
  @ApiOkResponse({ type: ProjectKnowledgeVO })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateProjectKnowledgeDto,
    @Req() request: AdminRequest,
  ) {
    assertSystemAdmin(request.user);
    return this.knowledge.update(id, body, audit(request));
  }
  @Patch(':id/publish')
  @RequireManagementPermissions('content:project-knowledge:publish')
  @ApiOkResponse({ type: ProjectKnowledgeVO })
  publish(@Param('id', ParseIntPipe) id: number, @Req() request: AdminRequest) {
    assertSystemAdmin(request.user);
    return this.knowledge.publish(id, audit(request));
  }
  @Patch(':id/withdraw')
  @RequireManagementPermissions('content:project-knowledge:withdraw')
  @ApiOkResponse({ type: ProjectKnowledgeVO })
  withdraw(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AdminRequest,
  ) {
    assertSystemAdmin(request.user);
    return this.knowledge.withdraw(id, audit(request));
  }
  @Delete(':id')
  @RequireManagementPermissions('content:project-knowledge:delete')
  @HttpCode(204)
  @ApiNoContentResponse()
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AdminRequest,
  ): Promise<void> {
    assertSystemAdmin(request.user);
    await this.knowledge.remove(id, audit(request));
  }
}
function assertSystemAdmin(user: AuthorizationPrincipal) {
  if (
    !user.roles.some((role) => role.active && role.roleKey === 'system_admin')
  )
    throw new ForbiddenException(
      'Only system_admin can manage project knowledge',
    );
}
function audit(request: AdminRequest) {
  return {
    actorUserId: request.user.userId,
    traceId: request.traceId,
    clientIp: request.ip || null,
    userAgent: request.get('user-agent')?.slice(0, 500) ?? null,
  };
}
