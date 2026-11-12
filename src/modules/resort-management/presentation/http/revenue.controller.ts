import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConsumes,
  ApiAcceptedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiHeader,
} from '@nestjs/swagger';
import type { Request } from 'express';
import type {
  AuthorizationPrincipal,
  ResolvedDataScope,
} from '../../../identity-access/domain/authorization.js';
import {
  RequireManagementPermissions,
  RequireManagementResourcePermissions,
} from '../../../identity-access/presentation/http/authorization.decorators.js';
import { RevenueService } from '../../application/revenue-service.js';
import { RevenueImportService } from '../../application/revenue-import.service.js';
import { RevenueListQueryDto, UpsertRevenueDto } from './revenue.dto.js';
import {
  RevenueImportJobVO,
  RevenuePageVO,
  RevenueRecordVO,
  RevenueSummaryVO,
  RevenueRequestVO,
} from './revenue.vo.js';

const MAX_CSV_BYTES = 10 * 1024 * 1024;
const CSV_MIME_TYPES = new Set([
  'text/csv',
  'application/csv',
  'application/vnd.ms-excel',
]);

interface RevenueRequest extends Request {
  user: AuthorizationPrincipal;
  traceId: string;
  authorizationDataScopes?: Readonly<Record<string, ResolvedDataScope>>;
}

interface UploadedCsv {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}

@ApiTags('merchant-revenue')
@Controller('merchant/revenue')
@RequireManagementResourcePermissions('resort', 'revenue:merchant:list')
export class MerchantRevenueController {
  constructor(private readonly revenue: RevenueService) {}

  @Get()
  @ApiOperation({ summary: 'List revenue records for the current merchant' })
  @ApiOkResponse({ type: RevenuePageVO })
  list(@Query() query: RevenueListQueryDto, @Req() request: RevenueRequest) {
    return this.revenue.merchantList(
      {
        userId: request.user.userId,
        merchantId: request.user.merchantId,
        scope: request.authorizationDataScopes?.resort,
      },
      query,
    );
  }

  @Get('summary')
  @ApiOperation({ summary: 'Summarize revenue for the current merchant' })
  @ApiOkResponse({ type: RevenueSummaryVO })
  summary(@Query() query: RevenueListQueryDto, @Req() request: RevenueRequest) {
    return this.revenue.merchantSummary(
      {
        userId: request.user.userId,
        merchantId: request.user.merchantId,
        scope: request.authorizationDataScopes?.resort,
      },
      query,
    );
  }
}

@ApiTags('admin-revenue')
@Controller('admin/revenue')
export class AdminRevenueController {
  constructor(
    private readonly revenue: RevenueService,
    private readonly imports: RevenueImportService,
  ) {}

  @Get('imports/:jobId')
  @RequireManagementPermissions('revenue:system:upsert')
  @ApiOkResponse({ type: RevenueImportJobVO })
  importResult(@Param('jobId') jobId: string, @Req() request: RevenueRequest) {
    return this.imports.find(request.user.userId, jobId);
  }

  @Get()
  @RequireManagementResourcePermissions('resort', 'revenue:system:list')
  @ApiOkResponse({ type: RevenuePageVO })
  list(@Query() query: RevenueListQueryDto, @Req() request: RevenueRequest) {
    return this.revenue.adminList(request.user.userId, query);
  }

  @Get('requests/:requestId')
  @RequireManagementPermissions('revenue:system:upsert')
  @ApiOkResponse({ type: RevenueRequestVO })
  result(
    @Param('requestId') requestId: string,
    @Req() request: RevenueRequest,
  ) {
    return this.revenue.requestResult(request.user.userId, requestId);
  }

  @Put()
  @RequireManagementPermissions('revenue:system:upsert')
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOperation({ summary: 'Upsert one daily resort revenue record' })
  @ApiOkResponse({ type: RevenueRecordVO })
  upsert(
    @Body() body: UpsertRevenueDto,
    @Req() request: RevenueRequest,
    @Headers('idempotency-key') requestId: string | undefined,
  ) {
    return this.revenue.upsertIdempotent(
      body,
      requestId,
      auditContext(request),
    );
  }

  @Post('import')
  @HttpCode(202)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  })
  @RequireManagementPermissions('revenue:system:upsert')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_CSV_BYTES, files: 1 },
      fileFilter: (_request, file, callback) => {
        if (
          !file.originalname.toLowerCase().endsWith('.csv') ||
          !CSV_MIME_TYPES.has(file.mimetype)
        ) {
          callback(new BadRequestException('Upload a UTF-8 CSV file'), false);
          return;
        }
        callback(null, true);
      },
    }),
  )
  @ApiOperation({ summary: 'Import daily resort revenue from a CSV file' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiAcceptedResponse({ type: RevenueImportJobVO })
  @ApiBadRequestResponse({ description: 'Invalid CSV file, header, or size.' })
  async import(
    @UploadedFile() file: UploadedCsv | undefined,
    @Req() request: RevenueRequest,
    @Headers('idempotency-key') requestId: string | undefined,
  ) {
    if (!file) throw new BadRequestException('CSV file is required');
    return this.imports.create(file.buffer, requestId, auditContext(request));
  }
}

function auditContext(request: RevenueRequest) {
  return {
    actorUserId: request.user.userId,
    traceId: request.traceId,
    clientIp: request.ip || null,
    userAgent: request.get('user-agent')?.slice(0, 500) ?? null,
  };
}
