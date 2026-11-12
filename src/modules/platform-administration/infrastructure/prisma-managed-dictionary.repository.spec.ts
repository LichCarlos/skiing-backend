import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';
import { PrismaManagedDictionaryRepository } from './prisma-managed-dictionary.repository.js';

function setup() {
  const tx = {
    dictionaryType: {
      findUnique: vi.fn().mockResolvedValue({ Status: 'active' }),
    },
    dictionaryItem: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({
        ItemId: 14,
        DictType: 'skill',
        ParentId: null,
        Label: '犁式制动',
        Value: 'wedge_braking',
        Color: null,
        SortOrder: 0,
        IsDefault: false,
        Status: 'active',
      }),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue({
        UserId: 3,
        Account: 'admin',
        Status: 'active',
        MerchantProfile: null,
        UserRoles: [
          {
            Role: {
              RoleKey: 'dictionary_editor',
              Status: 'active',
              DataScope: 'all',
              DataScopes: [],
              RolePermissions: [
                'management:portal:enter',
                'system:dict:create',
              ].map((PermissionKey) => ({
                Permission: { PermissionKey, Status: 'active' },
              })),
            },
          },
        ],
      }),
    },
    operationLog: { create: vi.fn().mockResolvedValue({}) },
    outboxEvent: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };
  return {
    repository: new PrismaManagedDictionaryRepository(
      prisma as unknown as PrismaService,
    ),
    prisma,
    tx,
  };
}

describe('PrismaManagedDictionaryRepository RAG events', () => {
  it('writes the dictionary change outbox row in the item creation transaction', async () => {
    const { repository, prisma, tx } = setup();
    await repository.createItem({
      dictType: 'skill',
      item: {
        label: '犁式制动',
        value: 'wedge_braking',
        parentId: null,
        color: null,
        sortOrder: 0,
        isDefault: false,
      },
      audit: {
        actorUserId: 3,
        traceId: 'trace-1',
        clientIp: '127.0.0.1',
        userAgent: 'test-agent',
      },
    });

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
    expect(tx.outboxEvent.create).toHaveBeenCalledWith({
      data: {
        EventType: 'dictionary.changed.v1',
        AggregateType: 'DictionaryItem',
        AggregateId: 'skill:14',
        Payload: { dictType: 'skill', itemId: 14 },
      },
    });
  });
});
