import type { CustomFieldAuditContext } from '../../domain/custom-field-audit.js';
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ManageCustomFields } from '../../application/manage-custom-fields.js';
import { CUSTOM_FIELD_ENTITY_TYPES } from '../../domain/custom-field-definition.js';
import type { AuthorizationPrincipal } from '../../../identity-access/domain/authorization.js';
import { RequireManagementPermissions } from '../../../identity-access/presentation/http/authorization.decorators.js';
import {
  CreateCustomFieldDto,
  CreateCustomFieldGroupDto,
  CustomFieldGroupListQueryDto,
  CustomFieldListQueryDto,
  CustomFieldSchemaVersionDto,
  UpdateCustomFieldDto,
  UpdateCustomFieldGroupDto,
} from './custom-field.dto.js';
import {
  CustomFieldDefinitionPageVO,
  CustomFieldDefinitionVO,
  CustomFieldGroupVO,
  CustomFieldSchemaVO,
} from './custom-field.vo.js';

interface AuthorizedRequest extends Request {
  user: AuthorizationPrincipal;
  traceId: string;
}

@ApiTags('platform-administration')
@Controller('admin/custom-fields')
export class CustomFieldsController {
  constructor(private readonly customFields: ManageCustomFields) {}

  @Get()
  @RequireManagementPermissions('system:field:list')
  @ApiOperation({ summary: 'List custom field definitions' })
  @ApiOkResponse({ type: CustomFieldDefinitionPageVO })
  list(@Query() query: CustomFieldListQueryDto) {
    return this.customFields.list(query);
  }

  @Get(':entityType/schema')
  @RequireManagementPermissions('system:field:list')
  @ApiOperation({ summary: 'Read the active field schema for an entity' })
  @ApiOkResponse({ type: CustomFieldSchemaVO })
  schema(@Param('entityType') entityType: string) {
    return this.customFields.schema(entityType);
  }

  @Get(':fieldDefinitionId')
  @RequireManagementPermissions('system:field:list')
  @ApiOperation({ summary: 'Read a custom field definition' })
  @ApiOkResponse({ type: CustomFieldDefinitionVO })
  get(@Param('fieldDefinitionId', ParseIntPipe) fieldDefinitionId: number) {
    return this.customFields.get(fieldDefinitionId);
  }

  @Post()
  @RequireManagementPermissions('system:field:create')
  @ApiOperation({ summary: 'Create a custom field definition as a draft' })
  @ApiCreatedResponse({ type: CustomFieldDefinitionVO })
  create(
    @Body() input: CreateCustomFieldDto,
    @Req() request: AuthorizedRequest,
  ) {
    if (input.isPublic && !isSystemAdmin(request.user))
      throw new ForbiddenException(
        'Only system_admin may expose public fields',
      );
    return this.customFields.create(input, auditContext(request));
  }

  @Patch(':fieldDefinitionId')
  @RequireManagementPermissions('system:field:update')
  @ApiOperation({
    summary: 'Update custom field metadata using optimistic schema versioning',
  })
  @ApiOkResponse({ type: CustomFieldDefinitionVO })
  update(
    @Param('fieldDefinitionId', ParseIntPipe) fieldDefinitionId: number,
    @Body() input: UpdateCustomFieldDto,
    @Req() request: AuthorizedRequest,
  ) {
    if (input.isPublic === true && !isSystemAdmin(request.user))
      throw new ForbiddenException(
        'Only system_admin may expose public fields',
      );
    const { expectedSchemaVersion, ...patch } = input;
    return this.customFields.update(
      {
        fieldDefinitionId,
        expectedSchemaVersion,
        patch,
      },
      auditContext(request),
    );
  }

  @Patch(':fieldDefinitionId/activate')
  @RequireManagementPermissions('system:field:update')
  @ApiOperation({ summary: 'Activate a draft custom field definition' })
  @ApiOkResponse({ type: CustomFieldDefinitionVO })
  activate(
    @Param('fieldDefinitionId', ParseIntPipe) fieldDefinitionId: number,
    @Body() input: CustomFieldSchemaVersionDto,
    @Req() request: AuthorizedRequest,
  ) {
    return this.customFields.activate(
      {
        fieldDefinitionId,
        expectedSchemaVersion: input.expectedSchemaVersion,
      },
      auditContext(request),
    );
  }

