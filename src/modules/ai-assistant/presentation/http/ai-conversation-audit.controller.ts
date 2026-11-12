import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { RequireManagementResourcePermissions } from '../../../identity-access/presentation/http/authorization.decorators.js';
import { AuditAiConversations } from '../../application/audit-ai-conversations.js';

export class AiConversationAuditQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  page = 1;
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
  @ApiPropertyOptional({ minimum: 1, maximum: 2147483647 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  userId?: number;
  @ApiPropertyOptional({ enum: ['active', 'deleted'] })
  @IsOptional()
  @IsIn(['active', 'deleted'])
  status?: 'active' | 'deleted';
  @ApiPropertyOptional({
    format: 'date-time',
    description: 'Inclusive updatedAt lower bound',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  fromTime?: string;
  @ApiPropertyOptional({
    format: 'date-time',
    description: 'Inclusive updatedAt upper bound',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  toTime?: string;
}
export class AiConversationContentAccessDto {
  @ApiProperty({ minLength: 1, maxLength: 500 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}
export class AiConversationAuditSummaryVO {
  @ApiProperty({ format: 'uuid' }) conversationId!: string;
  @ApiProperty() userId!: number;
  @ApiProperty({ enum: ['active', 'deleted'] }) status!: 'active' | 'deleted';
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  deletedAt!: string | null;
  @ApiProperty() messageCount!: number;
}
export class AiConversationAuditPageVO {
  @ApiProperty({ type: [AiConversationAuditSummaryVO] })
  items!: AiConversationAuditSummaryVO[];
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
  @ApiProperty() total!: number;
}
export class AiConversationAuditMessageVO {
  @ApiProperty({ description: 'Decimal bigint string' }) messageId!: string;
  @ApiProperty() sender!: string;
  @ApiProperty() content!: string;
  @ApiProperty({ type: String, nullable: true }) generationStatus!:
    string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({
    description:
      'Stored JSON citations; object, array, scalar or null; no provider credentials',
    anyOf: [
      { type: 'object', additionalProperties: true, nullable: true },
      { type: 'array', items: {}, nullable: true },
      { type: 'string', nullable: true },
      { type: 'number', nullable: true },
      { type: 'boolean', nullable: true },
    ],
  })
  citations!: unknown;
}
export class AiConversationContentAccessVO {
  @ApiProperty({ type: [AiConversationAuditMessageVO] })
  messages!: AiConversationAuditMessageVO[];
}
interface AuditRequest {
  authenticatedUserId?: number;
  traceId?: string;
}

@ApiTags('ai-assistant')
@Controller('admin/ai/conversations')
export class AiConversationAuditController {
  constructor(private readonly conversations: AuditAiConversations) {}

  @Get()
  @RequireManagementResourcePermissions('user', 'system:ai-conversation:list')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'List minimum AI conversation audit metadata',
    description:
      'Rechecks management grants and user scope in a RepeatableRead snapshot. Excludes guest conversations; includes retained soft-deleted conversations.',
  })
  @ApiOkResponse({ type: AiConversationAuditPageVO })
  list(
    @Query() query: AiConversationAuditQueryDto,
    @Req() request: AuditRequest,
  ) {
    return this.conversations.list(actorId(request), query);
  }

  @Get(':conversationId')
  @RequireManagementResourcePermissions('user', 'system:ai-conversation:list')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Read conversation audit metadata without title or messages',
  })
  @ApiOkResponse({ type: AiConversationAuditSummaryVO })
  find(
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Req() request: AuditRequest,
  ) {
    return this.conversations.find(actorId(request), conversationId);
  }

  @Post(':conversationId/content-access')
  @HttpCode(200)
  @RequireManagementResourcePermissions(
    'user',
    'system:ai-conversation:list',
    'system:ai-conversation:read-content',
  )
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Read retained messages only after a successful reason audit',
    description:
      'Separate content grant; intersects list/content user scopes. Message reading and success audit commit in the same RepeatableRead transaction. No delete, restore or export.',
  })
  @ApiOkResponse({ type: AiConversationContentAccessVO })
  content(
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Body() body: AiConversationContentAccessDto,
    @Req() request: AuditRequest,
  ) {
    return this.conversations.readContent(actorId(request), conversationId, {
      reason: body.reason,
      traceId: request.traceId ?? 'trace-unavailable',
    });
  }
}
function actorId(request: AuditRequest): number {
  if (!request.authenticatedUserId) throw new ForbiddenException();
  return request.authenticatedUserId;
}
