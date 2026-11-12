import {
  Controller,
  Get,
  Header,
  Param,
  ParseIntPipe,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../identity-access/presentation/http/authorization.decorators.js';
import { PublicArticleQueries } from '../../application/public-article-queries.js';
import { PublicArticleListQueryDto } from './public-article.dto.js';
import {
  PublicArticleCategoryVO,
  PublicArticleDetailVO,
  PublicArticlePageVO,
} from './public-article.vo.js';

@ApiTags('public-articles')
@Public()
@Controller()
export class PublicArticlesController {
  constructor(private readonly articles: PublicArticleQueries) {}

  @Get('knowledge/categories')
  @ApiOperation({ summary: 'List publicly readable article categories' })
  @ApiOkResponse({ type: PublicArticleCategoryVO, isArray: true })
  categories() {
    return this.articles.categories();
  }

  @Get('articles')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'List published public articles' })
  @ApiOkResponse({ type: PublicArticlePageVO })
  list(
    @Query() query: PublicArticleListQueryDto,
    @Req() request: { authenticatedUserId?: number },
  ) {
    return this.articles.list(query, request.authenticatedUserId);
  }

  @Get('articles/:id')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Read a published public article' })
  @ApiOkResponse({ type: PublicArticleDetailVO })
  get(
    @Param('id', ParseIntPipe) articleId: number,
    @Req() request: { authenticatedUserId?: number },
  ) {
    return this.articles.get(articleId, request.authenticatedUserId);
  }
}
