import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ProjectKnowledgeWriteDto {
  @ApiProperty({ maxLength: 200 }) @IsString() @MaxLength(200) title!: string;
  @ApiProperty({ maxLength: 100000 })
  @IsString()
  @MaxLength(100000)
  content!: string;
  @ApiProperty({ maxLength: 80 }) @IsString() @MaxLength(80) category!: string;
  @ApiPropertyOptional({ type: String, maxLength: 2048, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  sourceUrl?: string | null;
}

export class UpdateProjectKnowledgeDto extends ProjectKnowledgeWriteDto {
  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}

export class ProjectKnowledgeListQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  keyword?: string;
  @ApiPropertyOptional({ enum: ['draft', 'published', 'withdrawn'] })
  @IsOptional()
  @IsIn(['draft', 'published', 'withdrawn'])
  status?: string;
}