  @Delete(':fieldDefinitionId')
  @RequireManagementPermissions('system:field:delete')
  @HttpCode(204)
  @ApiOperation({ summary: 'Soft-disable a custom field definition' })
  @ApiNoContentResponse({ description: 'Custom field disabled.' })
  async disable(
    @Param('fieldDefinitionId', ParseIntPipe) fieldDefinitionId: number,
    @Req() request: AuthorizedRequest,
  ): Promise<void> {
    const current = await this.customFields.get(fieldDefinitionId);
    await this.customFields.disable(
      {
        fieldDefinitionId,
        expectedSchemaVersion: current.schemaVersion,
      },
      auditContext(request),
    );
  }
}

function isSystemAdmin(principal: AuthorizationPrincipal): boolean {
  return principal.roles.some(
    (role) => role.active && role.roleKey === 'system_admin',
  );
}

@ApiTags('platform-administration')
@Controller('admin/custom-field-groups')
export class CustomFieldGroupsController {
  constructor(private readonly customFields: ManageCustomFields) {}

  @Get()
  @RequireManagementPermissions('system:field-group:list')
  @ApiOperation({ summary: 'List custom field groups' })
  @ApiOkResponse({ type: CustomFieldGroupVO, isArray: true })
  list(@Query() query: CustomFieldGroupListQueryDto) {
    return this.customFields.listGroups(query.entityType);
  }

  @Get(':entityType/:groupKey')
  @RequireManagementPermissions('system:field-group:list')
  @ApiOperation({ summary: 'Read a custom field group' })
  @ApiParam({ name: 'entityType', enum: [...CUSTOM_FIELD_ENTITY_TYPES] })
  @ApiParam({
    name: 'groupKey',
    schema: {
      type: 'string',
      pattern: '^[a-z][a-z0-9_-]{0,99}$',
      maxLength: 100,
    },
  })
  @ApiOkResponse({ type: CustomFieldGroupVO })
  get(
    @Param('entityType') entityType: string,
    @Param('groupKey') groupKey: string,
  ) {
    return this.customFields.getGroup(entityType, groupKey);
  }

  @Post()
  @RequireManagementPermissions('system:field-group:create')
  @ApiOperation({ summary: 'Create a custom field group' })
  @ApiCreatedResponse({ type: CustomFieldGroupVO })
  create(
    @Body() input: CreateCustomFieldGroupDto,
    @Req() request: AuthorizedRequest,
  ) {
    return this.customFields.createGroup(input, auditContext(request));
  }

  @Patch(':entityType/:groupKey')
  @RequireManagementPermissions('system:field-group:update')
  @ApiOperation({ summary: 'Update custom field group metadata' })
  @ApiOkResponse({ type: CustomFieldGroupVO })
  update(
    @Param('entityType') entityType: string,
    @Param('groupKey') groupKey: string,
    @Body() input: UpdateCustomFieldGroupDto,
    @Req() request: AuthorizedRequest,
  ) {
    return this.customFields.updateGroup(
      {
        entityType,
        groupKey,
        label: input.label,
        sortOrder: input.sortOrder,
      },
      auditContext(request),
    );
  }

  @Delete(':entityType/:groupKey')
  @RequireManagementPermissions('system:field-group:delete')
  @HttpCode(204)
  @ApiOperation({ summary: 'Soft-disable a custom field group' })
  @ApiNoContentResponse({ description: 'Custom field group disabled.' })
  async disable(
    @Param('entityType') entityType: string,
    @Param('groupKey') groupKey: string,
    @Req() request: AuthorizedRequest,
  ): Promise<void> {
    await this.customFields.disableGroup(
      entityType,
      groupKey,
      auditContext(request),
    );
  }
}

function auditContext(request: AuthorizedRequest): CustomFieldAuditContext {
  return {
    actorUserId: request.user.userId,
    traceId: request.traceId,
    clientIp: request.ip?.slice(0, 64) ?? null,
    userAgent: request.get('user-agent')?.slice(0, 500) ?? null,
  };
}
