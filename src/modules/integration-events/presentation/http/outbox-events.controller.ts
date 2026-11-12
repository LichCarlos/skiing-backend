import {
  Body,
  Controller,
  ForbiddenException,
  Get,
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
import type { Request } from 'express';
import { RequireManagementPermissions } from '../../../identity-access/presentation/http/authorization.decorators.js';
import type { AuthorizationPrincipal } from '../../../identity-access/domain/authorization.js';
import { ManageOutboxEvents } from '../../application/manage-outbox-events.js';
import {
  OUTBOX_STATUSES,
  type OutboxStatus,
} from '../../domain/outbox-management.js';

export class OutboxEventListQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
  @ApiPropertyOptional({ enum: OUTBOX_STATUSES })
  @IsOptional()
  @IsIn(OUTBOX_STATUSES)
  status?: OutboxStatus;
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  eventType?: string;
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  aggregateType?: string;
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  aggregateId?: string;
  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601({ strict: true })
  fromTime?: string;
  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601({ strict: true })
  toTime?: string;
}
export class RetryOutboxEventDto {
  @ApiProperty({ minLength: 1, maxLength: 500 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}
export class OutboxEventVO {
  @ApiProperty({ format: 'uuid' }) eventId!: string;
  @ApiProperty() eventType!: string;
  @ApiProperty() aggregateType!: string;
  @ApiProperty() aggregateId!: string;
  @ApiProperty({ enum: OUTBOX_STATUSES }) status!: OutboxStatus;
  @ApiProperty() attempts!: number;
  @ApiProperty() maxAttempts!: number;
  @ApiProperty({ format: 'date-time' }) availableAt!: string;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  lockedAt!: string | null;
  @ApiProperty({ format: 'date-time' }) occurredAt!: string;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  publishedAt!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
export class OutboxEventPageVO {
  @ApiProperty({ type: [OutboxEventVO] }) items!: OutboxEventVO[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
  @ApiProperty() hasNext!: boolean;
}
interface EventRequest extends Request {
  user: AuthorizationPrincipal;
  traceId: string;
}

@ApiTags('integration-events')
@Controller('admin/events')
export class OutboxEventsController {
  constructor(private readonly events: ManageOutboxEvents) {}

  @Get()
  @RequireManagementPermissions('system:event:list')
  @ApiOperation({
    summary: 'List Outbox event metadata',
    description:
      'System administrator only. Exact-match filters, inclusive createdAt bounds, createdAt DESC then eventId DESC. Payload, LastError and LockToken are never returned.',
  })
  @ApiOkResponse({ type: OutboxEventPageVO })
  list(@Query() query: OutboxEventListQueryDto, @Req() request: EventRequest) {
    assertAdministrator(request.user);
    return this.events.list(query);
  }

  @Post(':id/retry')
  @HttpCode(200)
  @RequireManagementPermissions('system:event:retry')
  @ApiOperation({
    summary: 'Retry a failed Outbox event',
    description:
      'Only failed → pending, otherwise 409. Retains EventId, payload and cumulative attempts; adds 8 to maxAttempts, clears lease and schedules immediately. Reason and state transition are audited in one transaction. Does not reset completed Inbox records.',
  })
  @ApiOkResponse({ type: OutboxEventVO })
  retry(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RetryOutboxEventDto,
    @Req() request: EventRequest,
  ) {
    assertAdministrator(request.user);
    return this.events.retry(id, body.reason, {
      actorUserId: request.user.userId,
      traceId: request.traceId,
      clientIp: request.ip?.slice(0, 64),
      userAgent: request.headers['user-agent']?.slice(0, 500),
    });
  }
}
function assertAdministrator(user: AuthorizationPrincipal) {
  if (
    !user?.active ||
    !user.roles.some((role) => role.active && role.roleKey === 'system_admin')
  )
    throw new ForbiddenException('Only system_admin may manage Outbox events');
}
