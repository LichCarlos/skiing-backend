import { Controller, Get } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiForbiddenResponse,
  ApiInternalServerErrorResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ApiErrorResponseVO } from '../../../../shared/http/api-error-response.vo.js';
import { GetPermissionTree } from '../../application/get-permission-tree.js';
import type { PermissionNode } from '../../domain/permission-tree.js';
import { RequireManagementPermissions } from './authorization.decorators.js';

class PermissionNodeVO {
  @ApiProperty()
  permissionId!: number;

  @ApiProperty({ type: Number, nullable: true })
  parentId!: number | null;

  @ApiProperty()
  permissionKey!: string;

  @ApiProperty()
  permissionName!: string;

  @ApiProperty({ enum: ['directory', 'menu', 'button', 'api'] })
  permissionType!: string;

  @ApiProperty({ type: String, nullable: true })
  route!: string | null;

  @ApiProperty({ type: String, nullable: true })
  icon!: string | null;

  @ApiProperty({ type: () => PermissionNodeVO, isArray: true })
  children!: PermissionNodeVO[];
}

class PermissionTreeResponseVO {
  @ApiProperty({ example: 200 })
  code!: number;

  @ApiProperty({ example: 'success' })
  msg!: string;

  @ApiProperty({ type: () => PermissionNodeVO, isArray: true })
  data!: PermissionNodeVO[];

  @ApiProperty({ format: 'uuid' })
  traceId!: string;
}

@ApiTags('identity-access')
@Controller('admin/permissions')
export class PermissionTreeController {
  constructor(private readonly getPermissionTree: GetPermissionTree) {}

  @Get('tree')
  @RequireManagementPermissions('system:role:list', 'system:permission:assign')
  @ApiOperation({
    summary: 'Read the active permission tree',
    description:
      'Requires management:portal:enter and both system:role:list and system:permission:assign grants.',
  })
  @ApiOkResponse({ type: PermissionTreeResponseVO })
  @ApiUnauthorizedResponse({
    description: 'Authentication is required.',
    type: ApiErrorResponseVO,
  })
  @ApiForbiddenResponse({
    description: 'Management access or a required permission grant is missing.',
    type: ApiErrorResponseVO,
  })
  @ApiInternalServerErrorResponse({
    description: 'The permission tree could not be read.',
    type: ApiErrorResponseVO,
  })
  read(): Promise<PermissionNode[]> {
    return this.getPermissionTree.execute();
  }
}
