import { describe, expect, it, vi } from 'vitest';
import { ManageDictionaries } from './manage-dictionaries.js';
import { ManagementWriteAuthorizationError } from '../../identity-access/domain/management-write-authorization.js';
import type { ManagedDictionaryRepository } from './ports/managed-dictionary-repository.js';
import type {
  ManagedDictionary,
  DictionaryItem,
} from '../domain/managed-dictionary.js';

const audit = {
  actorUserId: 7,
  traceId: 'trace-dict',
  clientIp: null,
  userAgent: null,
};

function setup() {
  const listTypes = vi.fn(async () => ({ items: [], total: 0 }));
  const createType = vi.fn(
    async (input: {
      dictType: string;
      dictName: string;
      groupKey: string;
      publiclyReadable: boolean;
      audit: typeof audit;
    }) => ({
      dictType: input.dictType,
      dictName: input.dictName,
      groupKey: input.groupKey,
      publiclyReadable: input.publiclyReadable,
      status: 'active' as const,
      items: [],
    }),
  );
  const createItem = vi.fn(async () => null);
  const findType = vi.fn<ManagedDictionaryRepository['findType']>(
    async () => null,
  );
  const updateItem = vi.fn<ManagedDictionaryRepository['updateItem']>(
    async () => null,
  );
  const disableItem = vi.fn<ManagedDictionaryRepository['disableItem']>(
    async () => true,
  );
  const repository: ManagedDictionaryRepository = {
    listTypes,
    findType,
    createType,
    updateType: vi.fn(async () => null),
    disableType: vi.fn(async () => true),
    createItem,
    updateItem,
    disableItem,
  };
  return {
    repository,
    service: new ManageDictionaries(repository),
    mocks: {
      listTypes,
      createType,
      createItem,
      findType,
      updateItem,
      disableItem,
    },
  };
}

describe('ManageDictionaries', () => {
  it('maps transaction authorization errors to 403', async () => {
    const { service, mocks } = setup();
    mocks.createType.mockRejectedValueOnce(
      new ManagementWriteAuthorizationError(
        'Management write permission is unavailable',
      ),
    );
    await expect(
      service.createType({
        dictType: 'test',
        dictName: 'Test',
        groupKey: 'test',
        audit,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
  const node = (
    itemId: number,
    children: DictionaryItem[] = [],
  ): DictionaryItem => ({
    itemId,
    parentId: null,
    label: 'Label',
    value: String(itemId),
    color: null,
    sortOrder: 0,
    isDefault: false,
    status: 'active',
    children,
  });
  const dictionary: ManagedDictionary = {
    dictType: 'area',
    dictName: 'Area',
    groupKey: 'location',
    status: 'active',
    publiclyReadable: false,
    items: [node(1, [node(2, [node(3)])]), node(4)],
  };

  it('reads a nested item with its subtree, not siblings or other roots', async () => {
    const { mocks, service } = setup();
    mocks.findType.mockResolvedValue(dictionary);
    expect(await service.getItem('area', 2)).toEqual(
      dictionary.items[0].children[0],
    );
    expect(mocks.findType).toHaveBeenCalledWith('area');
  });
  it('returns 404 for a missing type', async () => {
    const { service } = setup();
    await expect(service.getItem('missing', 1)).rejects.toMatchObject({
      status: 404,
    });
  });
  it('returns 404 when the ID does not belong to the requested type', async () => {
    const { mocks, service } = setup();
    mocks.findType.mockResolvedValue(dictionary);
    await expect(service.getItem('area', 99)).rejects.toMatchObject({
      status: 404,
    });
  });
  it.each([0, -1, 1.5, 2147483648, Number.MAX_SAFE_INTEGER, Infinity, NaN])(
    'rejects invalid item ID %s before persistence on read, update and disable',
    async (itemId) => {
      const { mocks, service } = setup();
      await expect(service.getItem('area', itemId)).rejects.toMatchObject({
        status: 400,
      });
      await expect(
        service.updateItem({ dictType: 'area', itemId, patch: {}, audit }),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        service.disableItem({ dictType: 'area', itemId, audit }),
      ).rejects.toMatchObject({ status: 400 });
      expect(mocks.findType).not.toHaveBeenCalled();
      expect(mocks.updateItem).not.toHaveBeenCalled();
      expect(mocks.disableItem).not.toHaveBeenCalled();
    },
  );
  it('validates pagination and computes offset page metadata', async () => {
    const { service, mocks } = setup();
    await expect(
      service.listTypes({ page: 0, pageSize: 20 }),
    ).rejects.toThrow();
    await service.listTypes({ page: 2, pageSize: 10, groupKey: ' area ' });
    expect(mocks.listTypes).toHaveBeenCalledWith({
      skip: 10,
      take: 10,
      groupKey: 'area',
    });
  });

  it('defaults dictionaries to private and trims their display name', async () => {
    const { service, mocks } = setup();
    await service.createType({
      dictType: 'area',
      dictName: ' Area ',
      groupKey: 'location',
      audit,
    });
    expect(mocks.createType).toHaveBeenCalledWith(
      expect.objectContaining({
        dictName: 'Area',
        publiclyReadable: false,
      }),
    );
  });

  it('rejects invalid tree items before reaching persistence', async () => {
    const { service, mocks } = setup();
    await expect(
      service.createItem({
        dictType: 'area',
        item: {
          label: ' ',
          value: 'x',
          parentId: null,
          color: null,
          sortOrder: 0,
          isDefault: false,
        },
        audit,
      }),
    ).rejects.toThrow();
    expect(mocks.createItem).not.toHaveBeenCalled();
  });
});
