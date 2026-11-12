import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  Req,
} from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { AuthorizationPrincipal } from '../../../identity-access/domain/authorization.js';
import { RequireManagementPermissions } from '../../../identity-access/presentation/http/authorization.decorators.js';
import { AdminCommunityService } from '../../application/admin-community-service.js';
import {
  AdminCommentListQueryDto,
  AdminDynamicListQueryDto,
  CommentModerationDto,
  DynamicModerationDto,
} from './community.dto.js';
import {
  AdminCommentPageVO,
  AdminDynamicPageVO,
  AdminDynamicVO,
  CommentModerationVO,
  DynamicModerationVO,
} from './community.vo.js';

interface AdminRequest extends Request {
  user: AuthorizationPrincipal;
  traceId: string;
}

@ApiTags('admin-community')
@Controller()
@RequireManagementPermissions('content:dynamic:moderate')
export class AdminCommunityController {
  constructor(private readonly community: AdminCommunityService) {}

  @Get('admin/dynamics')
  @ApiOkResponse({ type: AdminDynamicPageVO })
  listDynamics(@Query() query: AdminDynamicListQueryDto) {
    return this.community.listDynamics(query);
  }

  @Get('admin/dynamics/:id')
  @ApiOkResponse({ type: AdminDynamicVO })
  getDynamic(@Param('id', ParseIntPipe) id: number) {
    return this.community.getDynamic(id);
  }

  @Get('admin/dynamics/:id/comments')
  @ApiOkResponse({ type: AdminCommentPageVO })
  listComments(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: AdminCommentListQueryDto,
  ) {
    return this.community.listComments(id, query);
  }

  @Patch('admin/dynamics/:id/moderation')
  @ApiOkResponse({ type: DynamicModerationVO })
  moderateDynamic(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: DynamicModerationDto,
    @Req() request: AdminRequest,
  ) {
    return this.community.moderateDynamic(id, body, audit(request));
  }

  @Patch('admin/comments/:id/moderation')
  @ApiOkResponse({ type: CommentModerationVO })
  moderateComment(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: CommentModerationDto,
    @Req() request: AdminRequest,
  ) {
    return this.community.moderateComment(id, body, audit(request));
  }

  @Delete('admin/dynamics/:id')
  @HttpCode(204)
  @ApiNoContentResponse()
  async removeDynamic(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AdminRequest,
  ): Promise<void> {
    await this.community.removeDynamic(id, audit(request));
  }

  @Delete('admin/comments/:id')
  @HttpCode(204)
  @ApiNoContentResponse()
  async removeComment(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AdminRequest,
  ): Promise<void> {
    await this.community.removeComment(id, audit(request));
  }
}

function audit(request: AdminRequest) {
  return {
    actorUserId: request.user.userId,
    traceId: request.traceId,
    clientIp: request.ip || null,
    userAgent: request.get('user-agent')?.slice(0, 500) ?? null,
  };
}
