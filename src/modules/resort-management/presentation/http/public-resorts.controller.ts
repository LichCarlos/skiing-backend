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
import type { Request } from 'express';
import { PublicResortService } from '../../application/public-resort-service.js';
import { Public } from '../../../identity-access/presentation/http/authorization.decorators.js';
import { PublicResortListQueryDto } from './public-resort.dto.js';
import {
  PublicResortDetailVO,
  PublicResortFitTagVO,
  PublicResortPageVO,
} from './public-resort.vo.js';

interface OptionalAuthRequest extends Request {
  authenticatedUserId?: number;
}

@ApiTags('resorts')
@Public()
@Controller('resorts')
export class PublicResortsController {
  constructor(private readonly resorts: PublicResortService) {}

  @Get('fit-tags')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'List fit tags used by publicly published resorts' })
  @ApiOkResponse({ type: PublicResortFitTagVO, isArray: true })
  fitTags() {
    return this.resorts.fitTags();
  }

  @Get()
  @ApiOperation({ summary: 'List publicly published ski resorts' })
  @ApiOkResponse({
    type: PublicResortPageVO,
    description:
      'Published resorts with offset pagination, filters, optional distance, favorites and public custom fields.',
  })
  list(
    @Query() query: PublicResortListQueryDto,
    @Req() request: OptionalAuthRequest,
  ) {
    return this.resorts.list(query, request.authenticatedUserId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Read a publicly published ski resort' })
  @ApiOkResponse({
    type: PublicResortDetailVO,
    description: 'Public ski resort detail.',
  })
  get(
    @Param('id', ParseIntPipe) resortId: number,
    @Req() request: OptionalAuthRequest,
  ) {
    return this.resorts.get(resortId, request.authenticatedUserId);
  }
}
