import { describe, expect, it } from 'vitest';
import {
  validateDictionaryParent,
  type DictionaryTreeNode,
} from './dictionary-tree.js';

const nodes: DictionaryTreeNode[] = [
  { itemId: 1, dictType: 'resort.fit_tag', parentId: null },
  { itemId: 2, dictType: 'resort.fit_tag', parentId: 1 },
  { itemId: 3, dictType: 'resort.fit_tag', parentId: 2 },
  { itemId: 4, dictType: 'article.category', parentId: null },
];

describe('validateDictionaryParent', () => {
  it('allows roots and a parent in the same dictionary', () => {
    expect(
      validateDictionaryParent({
        dictType: 'resort.fit_tag',
        itemId: null,
        parentId: null,
        nodes,
      }),
    ).toBeNull();
    expect(
      validateDictionaryParent({
        dictType: 'resort.fit_tag',
        itemId: 3,
        parentId: 1,
        nodes,
      }),
    ).toBeNull();
  });

  it('rejects self-parent and moving a node below its descendant', () => {
    expect(
      validateDictionaryParent({
        dictType: 'resort.fit_tag',
        itemId: 2,
        parentId: 2,
        nodes,
      }),
    ).toBe('self_parent');
    expect(
      validateDictionaryParent({
        dictType: 'resort.fit_tag',
        itemId: 2,
        parentId: 3,
        nodes,
      }),
    ).toBe('ancestor_cycle');
  });

  it('rejects missing or cross-dictionary parents', () => {
    expect(
      validateDictionaryParent({
        dictType: 'resort.fit_tag',
        itemId: null,
        parentId: 999,
        nodes,
      }),
    ).toBe('parent_not_found');
    expect(
      validateDictionaryParent({
        dictType: 'resort.fit_tag',
        itemId: null,
        parentId: 4,
        nodes,
      }),
    ).toBe('parent_wrong_type');
  });

  it('fails closed when the existing ancestor chain is corrupt', () => {
    const corrupt: DictionaryTreeNode[] = [
      { itemId: 1, dictType: 'resort.fit_tag', parentId: 2 },
      { itemId: 2, dictType: 'resort.fit_tag', parentId: 1 },
    ];
    expect(
      validateDictionaryParent({
        dictType: 'resort.fit_tag',
        itemId: null,
        parentId: 1,
        nodes: corrupt,
      }),
    ).toBe('ancestor_cycle');
  });
});
