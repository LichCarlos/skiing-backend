import { describe, expect, it } from 'vitest';
import {
  buildDictionaryTree,
  validateDictionaryItem,
  validateDictionaryItemParent,
  validateDictionaryType,
  validateDictionaryTypePatch,
} from './managed-dictionary.js';

describe('managed dictionary domain', () => {
  it('validates dictionary keys and normalized labels', () => {
    expect(
      validateDictionaryType({
        dictType: 'resort.fit_tag',
        dictName: '适配标签',
        groupKey: 'resort',
      }),
    ).toEqual([]);
    expect(
      validateDictionaryType({
        dictType: 'Bad Key',
        dictName: ' ',
        groupKey: '!',
      }),
    ).toEqual(['invalid_dict_type', 'invalid_dict_name', 'invalid_group_key']);
    expect(
      validateDictionaryTypePatch({ status: 'broken' as never }),
    ).toContain('invalid_status');
  });

  it('validates partial item updates without requiring untouched fields', () => {
    expect(validateDictionaryItem({ sortOrder: 5, color: null })).toEqual([]);
    expect(validateDictionaryItem({ label: '  ' })).toContain('invalid_label');
  });

  it('rejects cross-type parents, self-parenting and ancestor cycles', () => {
    const nodes = [
      { itemId: 1, dictType: 'area', parentId: null },
      { itemId: 2, dictType: 'area', parentId: 1 },
      { itemId: 3, dictType: 'other', parentId: null },
    ];
    expect(
      validateDictionaryItemParent({
        dictType: 'area',
        itemId: 1,
        parentId: 2,
        nodes,
      }),
    ).toBe('ancestor_cycle');
    expect(
      validateDictionaryItemParent({
        dictType: 'area',
        itemId: 1,
        parentId: 3,
        nodes,
      }),
    ).toBe('parent_wrong_type');
  });

  it('builds a deterministically ordered tree from flat rows', () => {
    expect(
      buildDictionaryTree([
        {
          itemId: 3,
          parentId: 1,
          label: 'child',
          value: 'c',
          color: null,
          sortOrder: 2,
          isDefault: false,
          status: 'active',
        },
        {
          itemId: 1,
          parentId: null,
          label: 'root',
          value: 'r',
          color: null,
          sortOrder: 1,
          isDefault: false,
          status: 'active',
        },
      ]),
    ).toMatchObject([{ itemId: 1, children: [{ itemId: 3 }] }]);
  });
});
