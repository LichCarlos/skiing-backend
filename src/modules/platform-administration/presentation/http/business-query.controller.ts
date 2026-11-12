import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  Allow,
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Public } from '../../../identity-access/presentation/http/authorization.decorators.js';
import { QueryBusinessData } from '../../application/query-business-data.js';
import type {
  BusinessEntity,
  BusinessQuery,
  QueryValue,
} from '../../domain/business-query.js';
export class BusinessFilterDto {
  @ApiProperty() @IsString() @MaxLength(120) field!: string;
  @ApiProperty({ enum: ['eq', 'contains', 'gte', 'lte', 'has'] })
  @IsIn(['eq', 'contains', 'gte', 'lte', 'has'])
  op!: 'eq' | 'contains' | 'gte' | 'lte' | 'has';
  @ApiProperty({
    oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }],
  })
  @Allow()
  value!: QueryValue;
}
export class BusinessSortDto {
  @ApiProperty() @IsString() @MaxLength(120) field!: string;
  @ApiProperty({ enum: ['asc', 'desc'] }) @IsIn(['asc', 'desc']) direction!:
    'asc' | 'desc';
}
export class BusinessQueryDto implements BusinessQuery {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @ValidateIf((_o, v) => v !== undefined)
  @IsInt()
  @Min(1)
  page?: number;
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @ValidateIf((_o, v) => v !== undefined)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
  @ApiPropertyOptional({ maxLength: 200 })
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @MaxLength(200)
  keyword?: string;
  @ApiPropertyOptional({ type: BusinessFilterDto, isArray: true, maxItems: 20 })
  @ValidateIf((_o, v) => v !== undefined)
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => BusinessFilterDto)
  filters?: BusinessFilterDto[];
  @ApiPropertyOptional({ type: BusinessSortDto })
  @ValidateIf((_o, v) => v !== undefined)
  @IsObject()
  @ValidateNested()
  @Type(() => BusinessSortDto)
  sort?: BusinessSortDto;
}
export class BusinessQueryOptionVO {
  @ApiProperty() value!: string;
  @ApiProperty() label!: string;
}
export class BusinessQueryFieldVO {
  @ApiPropertyOptional({ type: BusinessQueryOptionVO, isArray: true })
  options?: BusinessQueryOptionVO[];
  @ApiProperty() key!: string;
  @ApiProperty() label!: string;
  @ApiProperty() dataType!: string;
  @ApiProperty() searchable!: boolean;
  @ApiProperty() filterable!: boolean;
  @ApiProperty() sortable!: boolean;
}
export class BusinessQueryRowVO {
  @ApiProperty() id!: number;
  @ApiProperty() title!: string;
  @ApiProperty({ type: 'object', additionalProperties: true }) fields!: Record<
    string,
    unknown
  >;
  @ApiProperty({ type: 'object', additionalProperties: true })
  customFields!: Record<string, unknown>;
}
export class BusinessQueryPageVO {
  @ApiProperty({ type: BusinessQueryRowVO, isArray: true })
  items!: BusinessQueryRowVO[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
  @ApiProperty({ format: 'date-time' }) asOf!: string;
}
@ApiTags('business-query')
@Controller('catalog')
export class BusinessQueryController {
  constructor(private readonly queries: QueryBusinessData) {}
  @Get(':entity/fields')
  @Header('Cache-Control', 'no-store')
  @Public()
  @ApiOkResponse({ type: BusinessQueryFieldVO, isArray: true })
  fields(@Param('entity') entity: BusinessEntity) {
    return this.queries.fields(entity);
  }
  @Post(':entity/query')
  @Header('Cache-Control', 'no-store')
  @HttpCode(200)
  @Public()
  @ApiOkResponse({ type: BusinessQueryPageVO })
  query(
    @Param('entity') entity: BusinessEntity,
    @Body() body: BusinessQueryDto,
  ) {
    return this.queries.query(entity, body);
  }
}
