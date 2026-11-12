import { ApiProperty } from '@nestjs/swagger';

export class CustomFieldDefinitionVO {
  @ApiProperty()
  fieldDefinitionId!: number;

  @ApiProperty({
    enum: ['ski_resort', 'article', 'dynamic', 'merchant_profile'],
  })
  entityType!: string;

  @ApiProperty()
  fieldKey!: string;

  @ApiProperty()
  label!: string;

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

  @ApiProperty()
  groupKey!: string;

  @ApiProperty()
  sortOrder!: number;

  @ApiProperty()
  required!: boolean;

  @ApiProperty({
    oneOf: [
      { type: 'string' },
      { type: 'number' },
      { type: 'boolean' },
      { type: 'object', additionalProperties: true },
      { type: 'array', items: {} },
      { type: 'null' },
    ],
  })
  defaultValue!: unknown;

  @ApiProperty({ type: String, nullable: true })
  optionsDictType!: string | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
  })
  validation!: Record<string, unknown> | null;

  @ApiProperty()
  searchable!: boolean;

  @ApiProperty()
  filterable!: boolean;

  @ApiProperty()
  sortable!: boolean;

  @ApiProperty()
  isPublic!: boolean;

  @ApiProperty({ enum: ['draft', 'active', 'disabled'] })
  status!: string;

  @ApiProperty()
  schemaVersion!: number;

  @ApiProperty({ format: 'date-time' })
  createTime!: string;

  @ApiProperty({ format: 'date-time' })
  updateTime!: string;
}

export class CustomFieldDefinitionPageVO {
  @ApiProperty({ type: () => CustomFieldDefinitionVO, isArray: true })
  items!: CustomFieldDefinitionVO[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;
}

export class CustomFieldGroupVO {
  @ApiProperty({
    enum: ['ski_resort', 'article', 'dynamic', 'merchant_profile'],
  })
  entityType!: string;

  @ApiProperty()
  groupKey!: string;

  @ApiProperty()
  label!: string;

  @ApiProperty()
  sortOrder!: number;

  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true })
  visibilityRule!: unknown;

  @ApiProperty({ enum: ['active', 'disabled'] })
  status!: string;

  @ApiProperty({ format: 'date-time' })
  createTime!: string;

  @ApiProperty({ format: 'date-time' })
  updateTime!: string;
}

export class CustomFieldSchemaGroupVO extends CustomFieldGroupVO {
  @ApiProperty({ type: () => CustomFieldDefinitionVO, isArray: true })
  fields!: CustomFieldDefinitionVO[];
}

export class CustomFieldSchemaVO {
  @ApiProperty({
    enum: ['ski_resort', 'article', 'dynamic', 'merchant_profile'],
  })
  entityType!: string;

  @ApiProperty({ type: () => CustomFieldSchemaGroupVO, isArray: true })
  groups!: CustomFieldSchemaGroupVO[];
}
