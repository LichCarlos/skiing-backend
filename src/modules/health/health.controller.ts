import { Controller, Get } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../identity-access/presentation/http/authorization.decorators.js';

export class HealthVO {
  @ApiProperty({ example: 'ok' })
  status!: 'ok';

  @ApiProperty({ format: 'date-time' })
  timestamp!: string;
}

class HealthResponseVO {
  @ApiProperty({ example: 200 })
  code!: number;

  @ApiProperty({ example: 'success' })
  msg!: string;

  @ApiProperty({ type: HealthVO })
  data!: HealthVO;

  @ApiProperty({ format: 'uuid' })
  traceId!: string;
}

@ApiTags('health')
@Controller('health')
@Public()
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Check API process health' })
  @ApiOkResponse({ type: HealthResponseVO })
  check(): HealthVO {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
