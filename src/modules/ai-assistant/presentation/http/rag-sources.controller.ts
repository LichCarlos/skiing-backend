import {
  BadRequestException,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Body,
  Patch,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { ManagementWriteAuthorizationError } from '../../../identity-access/domain/management-write-authorization.js';
import { RequireManagementPermissions } from '../../../identity-access/presentation/http/authorization.decorators.js';
import {
  ManageRagSources,
  RagSourceConflictError,
  RagSourceNotFoundError,
  RagSourcePageInvalidError,
} from '../../application/manage-rag-sources.js';
import type { RagSourceVO } from '../../application/ports/rag-source-management.repository.js';
import {
  RagSourceControlDto,
  RagSourceListQueryDto,
  RagSourceStatusDto,
} from './rag-source-management.dto.js';

interface RagSourceRequest extends Request {
  authenticatedUserId?: number;
  traceId?: string;
}

export class RagSourceVOClass {
  @ApiPropertyOptional({ type: String, nullable: true }) failureReason?:
    string | null;
  @ApiPropertyOptional({ type: String, nullable: true, format: 'date-time' })
  failureAt?: string | null;
  @ApiProperty() ragDocumentId!: number;
  @ApiProperty() sourceKey!: string;
  @ApiProperty({
    enum: ['resort', 'article', 'project_doc', 'dynamic', 'dictionary'],
  })
  sourceType!: string;
  @ApiProperty({ type: Number, nullable: true }) sourceId!: number | null;
  @ApiProperty() title!: string;
  @ApiProperty({ enum: ['public', 'merchant', 'admin'] }) accessScope!: string;
  @ApiProperty({ enum: ['pending', 'indexed', 'failed', 'disabled'] })
  status!: string;
  @ApiProperty() manualDisabled!: boolean;
  @ApiProperty({ minimum: 1 }) controlVersion!: number;
  @ApiProperty() sourceEligible!: boolean;
  @ApiProperty() chunkCount!: number;
  @ApiProperty({ type: [String] }) embeddingModels!: string[];
  @ApiProperty({ enum: [1024] }) embeddingDimension!: 1024;
  @ApiProperty({ format: 'date-time' }) sourceUpdatedAt!: string;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  indexedAt!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({
    type: String,
    nullable: true,
    enum: ['indexing_failed', null],
  })
  failureCode!: 'indexing_failed' | null;
}

export class RagSourcePageVO {
  @ApiProperty({ type: [RagSourceVOClass] }) items!: RagSourceVO[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export class RagSourceCommandVO {
  @ApiProperty({ type: RagSourceVOClass }) source!: RagSourceVO;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) eventId!:
    string | null;
}

export class RagSourceReindexCommandVO {
  @ApiProperty({ type: RagSourceVOClass }) source!: RagSourceVO;
  @ApiProperty({ format: 'uuid' }) eventId!: string;
}

@ApiTags('ai-assistant')
@Controller('admin/ai/sources')
export class RagSourcesController {
  constructor(private readonly sources: ManageRagSources) {}

  @Get()
  @RequireManagementPermissions('ai:knowledge:list')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'List existing RAG source index records',
    description:
      'Requires the built-in system_admin identity, management portal access and ai:knowledge:list. Returns metadata only; initial discovery uses the existing rag:reindex CLI.',
  })
  @ApiOkResponse({ type: RagSourcePageVO })
  @ApiBadRequestResponse()
  async list(
    @Query() query: RagSourceListQueryDto,
    @Req() request: RagSourceRequest,
  ) {
    try {
      return await this.sources.list(this.userId(request), query);
    } catch (error) {
      throw mapRagSourceError(error);
    }
  }

  @Get(':id')
  @RequireManagementPermissions('ai:knowledge:list')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Read RAG source index metadata without its content',
  })
  @ApiOkResponse({ type: RagSourceVOClass })
  @ApiNotFoundResponse()
  async find(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: RagSourceRequest,
  ) {
    assertPositiveInt32(id);
    try {
      return await this.sources.find(this.userId(request), id);
    } catch (error) {
      throw mapRagSourceError(error);
    }
  }

  @Post(':id/reindex')
  @RequireManagementPermissions('ai:knowledge:reindex')
  @HttpCode(HttpStatus.ACCEPTED)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Queue a version-fenced RAG source rebuild' })
  @ApiAcceptedResponse({ type: RagSourceReindexCommandVO })
  @ApiConflictResponse()
  @ApiNotFoundResponse()
  async reindex(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: RagSourceControlDto,
    @Req() request: RagSourceRequest,
  ) {
    assertPositiveInt32(id);
    try {
      return await this.sources.reindex(this.userId(request), id, {
        expectedVersion: body.expectedVersion,
        reason: body.reason,
        traceId: request.traceId ?? 'trace-unavailable',
      });
    } catch (error) {
      throw mapRagSourceError(error);
    }
  }

  @Patch(':id/status')
  @RequireManagementPermissions('ai:knowledge:disable')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Enable or manually disable a RAG source' })
  @ApiOkResponse({ type: RagSourceCommandVO })
  @ApiConflictResponse()
  @ApiNotFoundResponse()
  async setStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: RagSourceStatusDto,
    @Req() request: RagSourceRequest,
  ) {
    assertPositiveInt32(id);
    try {
      return await this.sources.setEnabled(this.userId(request), id, {
        enabled: body.enabled,
        expectedVersion: body.expectedVersion,
        reason: body.reason,
        traceId: request.traceId ?? 'trace-unavailable',
      });
    } catch (error) {
      throw mapRagSourceError(error);
    }
  }

  private userId(request: RagSourceRequest): number {
    if (
      !Number.isSafeInteger(request.authenticatedUserId) ||
      !request.authenticatedUserId
    )
      throw new ForbiddenException('Authenticated administrator is required');
    return request.authenticatedUserId;
  }
}

function assertPositiveInt32(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647)
    throw new BadRequestException('id must be a positive int4');
}

function mapRagSourceError(error: unknown): Error {
  if (error instanceof RagSourceNotFoundError)
    return new NotFoundException('RAG source not found');
  if (error instanceof RagSourceConflictError)
    return new ConflictException(error.message);
  if (error instanceof RagSourcePageInvalidError)
    return new BadRequestException(error.message);
  if (error instanceof ManagementWriteAuthorizationError)
    return new ForbiddenException(error.message);
  return error instanceof Error
    ? error
    : new Error('RAG source request failed');
}
