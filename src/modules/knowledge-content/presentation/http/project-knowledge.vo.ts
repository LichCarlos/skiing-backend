import { ApiProperty } from '@nestjs/swagger';

export class ProjectKnowledgeVO {
  @ApiProperty() projectKnowledgeId!: number;
  @ApiProperty() title!: string;
  @ApiProperty() content!: string;
  @ApiProperty() category!: string;
  @ApiProperty({ type: String, nullable: true }) sourceUrl!: string | null;
  @ApiProperty({ enum: ['draft', 'published', 'withdrawn'] }) status!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  publishTime!: string | null;
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'date-time' }) createTime!: string;
  @ApiProperty({ format: 'date-time' }) updateTime!: string;
}

export class ProjectKnowledgePageVO {
  @ApiProperty({ type: () => ProjectKnowledgeVO, isArray: true })
  items!: ProjectKnowledgeVO[];
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
  @ApiProperty() total!: number;
  @ApiProperty() hasNext!: boolean;
}
