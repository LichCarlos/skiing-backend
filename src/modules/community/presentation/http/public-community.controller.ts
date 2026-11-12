import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
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
import {
  Public,
  RequirePermissions,
} from '../../../identity-access/presentation/http/authorization.decorators.js';
import { CommunityWrites } from '../../application/community-writes.js';
import { PublicCommunityQueries } from '../../application/public-community-queries.js';
import {
  CommentListQueryDto,
  CreateCommentDto,
  DynamicListQueryDto,
  DynamicWriteDto,
  UpdateDynamicDto,
} from './community.dto.js';
import {
  CommentMutationVO,
  CommentPageVO,
  DynamicDetailVO,
  DynamicFeedVO,
  DynamicMutationVO,
  LikeStateVO,
} from './community.vo.js';

interface OptionalUserRequest extends Request {
  authenticatedUserId?: number;
}
interface AuthenticatedRequest extends OptionalUserRequest {
  authenticatedUserId: number;
}

@ApiTags('community')
@Controller()
export class PublicCommunityController {
  constructor(
    private readonly queries: PublicCommunityQueries,
    private readonly writes: CommunityWrites,
  ) {}

  @Post('dynamics')
  @RequirePermissions('community:dynamic:create')
  @ApiCreatedResponse({ type: DynamicMutationVO })
  createDynamic(
    @Body() body: DynamicWriteDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.writes.createDynamic(request.authenticatedUserId, body);
  }

  @Patch('dynamics/:id')
  @RequirePermissions('community:dynamic:update-own')
  @ApiOkResponse({ type: DynamicMutationVO })
  updateDynamic(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateDynamicDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.writes.updateDynamic(request.authenticatedUserId, id, body);
  }

  @Get('dynamics')
  @Header('Cache-Control', 'private, no-store')
  @Public()
  @ApiOkResponse({ type: DynamicFeedVO })
  list(
    @Query() query: DynamicListQueryDto,
    @Req() request: OptionalUserRequest,
  ) {
    return this.queries.dynamics(query, request.authenticatedUserId);
  }

  @Get('dynamics/:id')
  @Header('Cache-Control', 'private, no-store')
  @Public()
  @ApiOkResponse({ type: DynamicDetailVO })
  get(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: OptionalUserRequest,
  ) {
    return this.queries.dynamic(id, request.authenticatedUserId);
  }

  @Get('dynamics/:id/comments')
  @Public()
  @ApiOkResponse({ type: CommentPageVO })
  comments(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: CommentListQueryDto,
  ) {
    return this.queries.comments(id, query);
  }

  @Post('dynamics/:id/comments')
  @RequirePermissions('community:comment:create')
  @ApiCreatedResponse({ type: CommentMutationVO })
  createComment(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: CreateCommentDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.writes.createComment(request.authenticatedUserId, id, body);
  }

  @Delete('comments/:id')
  @RequirePermissions('community:comment:create')
  @HttpCode(204)
  @ApiNoContentResponse()
  async removeComment(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    await this.writes.removeComment(request.authenticatedUserId, id);
  }

  @Put('dynamics/:id/like')
  @RequirePermissions('community:like:toggle')
  @ApiOkResponse({ type: LikeStateVO })
  like(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.writes.setLiked(request.authenticatedUserId, id, true);
  }

  @Delete('dynamics/:id/like')
  @RequirePermissions('community:like:toggle')
  @ApiOkResponse({ type: LikeStateVO })
  unlike(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.writes.setLiked(request.authenticatedUserId, id, false);
  }

  @Delete('dynamics/:id')
  @RequirePermissions('community:dynamic:update-own')
  @HttpCode(204)
  @ApiNoContentResponse()
  async removeDynamic(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    await this.writes.removeDynamic(request.authenticatedUserId, id);
  }
}
