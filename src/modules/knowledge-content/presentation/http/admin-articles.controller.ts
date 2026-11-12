import {
  resolveArticleAccess,
  mayCreateArticle,
  articleActorMatches,
} from '../../domain/article-scope.js';
import {
  Body,
  ForbiddenException,
  Controller,
  Delete,
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
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import type {
  AuthorizationPrincipal,
  ResolvedDataScope,
} from '../../../identity-access/domain/authorization.js';
import { RequireManagementResourcePermissions } from '../../../identity-access/presentation/http/authorization.decorators.js';
import { AdminArticleService } from '../../application/admin-article-service.js';
import {
  AdminArticleListQueryDto,
  UpsertArticleDto,
} from './admin-article.dto.js';
import { AdminArticlePageVO, AdminArticleVO } from './admin-article.vo.js';
import { ArticleFieldSchemaVO } from './article-field-schema.vo.js';

interface AdminRequest extends Request {
  user: AuthorizationPrincipal;
  traceId: string;
  authorizationDataScopes?: Readonly<Record<string, ResolvedDataScope>>;
}

@ApiTags('admin-articles')
@Controller('admin/articles')
@RequireManagementResourcePermissions('article', 'content:article:manage')
export class AdminArticlesController {
  constructor(private readonly articles: AdminArticleService) {}

  @Get()
  @ApiOperation({ summary: 'List managed articles' })
  @ApiOkResponse({ type: AdminArticlePageVO })
  list(@Query() query: AdminArticleListQueryDto, @Req() request: AdminRequest) {
    return this.articles.list(
      query,
      articleScope(request),
      request.user.userId,
    );
  }

  @Get('custom-fields')
  @ApiOperation({
    summary: 'Read active article fields allowed by the current roles',
  })
  @ApiOkResponse({ type: ArticleFieldSchemaVO })
  customFieldSchema(@Req() request: AdminRequest) {
    return this.articles.customFieldSchema(
      articleScope(request),
      request.user.userId,
    );
  }

  @Get(':id')
  @ApiOkResponse({ type: AdminArticleVO })
  get(@Param('id', ParseIntPipe) id: number, @Req() request: AdminRequest) {
    return this.articles.get(id, articleScope(request), request.user.userId);
  }

  @Post()
  @ApiCreatedResponse({ type: AdminArticleVO })
  create(@Body() body: UpsertArticleDto, @Req() request: AdminRequest) {
    return this.articles.create(
      body,
      auditContext(request),
      articleScope(request, true),
    );
  }

  @Patch(':id')
  @ApiOkResponse({ type: AdminArticleVO })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpsertArticleDto,
    @Req() request: AdminRequest,
  ) {
    return this.articles.update(
      id,
      body,
      auditContext(request),
      articleScope(request),
    );
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiNoContentResponse()
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AdminRequest,
  ): Promise<void> {
    await this.articles.remove(
      id,
      auditContext(request),
      articleScope(request),
    );
  }

  @Patch(':id/publish')
  @ApiOkResponse({ type: AdminArticleVO })
  publish(@Param('id', ParseIntPipe) id: number, @Req() request: AdminRequest) {
    return this.articles.publish(
      id,
      auditContext(request),
      articleScope(request),
    );
  }

  @Patch(':id/withdraw')
  @ApiOkResponse({ type: AdminArticleVO })
  withdraw(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AdminRequest,
  ) {
    return this.articles.withdraw(
      id,
      auditContext(request),
      articleScope(request),
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

function articleScope(
  request: AdminRequest,
  creating = false,
): ResolvedDataScope {
  const access = resolveArticleAccess(request.authorizationDataScopes?.article);
  if (
    !access ||
    !articleActorMatches(access, request.user.userId) ||
    (creating && !mayCreateArticle(access))
  )
    throw new ForbiddenException('Article data scope is not permitted');
  return access;
}
