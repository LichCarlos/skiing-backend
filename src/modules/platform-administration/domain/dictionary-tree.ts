export interface DictionaryTreeNode {
  itemId: number;
  dictType: string;
  parentId: number | null;
}

export type DictionaryParentIssue =
  | 'invalid_item_id'
  | 'self_parent'
  | 'parent_not_found'
  | 'parent_wrong_type'
  | 'ancestor_cycle';

export function validateDictionaryParent(input: {
  dictType: string;
  itemId: number | null;
  parentId: number | null;
  nodes: readonly DictionaryTreeNode[];
}): DictionaryParentIssue | null {
  const { dictType, itemId, parentId, nodes } = input;
  if (!dictType.trim()) return 'parent_wrong_type';
  if (itemId !== null && (!Number.isSafeInteger(itemId) || itemId < 1))
    return 'invalid_item_id';
  if (parentId === null) return null;
  if (!Number.isSafeInteger(parentId) || parentId < 1)
    return 'parent_not_found';
  if (itemId !== null && itemId === parentId) return 'self_parent';

  const byId = new Map(nodes.map((node) => [node.itemId, node]));
  const parent = byId.get(parentId);
  if (!parent) return 'parent_not_found';
  if (parent.dictType !== dictType) return 'parent_wrong_type';

  const visited = new Set<number>();
  let current: DictionaryTreeNode | undefined = parent;
  while (current) {
    if (itemId !== null && current.itemId === itemId) return 'ancestor_cycle';
    if (visited.has(current.itemId)) return 'ancestor_cycle';
    visited.add(current.itemId);
    if (current.parentId === null) break;
    current = byId.get(current.parentId);
    if (!current) return 'parent_not_found';
    if (current.dictType !== dictType) return 'parent_wrong_type';
  }
  return null;
}
