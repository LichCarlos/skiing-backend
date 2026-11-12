import {
  Body,
  BadRequestException,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Put,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { RequirePermissions } from '../../../identity-access/presentation/http/authorization.decorators.js';
import { MemberFavoritesService } from '../../application/member-favorites-service.js';
import {
  FavoriteListQueryDto,
  FavoriteTargetDto,
} from './member-favorites.dto.js';
import { FavoritePageVO, FavoriteStateVO } from './member-favorites.vo.js';

interface AuthenticatedRequest extends Request {
  authenticatedUserId?: number;
}

@ApiTags('member-engagement')
@Controller('me/favorites')
@RequirePermissions('member:favorite:toggle')
export class MemberFavoritesController {
  constructor(private readonly favorites: MemberFavoritesService) {}
  @Get(':targetType/:targetId')
  @Header('Cache-Control', 'private, no-store')
  @ApiOkResponse({ type: FavoriteStateVO })
  state(
    @Param('targetType') targetType: FavoriteTargetDto['targetType'],
    @Param('targetId', ParseIntPipe) targetId: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.favorites.state(this.userId(request), targetType, targetId);
  }

  @Put()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Add a resort, article or dynamic to the current user favorites',
  })
  @ApiNoContentResponse()
  async add(
    @Body() input: FavoriteTargetDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    await this.favorites.add(
      this.userId(request),
      input.targetType,
      input.targetId,
    );
  }

  @Delete(':targetType/:targetId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Remove a resort, article or dynamic from the current user favorites',
  })
  @ApiNoContentResponse()
  async remove(
    @Param('targetType') targetType: FavoriteTargetDto['targetType'],
    @Param('targetId', ParseIntPipe) targetId: number,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    if (
      targetType !== 'resort' &&
      targetType !== 'article' &&
      targetType !== 'dynamic'
    ) {
      throw new BadRequestException('Invalid favorite target type');
    }
    await this.favorites.remove(this.userId(request), targetType, targetId);
  }

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'List current user favorites' })
  @ApiOkResponse({ type: FavoritePageVO })
  list(
    @Query() query: FavoriteListQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.favorites.list(
      this.userId(request),
      query.page,
      query.pageSize,
      query.targetType,
    );
  }

  private userId(request: AuthenticatedRequest): number {
    if (!request.authenticatedUserId) throw new UnauthorizedException();
    return request.authenticatedUserId;
  }
}
