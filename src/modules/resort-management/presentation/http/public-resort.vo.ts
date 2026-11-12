import { ApiProperty } from '@nestjs/swagger';

export class PublicResortRegionVO {
  @ApiProperty()
  province!: string;

  @ApiProperty()
  city!: string;

  @ApiProperty({ type: String, nullable: true })
  district!: string | null;
}

export class PublicResortFitTagVO {
  @ApiProperty()
  value!: string;

  @ApiProperty()
  label!: string;
}

export class PublicCustomFieldValueVO {
  @ApiProperty()
  fieldKey!: string;

  @ApiProperty()
  label!: string;

  @ApiProperty({
    oneOf: [
      { type: 'string' },
      { type: 'number' },
      { type: 'boolean' },
      { type: 'array', items: { type: 'string' } },
      { type: 'null' },
    ],
  })
  value!: string | number | boolean | string[] | null;
}

export class PublicResortCardVO {
  @ApiProperty()
  resortId!: number;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: () => PublicResortRegionVO })
  region!: PublicResortRegionVO;

  @ApiProperty({ type: String, nullable: true })
  coverUrl!: string | null;

  @ApiProperty({ type: Number, nullable: true })
  rating!: number | null;

  @ApiProperty()
  ratingCount!: number;

  @ApiProperty({ type: Number, nullable: true })
  distanceMeters!: number | null;

  @ApiProperty({ type: String, nullable: true })
  startingPrice!: string | null;

  @ApiProperty({ type: () => PublicResortFitTagVO, isArray: true })
  fitTags!: PublicResortFitTagVO[];

  @ApiProperty({ enum: ['open', 'closed', 'limited', 'unknown'] })
  openStatus!: string;

  @ApiProperty()
  favoriteByMe!: boolean;

  @ApiProperty({ type: () => PublicCustomFieldValueVO, isArray: true })
  customFields!: PublicCustomFieldValueVO[];
}

export class PublicResortSnowConditionVO {
  @ApiProperty()
  value!: string;

  @ApiProperty()
  label!: string;

  @ApiProperty({ type: String, nullable: true })
  verifiedAt!: string | null;
}

export class PublicResortDetailVO extends PublicResortCardVO {
  @ApiProperty({ type: String, nullable: true })
  address!: string | null;

  @ApiProperty({ type: Number, nullable: true })
  longitude!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  latitude!: number | null;

  @ApiProperty()
  description!: string;

  @ApiProperty({ type: String, isArray: true })
  galleryUrls!: string[];

  @ApiProperty({ type: () => PublicResortSnowConditionVO })
  snowCondition!: PublicResortSnowConditionVO;

  @ApiProperty({ type: String, nullable: true })
  openingHours!: string | null;

  @ApiProperty({ type: String, nullable: true })
  trailSummary!: string | null;

  @ApiProperty({ type: String, nullable: true })
  facilitySummary!: string | null;

  @ApiProperty({ type: String, nullable: true })
  officialUrl!: string | null;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class PublicResortPageVO {
  @ApiProperty({ type: () => PublicResortCardVO, isArray: true })
  items!: PublicResortCardVO[];

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiProperty()
  total!: number;

  @ApiProperty()
  hasNext!: boolean;
}
