import { ApiProperty } from '@nestjs/swagger';

export class ArticleFieldDefinitionVO {
  @ApiProperty() fieldDefinitionId!: number;
  @ApiProperty() fieldKey!: string;
  @ApiProperty() label!: string;
  @ApiProperty({
    enum: [
      'text',
      'textarea',
      'integer',
      'decimal',
      'boolean',
      'date',
      'single_select',
      'multi_select',
      'url',
    ],
  })
  dataType!: string;
  @ApiProperty() groupKey!: string;
  @ApiProperty() sortOrder!: number;
  @ApiProperty() required!: boolean;
  @ApiProperty({
    nullable: true,
    oneOf: [
      { type: 'string' },
      { type: 'number' },
      { type: 'boolean' },
      { type: 'array', items: {} },
      { type: 'object', additionalProperties: true },
    ],
  })
  defaultValue!: unknown;
  @ApiProperty({ type: String, nullable: true }) optionsDictType!:
    string | null;
  @ApiProperty({ type: 'object', nullable: true, additionalProperties: true })
  validation!: Record<string, unknown> | null;
  @ApiProperty() schemaVersion!: number;
  @ApiProperty() canRead!: boolean;
  @ApiProperty() canWrite!: boolean;
}
export class ArticleFieldGroupVO {
  @ApiProperty() groupKey!: string;
  @ApiProperty() label!: string;
  @ApiProperty() sortOrder!: number;
  @ApiProperty({ type: () => ArticleFieldDefinitionVO, isArray: true })
  fields!: ArticleFieldDefinitionVO[];
}
export class ArticleFieldSchemaVO {
  @ApiProperty({ enum: ['article'] }) entityType!: 'article';
  @ApiProperty({ type: () => ArticleFieldGroupVO, isArray: true })
  groups!: ArticleFieldGroupVO[];
}
