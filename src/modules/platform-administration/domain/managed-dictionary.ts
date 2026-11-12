import { validateDictionaryParent } from './dictionary-tree.js';

export const DICTIONARY_STATUSES = ['active', 'disabled'] as const;
export type DictionaryStatus = (typeof DICTIONARY_STATUSES)[number];

export interface DictionaryItemNode {
  itemId: number;
  dictType: string;
  parentId: number | null;
}

export interface DictionaryItem {
  itemId: number;
  parentId: number | null;
  label: string;
  value: string;
  color: string | null;
  sortOrder: number;
  isDefault: boolean;
  status: DictionaryStatus;
  children: DictionaryItem[];
}

export interface ManagedDictionary {
  dictType: string;
  dictName: string;
  groupKey: string;
  status: DictionaryStatus;
  publiclyReadable: boolean;
  items: DictionaryItem[];
}

export interface DictionaryAuditContext {
  actorUserId: number;
  traceId: string;
  clientIp: string | null;
  userAgent: string | null;
}

export function validateDictionaryType(input: {
  dictType: string;
  dictName: string;
  groupKey: string;
}): string[] {
  const issues: string[] = [];
  if (!/^[a-z][a-z0-9._:-]{0,99}$/.test(input.dictType))
    issues.push('invalid_dict_type');
  if (!input.dictName.trim() || input.dictName.trim().length > 100)
    issues.push('invalid_dict_name');
  if (!/^[a-z][a-z0-9._:-]{0,99}$/.test(input.groupKey))
    issues.push('invalid_group_key');
  return issues;
}

export function validateDictionaryTypePatch(input: {
  dictName?: string;
  groupKey?: string;
  status?: DictionaryStatus;
}): string[] {
  const issues: string[] = [];
  if (
    input.dictName !== undefined &&
    (!input.dictName.trim() || input.dictName.trim().length > 100)
  )
    issues.push('invalid_dict_name');
  if (
    input.groupKey !== undefined &&
    !/^[a-z][a-z0-9._:-]{0,99}$/.test(input.groupKey)
  )
    issues.push('invalid_group_key');
  if (input.status !== undefined && !DICTIONARY_STATUSES.includes(input.status))
    issues.push('invalid_status');
  return issues;
}

export function validateDictionaryItem(input: {
  label?: string;
  value?: string;
  color?: string | null;
  sortOrder?: number;
}): string[] {
  const issues: string[] = [];
  if (
    input.label !== undefined &&
    (!input.label.trim() || input.label.trim().length > 100)
  )
    issues.push('invalid_label');
  if (
    input.value !== undefined &&
    (!input.value.trim() || input.value.trim().length > 100)
  )
    issues.push('invalid_value');
  if (input.color != null && input.color.length > 20)
    issues.push('invalid_color');
  if (input.sortOrder !== undefined && !Number.isSafeInteger(input.sortOrder))
    issues.push('invalid_sort_order');
  return issues;
}

export function validateDictionaryItemParent(input: {
  dictType: string;
  itemId: number | null;
  parentId: number | null;
  nodes: readonly DictionaryItemNode[];
}): string | null {
  return validateDictionaryParent(input);
}

export function buildDictionaryTree(
  rows: readonly Omit<DictionaryItem, 'children'>[],
): DictionaryItem[] {
  const nodes = new Map<number, DictionaryItem>();
  for (const row of rows) nodes.set(row.itemId, { ...row, children: [] });
  const roots: DictionaryItem[] = [];
  for (const node of nodes.values()) {
    const parent =
      node.parentId === null ? undefined : nodes.get(node.parentId);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sort = (items: DictionaryItem[]) => {
    items.sort((a, b) => a.sortOrder - b.sortOrder || a.itemId - b.itemId);
    for (const item of items) sort(item.children);
  };
  sort(roots);
  return roots;
}
