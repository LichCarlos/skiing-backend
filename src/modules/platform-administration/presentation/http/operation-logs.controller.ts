import {
  Controller,
  ForbiddenException,
  Get,
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
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { AuthorizationPrincipal } from '../../../identity-access/domain/authorization.js';
import { RequireManagementPermissions } from '../../../identity-access/presentation/http/authorization.decorators.js';
import { ListOperationLogs } from '../../application/list-operation-logs.js';

export class OperationLogListQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
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
  actorUserId?: number;

  @ApiPropertyOptional({ maxLength: 150 })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  actionKey?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  resourceKey?: string;

  @ApiPropertyOptional({ enum: ['success', 'failure'] })
  @IsOptional()
  @IsIn(['success', 'failure'])
  result?: 'success' | 'failure';

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  traceId?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601({ strict: true })
  fromTime?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601({ strict: true })
  toTime?: string;
}

export class OperationLogVO {
  @ApiProperty({ example: '9007199254740993' }) operationLogId!: string;
  @ApiProperty({ type: Number, nullable: true }) actorUserId!: number | null;
  @ApiProperty() actorAccountSnapshot!: string;
  @ApiProperty() actionKey!: string;
  @ApiProperty() resourceKey!: string;
  @ApiProperty() targetType!: string;
  @ApiProperty() targetId!: string;
  @ApiProperty({ enum: ['success', 'failure'] }) result!: 'success' | 'failure';
  @ApiProperty() traceId!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
export class OperationLogPageVO {
  @ApiProperty({ type: [OperationLogVO] }) items!: OperationLogVO[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
  @ApiProperty() hasNext!: boolean;
}

@ApiTags('platform-administration')
@Controller('admin/operation-logs')
export class OperationLogsController {
  constructor(private readonly logs: ListOperationLogs) {}

  @Get()
  @RequireManagementPermissions('system:operation-log:list')
  @ApiOperation({
    summary: 'Read operation log metadata',
    description:
      'System administrator only, with management portal and operation-log permission. Exact-match filters; inclusive ISO time bounds. Ordered by createdAt DESC then operationLogId DESC. Sensitive audit payloads are never returned.',
  })
  @ApiOkResponse({ type: OperationLogPageVO })
  list(
    @Query() query: OperationLogListQueryDto,
    @Req() request: { user: AuthorizationPrincipal },
  ) {
    if (
      !request.user?.roles.some(
        (role) => role.active && role.roleKey === 'system_admin',
      )
    )
      throw new ForbiddenException('Only system_admin may read operation logs');
    return this.logs.execute(query);
  }
}
