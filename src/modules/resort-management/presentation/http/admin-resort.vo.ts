import { ApiProperty, OmitType } from '@nestjs/swagger';
import { MerchantResortVO } from './merchant-resort.vo.js';

export class AdminResortFitTagVO {
  @ApiProperty() value!: string;
  @ApiProperty() label!: string;
}

export class AdminResortCustomFieldVO {
  @ApiProperty() fieldKey!: string;
  @ApiProperty() label!: string;
  @ApiProperty({
    nullable: true,
    oneOf: [
      { type: 'string' },
      { type: 'number' },
      { type: 'boolean' },
      { type: 'array', items: { type: 'string' } },
    ],
  })
  value!: string | number | boolean | string[] | null;
}

/** Describes the existing AdminResortService projection, without changing it. */
export class AdminResortVO extends OmitType(MerchantResortVO, [
  'fitTags',
  'customFields',
] as const) {
  @ApiProperty({ type: 'integer', nullable: true }) merchantId!: number | null;
  @ApiProperty({ type: String, nullable: true }) merchantName!: string | null;
  @ApiProperty({ type: () => AdminResortFitTagVO, isArray: true })
  fitTags!: AdminResortFitTagVO[];
  @ApiProperty({ type: () => AdminResortCustomFieldVO, isArray: true })
  customFields!: AdminResortCustomFieldVO[];
}

export class AdminResortPageVO {
  @ApiProperty({ type: () => AdminResortVO, isArray: true })
  items!: AdminResortVO[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
  @ApiProperty() hasNext!: boolean;
}
