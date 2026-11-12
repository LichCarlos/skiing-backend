import { resortCustomFieldSchemaResponse } from '../../../resort-management/presentation/http/resort-field-schema.openapi.js';
import {
  Controller,
  Get,
  Header,
  Param,
  ParseIntPipe,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { RequirePermissions } from '../../../identity-access/presentation/http/authorization.decorators.js';
import { OwnCommunityQueries } from '../../application/own-community-queries.js';
import { OwnDynamicListQueryDto } from './community.dto.js';
import { OwnDynamicDetailVO, OwnDynamicPageVO } from './community.vo.js';

@ApiTags('community')
@Controller('me/dynamics')
@RequirePermissions('community:dynamic:read-own')
export class OwnCommunityController {
  constructor(private readonly queries: OwnCommunityQueries) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @ApiOkResponse({ type: OwnDynamicPageVO })
  list(
    @Query() query: OwnDynamicListQueryDto,
    @Req() request: Request & { authenticatedUserId: number },
  ) {
    return this.queries.list(request.authenticatedUserId, query);
  }

  @Get('custom-fields')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({
    ...resortCustomFieldSchemaResponse,
    description:
      'Effective dynamic field definitions, policies and dictionary options.',
  })
  schema(@Req() request: Request & { authenticatedUserId: number }) {
    return this.queries.schema(request.authenticatedUserId);
  }

  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  @ApiOkResponse({ type: OwnDynamicDetailVO })
  get(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: Request & { authenticatedUserId: number },
  ) {
    return this.queries.get(request.authenticatedUserId, id);
  }
}
