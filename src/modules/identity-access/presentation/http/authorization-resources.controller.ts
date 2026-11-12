import { Controller, Get } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { ListAuthorizationResources } from '../../application/list-authorization-resources.js';
import { RequireManagementPermissions } from './authorization.decorators.js';

class AuthorizationResourceVO {
  @ApiProperty()
  resourceKey!: string;

  @ApiProperty()
  label!: string;
}

@ApiTags('identity-access')
@Controller('admin/authorization/resources')
export class AuthorizationResourcesController {
  constructor(private readonly resources: ListAuthorizationResources) {}

  @Get()
  @RequireManagementPermissions('system:role:list')
  @ApiOperation({
    summary: 'List the registered resources consumed by data-scope guards',
  })
  @ApiOkResponse({ type: AuthorizationResourceVO, isArray: true })
  list() {
    return this.resources.execute();
  }
}
