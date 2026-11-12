import type {
  DictionaryAuditContext,
  DictionaryItem,
  DictionaryStatus,
  ManagedDictionary,
} from '../../domain/managed-dictionary.js';

export const MANAGED_DICTIONARY_REPOSITORY = Symbol(
  'MANAGED_DICTIONARY_REPOSITORY',
);

export interface DictionaryTypeFilter {
  groupKey?: string;
  status?: DictionaryStatus;
  skip: number;
  take: number;
}

export interface DictionaryTypePatch {
  dictName?: string;
  groupKey?: string;
  status?: DictionaryStatus;
  publiclyReadable?: boolean;
}

export interface DictionaryItemInput {
  label: string;
  value: string;
  parentId: number | null;
  color: string | null;
  sortOrder: number;
  isDefault: boolean;
}

export interface DictionaryItemPatch {
  label?: string;
  value?: string;
  parentId?: number | null;
  color?: string | null;
  sortOrder?: number;
  isDefault?: boolean;
  status?: DictionaryStatus;
}

export interface ManagedDictionaryRepository {
  listTypes(filter: DictionaryTypeFilter): Promise<{
    items: ManagedDictionary[];
    total: number;
  }>;
  findType(dictType: string): Promise<ManagedDictionary | null>;
  createType(input: {
    dictType: string;
    dictName: string;
    groupKey: string;
    publiclyReadable: boolean;
    audit: DictionaryAuditContext;
  }): Promise<ManagedDictionary>;
  updateType(input: {
    dictType: string;
    patch: DictionaryTypePatch;
    audit: DictionaryAuditContext;
  }): Promise<ManagedDictionary | null>;
  disableType(input: {
    dictType: string;
    audit: DictionaryAuditContext;
  }): Promise<boolean>;
  createItem(input: {
    dictType: string;
    item: DictionaryItemInput;
    audit: DictionaryAuditContext;
  }): Promise<DictionaryItem | null>;
  updateItem(input: {
    dictType: string;
    itemId: number;
    patch: DictionaryItemPatch;
    audit: DictionaryAuditContext;
  }): Promise<DictionaryItem | null>;
  disableItem(input: {
    dictType: string;
    itemId: number;
    audit: DictionaryAuditContext;
  }): Promise<boolean>;
}
