import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ApiErrorDetailVO {
  @ApiPropertyOptional()
  field?: string;

  @ApiProperty()
  code!: string;

  @ApiProperty()
  message!: string;
}

export class ApiErrorResponseVO {
  @ApiProperty({ minimum: 400, maximum: 599 })
  code!: number;

  @ApiProperty()
  msg!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: false,
    nullable: true,
    example: null,
  })
  data!: null;

  @ApiProperty({ format: 'uuid' })
  traceId!: string;

  @ApiPropertyOptional({ type: () => ApiErrorDetailVO, isArray: true })
  details?: ApiErrorDetailVO[];
}
