import { describe, expect, it, vi } from 'vitest';
import type { RagCandidateRetriever } from './ports/rag-candidate-retriever.js';
import { RagRetrievalService } from './rag-retrieval.service.js';

const query = {
  embedding: Array.from({ length: 1024 }, (_, index) => index / 1024),
  embeddingModel: 'BAAI/bge-m3',
  limit: 5,
};

function setup() {
  const search = vi.fn().mockResolvedValue([]);
  const candidates = { search } satisfies RagCandidateRetriever;
  return {
    service: new RagRetrievalService(candidates),
    candidates,
    search,
  };
}

describe('RagRetrievalService', () => {
  it('derives public-only scope for guests and ordinary users', async () => {
    const { service, search } = setup();
    const user = {
      userId: 7,
      active: true,
      merchantId: null,
      roles: [{ active: true, dataScope: 'self' as const, permissionKeys: [] }],
    };

    await service.search(query, null);
    await service.search(query, user);

    expect(search).toHaveBeenNthCalledWith(1, query, {
      public: true,
      merchant: { kind: 'none' },
      admin: false,
    });
    expect(search).toHaveBeenNthCalledWith(2, query, {
      public: true,
      merchant: { kind: 'none' },
      admin: false,
    });
  });

  it('derives the merchant scope from the authenticated principal', async () => {
    const { service, search } = setup();
    const merchant = {
      userId: 9,
      active: true,
      merchantId: 23,
      roles: [
        {
          active: true,
          dataScope: 'merchant' as const,
          permissionKeys: ['ai:rag:query'],
        },
      ],
    };

    await service.search(query, merchant);

    expect(search).toHaveBeenCalledWith(query, {
      public: true,
      merchant: { kind: 'selected', merchantId: 23 },
      admin: false,
    });
  });

  it('grants all retrieval scopes only to an active system administrator', async () => {
    const { service, search } = setup();
    const admin = {
      userId: 1,
      active: true,
      merchantId: null,
      roles: [
        {
          active: true,
          dataScope: 'all' as const,
          permissionKeys: ['ai:rag:query'],
        },
      ],
    };

    await service.search(query, admin);

    expect(search).toHaveBeenCalledWith(query, {
      public: true,
      merchant: { kind: 'all' },
      admin: true,
    });
  });

  it('does not query storage for an invalid authenticated principal', async () => {
    const { service, search } = setup();

    await expect(
      service.search(query, {
        userId: 0,
        active: true,
        merchantId: 23,
        roles: [
          {
            active: true,
            dataScope: 'all' as const,
            permissionKeys: ['ai:rag:query'],
          },
        ],
      }),
    ).resolves.toEqual([]);
    expect(search).not.toHaveBeenCalled();
  });
});
