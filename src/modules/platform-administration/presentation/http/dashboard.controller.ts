import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { RequireManagementEntry } from '../../../identity-access/presentation/http/authorization.decorators.js';
import type { AuthorizationPrincipal } from '../../../identity-access/domain/authorization.js';
import { GetDashboardSummary } from '../../application/get-dashboard-summary.js';
import { DashboardSummaryVO } from './dashboard.vo.js';

@ApiTags('admin-dashboard')
@Controller('admin/dashboard')
@RequireManagementEntry()
export class DashboardController {
  constructor(private readonly summary: GetDashboardSummary) {}
  @Get('summary')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Read authorized dashboard panels in one database snapshot',
  })
  @ApiOkResponse({ type: DashboardSummaryVO })
  get(
    @Query() query: Record<string, unknown>,
    @Req() request: Request & { user: AuthorizationPrincipal },
  ) {
    if (Object.keys(query).length)
      throw new BadRequestException(
        'Dashboard summary accepts no query parameters',
      );
    return this.summary.execute(request.user.userId);
  }
}
