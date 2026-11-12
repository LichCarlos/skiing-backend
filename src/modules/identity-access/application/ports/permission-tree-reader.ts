import type { PermissionTreeRecord } from '../../domain/permission-tree.js';

export const PERMISSION_TREE_READER = Symbol('PERMISSION_TREE_READER');

export interface PermissionTreeReader {
  findActivePermissions(): Promise<readonly PermissionTreeRecord[]>;
}
