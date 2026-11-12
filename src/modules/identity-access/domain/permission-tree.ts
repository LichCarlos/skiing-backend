const PERMISSION_TYPES = ['directory', 'menu', 'button', 'api'] as const;

export type PermissionType = (typeof PERMISSION_TYPES)[number];

export interface PermissionTreeRecord {
  permissionId: number;
  parentId: number | null;
  permissionKey: string;
  permissionName: string;
  permissionType: string;
  route: string | null;
  icon: string | null;
  sortOrder: number;
}

export interface PermissionNode {
  permissionId: number;
  parentId: number | null;
  permissionKey: string;
  permissionName: string;
  permissionType: PermissionType;
  route: string | null;
  icon: string | null;
  children: PermissionNode[];
}

export function buildPermissionTree(
  records: readonly PermissionTreeRecord[],
): PermissionNode[] {
  const nodes = new Map<number, PermissionNode>();
  const ordered = [...records].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder ||
      left.permissionId - right.permissionId,
  );

  for (const record of ordered) {
    if (nodes.has(record.permissionId)) {
      throw new Error(`Duplicate permission ID: ${record.permissionId}`);
    }
    if (!isPermissionType(record.permissionType)) {
      throw new Error(`Unsupported permission type: ${record.permissionType}`);
    }

    nodes.set(record.permissionId, {
      permissionId: record.permissionId,
      parentId: record.parentId,
      permissionKey: record.permissionKey,
      permissionName: record.permissionName,
      permissionType: record.permissionType,
      route: record.route,
      icon: record.icon,
      children: [],
    });
  }

  const roots: PermissionNode[] = [];
  for (const record of ordered) {
    const node = nodes.get(record.permissionId)!;
    if (record.parentId === null) {
      roots.push(node);
      continue;
    }

    const parent = nodes.get(record.parentId);
    if (!parent) {
      throw new Error(`Missing permission parent: ${record.parentId}`);
    }
    parent.children.push(node);
  }

  const visited = new Set<number>();
  const pending = [...roots];
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (visited.has(node.permissionId)) {
      throw new Error(`Permission tree cycle at ID: ${node.permissionId}`);
    }
    visited.add(node.permissionId);
    pending.push(...node.children);
  }
  if (visited.size !== nodes.size) {
    throw new Error('Permission tree contains a cycle without a root');
  }

  return roots;
}

function isPermissionType(value: string): value is PermissionType {
  return PERMISSION_TYPES.some((type) => type === value);
}
