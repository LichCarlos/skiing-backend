import { Inject, Injectable } from '@nestjs/common';
import {
  PERMISSION_TREE_READER,
  type PermissionTreeReader,
} from './ports/permission-tree-reader.js';
import {
  buildPermissionTree,
  type PermissionNode,
} from '../domain/permission-tree.js';

@Injectable()
export class GetPermissionTree {
  constructor(
    @Inject(PERMISSION_TREE_READER)
    private readonly permissions: PermissionTreeReader,
  ) {}

  async execute(): Promise<PermissionNode[]> {
    return buildPermissionTree(await this.permissions.findActivePermissions());
  }
}
