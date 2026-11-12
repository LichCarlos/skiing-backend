import type { ApiResponseOptions } from '@nestjs/swagger';

export const resortCustomFieldSchemaResponse: ApiResponseOptions = {
  description: 'Active custom field definitions with effective access.',
  schema: {
    type: 'object',
    properties: {
      entityType: { type: 'string', example: 'ski_resort' },
      options: {
        type: 'object',
        additionalProperties: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              value: { type: 'string' },
              label: { type: 'string' },
            },
            required: ['value', 'label'],
          },
        },
      },
      groups: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            entityType: { type: 'string' },
            groupKey: { type: 'string' },
            label: { type: 'string' },
            sortOrder: { type: 'integer' },
            status: { type: 'string', enum: ['active', 'disabled'] },
            fields: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  fieldDefinitionId: { type: 'integer' },
                  fieldKey: { type: 'string' },
                  label: { type: 'string' },
                  dataType: { type: 'string' },
                  groupKey: { type: 'string' },
                  sortOrder: { type: 'integer' },
                  required: { type: 'boolean' },
                  defaultValue: {},
                  optionsDictType: { type: 'string', nullable: true },
                  validation: { type: 'object', nullable: true },
                  searchable: { type: 'boolean' },
                  filterable: { type: 'boolean' },
                  sortable: { type: 'boolean' },
                  status: {
                    type: 'string',
                    enum: ['draft', 'active', 'disabled'],
                  },
                  schemaVersion: { type: 'integer' },
                  canRead: { type: 'boolean' },
                  canWrite: { type: 'boolean' },
                },
                required: [
                  'fieldKey',
                  'label',
                  'dataType',
                  'canRead',
                  'canWrite',
                ],
              },
            },
          },
        },
      },
    },
    required: ['entityType', 'groups'],
  },
};
