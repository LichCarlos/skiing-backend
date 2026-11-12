import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import type { AuthorizationPrincipal } from '../../../identity-access/domain/authorization.js';
import { RequireManagementPermissions } from '../../../identity-access/presentation/http/authorization.decorators.js';
import { ManageDictionaries } from '../../application/manage-dictionaries.js';
import type {
  DictionaryAuditContext,
  DictionaryItem,
  ManagedDictionary,
} from '../../domain/managed-dictionary.js';
import {
  CreateDictionaryItemDto,
  CreateDictionaryTypeDto,
  DictionaryTypeListQueryDto,
  UpdateDictionaryItemDto,
  UpdateDictionaryTypeDto,
} from './managed-dictionary.dto.js';

interface DictionaryRequest extends Request {
  traceId: string;
  user: AuthorizationPrincipal;
}

class DictionaryItemVO implements DictionaryItem {
  @ApiProperty()
  itemId!: number;
  @ApiProperty({ type: Number, nullable: true })
  parentId!: number | null;
  @ApiProperty()
  label!: string;
  @ApiProperty()
  value!: string;
  @ApiProperty({ type: String, nullable: true })
  color!: string | null;
  @ApiProperty()
  sortOrder!: number;
  @ApiProperty()
  isDefault!: boolean;
  @ApiProperty({ enum: ['active', 'disabled'] })
  status!: DictionaryItem['status'];
  @ApiProperty({ type: () => DictionaryItemVO, isArray: true })
  children!: DictionaryItem[];
}

class DictionaryTypeVO implements ManagedDictionary {
  @ApiProperty()
  dictType!: string;
  @ApiProperty()
  dictName!: string;
  @ApiProperty()
  groupKey!: string;
  @ApiProperty({ enum: ['active', 'disabled'] })
  status!: ManagedDictionary['status'];
  @ApiProperty()
  publiclyReadable!: boolean;
  @ApiProperty({ type: () => DictionaryItemVO, isArray: true })
  items!: DictionaryItemVO[];
}

class DictionaryTypePageVO {
  @ApiProperty({ type: DictionaryTypeVO, isArray: true })
  items!: DictionaryTypeVO[];
  @ApiProperty()
  total!: number;
  @ApiProperty()
  page!: number;
  @ApiProperty()
  pageSize!: number;
  @ApiProperty()
  hasNext!: boolean;
}

@ApiTags('platform-administration')
@Controller('admin/dictionaries')
export class ManagedDictionariesController {
  constructor(private readonly dictionaries: ManageDictionaries) {}

  @Get()
  @RequireManagementPermissions('system:dict:list')
  @ApiOperation({ summary: 'List dictionary types' })
  @ApiOkResponse({ type: DictionaryTypePageVO })
  list(@Query() query: DictionaryTypeListQueryDto) {
    return this.dictionaries.listTypes(query);
  }

  @Get(':dictType')
  @RequireManagementPermissions('system:dict:list')
  @ApiOperation({ summary: 'Read a dictionary type and its item tree' })
  @ApiOkResponse({ type: DictionaryTypeVO })
  get(@Param('dictType') dictType: string) {
    return this.dictionaries.getType(dictType);
  }

  @Post()
  @RequireManagementPermissions('system:dict:create')
  @ApiOperation({ summary: 'Create a dictionary type' })
  @ApiCreatedResponse({ type: DictionaryTypeVO })
  create(
    @Body() input: CreateDictionaryTypeDto,
    @Req() request: DictionaryRequest,
  ) {
    return this.dictionaries.createType({
      dictType: input.dictType,
      dictName: input.dictName,
      groupKey: input.groupKey,
      publiclyReadable: input.publiclyReadable,
      audit: auditContext(request),
    });
  }

  @Patch(':dictType')
  @RequireManagementPermissions('system:dict:update')
  @ApiOperation({ summary: 'Update dictionary type metadata' })
  @ApiOkResponse({ type: DictionaryTypeVO })
  updateType(
    @Param('dictType') dictType: string,
    @Body() patch: UpdateDictionaryTypeDto,
    @Req() request: DictionaryRequest,
  ) {
    return this.dictionaries.updateType({
      dictType,
      patch,
      audit: auditContext(request),
    });
  }

  @Delete(':dictType')
  @RequireManagementPermissions('system:dict:delete')
  @HttpCode(204)
  @ApiOperation({ summary: 'Soft-disable a dictionary type' })
  @ApiNoContentResponse()
  async disableType(
    @Param('dictType') dictType: string,
    @Req() request: DictionaryRequest,
  ): Promise<void> {
    await this.dictionaries.disableType({
      dictType,
      audit: auditContext(request),
    });
  }

  @Get(':dictType/items')
  @RequireManagementPermissions('system:dict:list')
  @ApiOperation({ summary: 'Read dictionary items as a tree' })
  @ApiOkResponse({ type: DictionaryItemVO, isArray: true })
  async listItems(@Param('dictType') dictType: string) {
    return (await this.dictionaries.getType(dictType)).items;
  }

  @Get(':dictType/items/:itemId')
  @RequireManagementPermissions('system:dict:list')
  @ApiOperation({ summary: 'Read one dictionary item and its subtree' })
  @ApiParam({
    name: 'itemId',
    schema: { type: 'integer', minimum: 1, maximum: 2147483647 },
  })
  @ApiOkResponse({ type: DictionaryItemVO })
  getItem(
    @Param('dictType') dictType: string,
    @Param('itemId', ParseIntPipe) itemId: number,
  ) {
    return this.dictionaries.getItem(dictType, itemId);
  }

  @Post(':dictType/items')
  @RequireManagementPermissions('system:dict:create')
  @ApiOperation({ summary: 'Create a dictionary item' })
  @ApiCreatedResponse({ type: DictionaryItemVO })
  createItem(
    @Param('dictType') dictType: string,
    @Body() item: CreateDictionaryItemDto,
    @Req() request: DictionaryRequest,
  ) {
    return this.dictionaries.createItem({
      dictType,
      item: {
        label: item.label,
        value: item.value,
        parentId: item.parentId ?? null,
        color: item.color ?? null,
        sortOrder: item.sortOrder,
        isDefault: item.isDefault,
      },
      audit: auditContext(request),
    });
  }

  @Patch(':dictType/items/:itemId')
  @RequireManagementPermissions('system:dict:update')
  @ApiOperation({ summary: 'Update dictionary item metadata' })
  @ApiOkResponse({ type: DictionaryItemVO })
  updateItem(
    @Param('dictType') dictType: string,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body() patch: UpdateDictionaryItemDto,
    @Req() request: DictionaryRequest,
  ) {
    return this.dictionaries.updateItem({
      dictType,
      itemId,
      patch,
      audit: auditContext(request),
    });
  }

  @Delete(':dictType/items/:itemId')
  @RequireManagementPermissions('system:dict:delete')
  @HttpCode(204)
  @ApiOperation({ summary: 'Soft-disable a dictionary item' })
  @ApiNoContentResponse()
  async disableItem(
    @Param('dictType') dictType: string,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Req() request: DictionaryRequest,
  ): Promise<void> {
    await this.dictionaries.disableItem({
      dictType,
      itemId,
      audit: auditContext(request),
    });
  }
}

function auditContext(request: DictionaryRequest): DictionaryAuditContext {
  return {
    actorUserId: request.user.userId,
    traceId: request.traceId,
    clientIp: request.ip?.slice(0, 64) ?? null,
    userAgent: request.get('user-agent')?.slice(0, 500) ?? null,
  };
}
