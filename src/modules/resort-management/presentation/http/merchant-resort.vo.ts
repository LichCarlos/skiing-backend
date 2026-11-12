import { ApiProperty } from '@nestjs/swagger';

export class MerchantResortGalleryVO {
  @ApiProperty({ type: String }) assetId!: string;
  @ApiProperty() sortOrder!: number;
  @ApiProperty() url!: string;
}

/** Existing service projection; never exposes storage keys or merchant contact. */
export class MerchantResortVO {
  @ApiProperty() resortId!: number;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) province!: string | null;
  @ApiProperty({ type: String, nullable: true }) city!: string | null;
  @ApiProperty({ type: String, nullable: true }) district!: string | null;
  @ApiProperty({ type: String, nullable: true }) address!: string | null;
  @ApiProperty({ type: String, nullable: true }) longitude!: string | null;
  @ApiProperty({ type: String, nullable: true }) latitude!: string | null;
  @ApiProperty({ type: String, nullable: true }) coverAssetId!: string | null;
  @ApiProperty({ type: String, nullable: true }) coverUrl!: string | null;
  @ApiProperty({ type: () => MerchantResortGalleryVO, isArray: true })
  gallery!: MerchantResortGalleryVO[];
  @ApiProperty({ type: String, nullable: true }) rating!: string | null;
  @ApiProperty() ratingCount!: number;
  @ApiProperty({ type: String, isArray: true }) fitTags!: string[];
  @ApiProperty() price!: number;
  @ApiProperty({ enum: ['open', 'closed', 'limited', 'unknown'] })
  openStatus!: string;
  @ApiProperty() snowCondition!: string;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  snowConditionUpdatedAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) openingHours!: string | null;
  @ApiProperty({ type: String, nullable: true }) trailSummary!: string | null;
  @ApiProperty({ type: String, nullable: true }) facilitySummary!:
    string | null;
  @ApiProperty({ type: String, nullable: true }) officialUrl!: string | null;
  @ApiProperty() description!: string;
  @ApiProperty({ type: 'object', additionalProperties: true })
  customFields!: Record<string, unknown>;
  @ApiProperty({ enum: ['draft', 'pending_review', 'published', 'offline'] })
  status!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class MerchantResortPageVO {
  @ApiProperty({ type: () => MerchantResortVO, isArray: true })
  items!: MerchantResortVO[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
  @ApiProperty() hasNext!: boolean;
}
