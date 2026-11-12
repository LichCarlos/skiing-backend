import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';

export class CommunityAuthorVO {
  @ApiProperty() userId!: number;
  @ApiProperty() nickname!: string;
  @ApiProperty({ type: String, nullable: true }) avatarUrl!: string | null;
}

export class DynamicResortVO {
  @ApiProperty() resortId!: number;
  @ApiProperty() name!: string;
}

export class DynamicCardVO {
  @ApiProperty() dynamicId!: number;
  @ApiProperty({ type: CommunityAuthorVO }) author!: CommunityAuthorVO;
  @ApiProperty() summary!: string;
  @ApiProperty({ type: String, nullable: true }) coverUrl!: string | null;
  @ApiProperty() imageCount!: number;
  @ApiProperty({ type: DynamicResortVO, nullable: true })
  resort!: DynamicResortVO | null;
  @ApiProperty() likeCount!: number;
  @ApiProperty() commentCount!: number;
  @ApiProperty() likedByMe!: boolean;
  @ApiProperty({ enum: ['published'] }) status!: 'published';
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class DynamicFeedVO {
  @ApiProperty({ type: [DynamicCardVO] }) items!: DynamicCardVO[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
  @ApiProperty() hasNext!: boolean;
}

export class OwnDynamicCardVO extends OmitType(DynamicCardVO, [
  'status',
] as const) {
  @ApiProperty({ enum: ['pending', 'published', 'hidden'] })
  status!: 'pending' | 'published' | 'hidden';
}

export class OwnDynamicImageVO {
  @ApiProperty({
    type: String,
    pattern: '^[1-9][0-9]*$',
    description: 'Ready Asset ID owned by the dynamic author',
  })
  assetId!: string;
  @ApiProperty() url!: string;
}

export class OwnDynamicDetailVO extends OwnDynamicCardVO {
  @ApiPropertyOptional({ enum:['plain_text','markdown_v1'] }) contentFormat?: 'plain_text' | 'markdown_v1';
  @ApiPropertyOptional() version?: number;
  @ApiPropertyOptional({ type: [OwnDynamicImageVO] }) bodyAssets?: OwnDynamicImageVO[];

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  customFields?: Record<string, unknown>;
  @ApiProperty() content!: string;
  @ApiProperty({ type: [String] }) imageUrls!: string[];
  @ApiProperty({ type: [OwnDynamicImageVO] }) images!: OwnDynamicImageVO[];
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class OwnDynamicPageVO {
  @ApiProperty({ type: [OwnDynamicCardVO] }) items!: OwnDynamicCardVO[];
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
  @ApiProperty() total!: number;
  @ApiProperty() hasNext!: boolean;
}

export class DynamicDetailVO extends DynamicCardVO {
  @ApiPropertyOptional({ enum:['plain_text','markdown_v1'] }) contentFormat?: 'plain_text' | 'markdown_v1';
  @ApiPropertyOptional() version?: number;
  @ApiPropertyOptional({ type: [OwnDynamicImageVO] }) bodyAssets?: OwnDynamicImageVO[];

  @ApiProperty() content!: string;
  @ApiProperty({ type: [String] }) imageUrls!: string[];
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class CommentVO {
  @ApiProperty() commentId!: number;
  @ApiProperty({ type: CommunityAuthorVO }) author!: CommunityAuthorVO;
  @ApiProperty() content!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ enum: ['visible'] }) status!: 'visible';
}

export class CommentPageVO {
  @ApiProperty({ type: [CommentVO] }) items!: CommentVO[];
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
  @ApiProperty() total!: number;
  @ApiProperty() hasNext!: boolean;
}

export class DynamicMutationVO {
  @ApiProperty() dynamicId!: number;
  @ApiProperty({ enum: ['pending', 'published', 'hidden'] }) status!: string;
  @ApiPropertyOptional({ format: 'date-time' }) createdAt?: string;
}

export class CommentMutationVO {
  @ApiProperty() commentId!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ enum: ['visible'] }) status!: 'visible';
}

export class LikeStateVO {
  @ApiProperty() liked!: boolean;
  @ApiProperty() likeCount!: number;
}

export class AdminDynamicVO {
  @ApiPropertyOptional({ enum:['plain_text','markdown_v1'] }) contentFormat?: 'plain_text' | 'markdown_v1';
  @ApiPropertyOptional() version?: number;
  @ApiPropertyOptional({ type: [OwnDynamicImageVO] }) bodyAssets?: OwnDynamicImageVO[];

  @ApiProperty() dynamicId!: number;
  @ApiProperty() authorId!: number;
  @ApiProperty() authorNickname!: string;
  @ApiProperty() content!: string;
  @ApiProperty({ type: Number, nullable: true }) resortId!: number | null;
  @ApiProperty({ enum: ['pending', 'published', 'hidden'] }) status!: string;
  @ApiProperty({ type: String, isArray: true }) imageUrls!: string[];
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  moderatedAt!: string | null;
  @ApiProperty({ type: Number, nullable: true })
  moderatedByUserId!: number | null;
  @ApiProperty({ type: String, nullable: true })
  moderationReason!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class AdminCommentVO {
  @ApiProperty() commentId!: number;
  @ApiProperty() dynamicId!: number;
  @ApiProperty() authorId!: number;
  @ApiProperty() authorNickname!: string;
  @ApiProperty() content!: string;
  @ApiProperty({ enum: ['visible', 'hidden'] }) status!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  moderatedAt!: string | null;
  @ApiProperty({ type: Number, nullable: true })
  moderatedByUserId!: number | null;
  @ApiProperty({ type: String, nullable: true })
  moderationReason!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class AdminDynamicPageVO {
  @ApiProperty({ type: [AdminDynamicVO] }) items!: AdminDynamicVO[];
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
  @ApiProperty() total!: number;
  @ApiProperty() hasNext!: boolean;
}

export class AdminCommentPageVO {
  @ApiProperty({ type: [AdminCommentVO] }) items!: AdminCommentVO[];
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
  @ApiProperty() total!: number;
  @ApiProperty() hasNext!: boolean;
}

export class DynamicModerationVO {
  @ApiProperty() dynamicId!: number;
  @ApiProperty({ enum: ['pending', 'published', 'hidden'] })
  status!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  moderatedAt!: string | null;
  @ApiProperty({ type: Number, nullable: true })
  moderatedByUserId!: number | null;
  @ApiProperty({ type: String, nullable: true })
  moderationReason!: string | null;
}

export class CommentModerationVO {
  @ApiProperty() commentId!: number;
  @ApiProperty({ enum: ['visible', 'hidden'] }) status!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  moderatedAt!: string | null;
  @ApiProperty({ type: Number, nullable: true })
  moderatedByUserId!: number | null;
  @ApiProperty({ type: String, nullable: true })
  moderationReason!: string | null;
}
