import { resortCustomFieldSchemaResponse } from './resort-field-schema.openapi.js';
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
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import type {
  AuthorizationPrincipal,
  ResolvedDataScope,
} from '../../../identity-access/domain/authorization.js';
import { RequireManagementResourcePermissions } from '../../../identity-access/presentation/http/authorization.decorators.js';
import { MerchantResortService } from '../../application/merchant-resort-service.js';
import {
  CreateMerchantResortDto,
  UpdateMerchantResortDto,
} from './merchant-resort.dto.js';
import {
  MerchantResortPageVO,
  MerchantResortVO,
} from './merchant-resort.vo.js';

interface MerchantRequest extends Request {
  user: AuthorizationPrincipal;
  traceId: string;
  authorizationDataScopes?: Readonly<Record<string, ResolvedDataScope>>;
}

@ApiTags('merchant-resorts')
@Controller('merchant/resorts')
export class MerchantResortsController {
  constructor(private readonly resorts: MerchantResortService) {}

  @Get()
  @RequireManagementResourcePermissions('resort', 'resort:merchant:list')
  @ApiOperation({ summary: 'List resorts belonging to the current merchant' })
  @ApiQuery({ name: 'page', required: false, type: Number, minimum: 1 })
  @ApiQuery({
    name: 'pageSize',
    required: false,
    type: Number,
    minimum: 1,
    maximum: 100,
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['draft', 'pending_review', 'published', 'offline'],
  })
  @ApiOkResponse({ type: MerchantResortPageVO })
  list(
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
    @Query('status') status: string | undefined,
    @Req() request: MerchantRequest,
  ) {
    return this.resorts.list({
      userId: request.user.userId,
      merchantId: request.user.merchantId,
      scope: request.authorizationDataScopes?.resort,
      page,
      pageSize,
      status,
    });
  }

  @Get('custom-fields')
  @RequireManagementResourcePermissions('resort', 'resort:merchant:list')
  @ApiOperation({
    summary: 'Read active resort fields allowed by the current roles',
  })
  @ApiOkResponse(resortCustomFieldSchemaResponse)
  customFieldSchema(@Req() request: MerchantRequest) {
    return this.resorts.customFieldSchema({
      userId: request.user.userId,
      merchantId: request.user.merchantId,
      scope: request.authorizationDataScopes?.resort,
    });
  }

  @Get(':id')
  @RequireManagementResourcePermissions('resort', 'resort:merchant:list')
  @ApiOperation({ summary: 'Read a resort belonging to the current merchant' })
  @ApiOkResponse({ type: MerchantResortVO })
  get(
    @Param('id', ParseIntPipe) resortId: number,
    @Req() request: MerchantRequest,
  ) {
    return this.resorts.get({
      userId: request.user.userId,
      merchantId: request.user.merchantId,
      scope: request.authorizationDataScopes?.resort,
      resortId,
    });
  }

  @Post()
  @RequireManagementResourcePermissions('resort', 'resort:merchant:create')
  @ApiOperation({ summary: 'Create a draft resort for the current merchant' })
  @ApiCreatedResponse({ type: MerchantResortVO })
  create(
    @Body() body: CreateMerchantResortDto,
    @Req() request: MerchantRequest,
  ) {
    if (request.authorizationDataScopes?.resort?.kind === 'selected')
      throw new ForbiddenException('Selected scope cannot create resorts');
    return this.resorts.create(
      {
        userId: request.user.userId,
        merchantId: request.user.merchantId,
        scope: request.authorizationDataScopes?.resort,
        body,
      },
      auditContext(request),
    );
  }

  @Patch(':id')
  @RequireManagementResourcePermissions('resort', 'resort:merchant:update')
  @ApiOperation({
    summary: 'Update a resort belonging to the current merchant',
  })
  @ApiOkResponse({ type: MerchantResortVO })
  update(
    @Param('id', ParseIntPipe) resortId: number,
    @Body() body: UpdateMerchantResortDto,
    @Req() request: MerchantRequest,
  ) {
    return this.resorts.update(
      {
        userId: request.user.userId,
        merchantId: request.user.merchantId,
        scope: request.authorizationDataScopes?.resort,
        resortId,
        body,
      },
      auditContext(request),
    );
  }

  @Delete(':id')
  @RequireManagementResourcePermissions('resort', 'resort:merchant:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Soft-delete a resort belonging to the current merchant',
  })
  @ApiNoContentResponse()
  async remove(
    @Param('id', ParseIntPipe) resortId: number,
    @Req() request: MerchantRequest,
  ): Promise<void> {
    await this.resorts.remove(
      {
        userId: request.user.userId,
        merchantId: request.user.merchantId,
        scope: request.authorizationDataScopes?.resort,
        resortId,
      },
      auditContext(request),
    );
  }

  @Patch(':id/submit-review')
  @RequireManagementResourcePermissions(
    'resort',
    'resort:merchant:submit-review',
  )
  @ApiOperation({
    summary: 'Submit an eligible resort for administrator review',
  })
  @ApiOkResponse({ type: MerchantResortVO })
  submitReview(
    @Param('id', ParseIntPipe) resortId: number,
    @Req() request: MerchantRequest,
  ) {
    return this.resorts.submitReview(
      {
        userId: request.user.userId,
        merchantId: request.user.merchantId,
        scope: request.authorizationDataScopes?.resort,
        resortId,
      },
      auditContext(request),
    );
  }
}

function auditContext(request: MerchantRequest) {
  return {
    traceId: request.traceId,
    clientIp: request.ip || null,
    userAgent: request.get('user-agent')?.slice(0, 500) ?? null,
  };
}
