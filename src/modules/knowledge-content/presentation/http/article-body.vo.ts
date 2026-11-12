import { ApiProperty } from '@nestjs/swagger';
export class ArticleBodyAssetVO {
  @ApiProperty() assetId!: string;
  @ApiProperty({ description: '15-minute signed URL, refreshed by re-reading the parent article.' }) url!: string;
}
