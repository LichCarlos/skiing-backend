import type { PermissionDefinition, PermissionType } from './permissions.js';
import { SYSTEM_PERMISSION_DEFINITIONS } from './permissions.js';

export type PermissionStatus = 'active' | 'disabled';
export type PermissionSource = 'code' | 'custom';
export type EditablePermissionType = 'directory' | 'menu' | 'button';

export interface PermissionCatalogRecord {
  permissionId: number;
  parentId: number | null;
  permissionKey: string;
  permissionName: string;
  permissionType: PermissionType;
  source: PermissionSource;
  route: string | null;
  icon: string | null;
  sortOrder: number;
  visible: boolean;
  status: PermissionStatus;
  children: PermissionCatalogRecord[];
}

export interface PermissionCatalogRow {
  permissionId: number;
  parentId: number | null;
  permissionKey: string;
  permissionName: string;
  permissionType: string;
  route: string | null;
  icon: string | null;
  sortOrder: number;
  visible: boolean;
  status: string;
}

export interface PermissionCatalogAuditContext {
  actorUserId: number;
  traceId: string;
  clientIp: string | null;
  userAgent: string | null;
}

export interface PermissionCatalogInput {
  permissionKey: string;
  parentId: number | null;
  permissionName: string;
  permissionType: EditablePermissionType;
  route: string | null;
  icon: string | null;
  sortOrder: number;
  visible: boolean;
}

export interface PermissionCatalogPatch {
  parentId?: number | null;
  permissionName?: string;
  route?: string | null;
  icon?: string | null;
  sortOrder?: number;
  visible?: boolean;
  status?: PermissionStatus;
}

export const permissionDefinitions = SYSTEM_PERMISSION_DEFINITIONS;

const codeKeys = new Set(permissionDefinitions.map(({ key }) => key));

export function permissionSource(key: string): PermissionSource {
  return codeKeys.has(key) ? 'code' : 'custom';
}

export function buildPermissionCatalog(
  rows: readonly PermissionCatalogRow[],
): PermissionCatalogRecord[] {
  const nodes = new Map<number, PermissionCatalogRecord>();
  for (const row of rows) {
    if (!isPermissionType(row.permissionType)) {
      throw new Error(`Unsupported permission type: ${row.permissionType}`);
    }
    if (row.status !== 'active' && row.status !== 'disabled') {
      throw new Error(`Unsupported permission status: ${row.status}`);
    }
    if (nodes.has(row.permissionId)) {
      throw new Error(`Duplicate permission ID: ${row.permissionId}`);
    }
    nodes.set(row.permissionId, {
      ...row,
      permissionType: row.permissionType,
      status: row.status,
      source: permissionSource(row.permissionKey),
      children: [],
    });
  }

  const roots: PermissionCatalogRecord[] = [];
  for (const row of rows) {
    const node = nodes.get(row.permissionId)!;
    if (row.parentId === null) {
      roots.push(node);
      continue;
    }
    const parent = nodes.get(row.parentId);
    if (!parent) throw new Error(`Missing permission parent: ${row.parentId}`);
    parent.children.push(node);
  }

  const order = (items: PermissionCatalogRecord[]) => {
    items.sort(
      (left, right) =>
        left.sortOrder - right.sortOrder ||
        left.permissionId - right.permissionId,
    );
    for (const item of items) order(item.children);
  };
  order(roots);
  const visited = new Set<number>();
  const pending = [...roots];
  while (pending.length) {
    const node = pending.pop()!;
    if (visited.has(node.permissionId))
      throw new Error(`Permission tree cycle at ID: ${node.permissionId}`);
    visited.add(node.permissionId);
    pending.push(...node.children);
  }
  if (visited.size !== nodes.size)
    throw new Error('Permission tree contains a cycle without a root');
  return roots;
}

export function registeredApiPermissions(): PermissionDefinition[] {
  return permissionDefinitions.filter(({ type }) => type === 'api');
}

function isPermissionType(value: string): value is PermissionType {
  return ['directory', 'menu', 'button', 'api'].includes(value);
}
