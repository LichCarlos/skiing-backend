import { describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { EmbeddingProvider } from './ports/embedding-provider.js';
import type {
  RagDocumentWriter,
  RagIndexDocument,
} from './ports/rag-document-writer.js';
import { RagDocumentIndexingService } from './rag-document-indexing.service.js';

const claim = {
  kind: 'claimed',
  ragDocumentId: 1,
  controlVersion: 1,
  indexGeneration: 1n,
} as const;

const vector = Array.from({ length: 1024 }, (_, index) => index / 1024);

const document: RagIndexDocument = {
  sourceKey: 'resort:21',
  sourceType: 'resort',
  sourceId: 21,
  title: 'Ridge Resort',
  content: 'The beginner area opens at 09:00.\r\nLifts close at 16:00.',
  accessScope: 'public',
  merchantId: null,
  sourceUpdatedAt: new Date('2026-10-27T00:00:00.000Z'),
};

function setup() {
  const settings = { EMBEDDING_MODEL: 'BAAI/bge-m3' };
  const config = {
    get: (key: string) => settings[key as keyof typeof settings],
  } as unknown as ConfigService;
  const embed = vi.fn(async (texts: readonly string[]) =>
    texts.map(() => vector),
  );
  const embeddings = { embed } satisfies EmbeddingProvider;
  const writer = {
    beginIndexing: vi
      .fn<NonNullable<RagDocumentWriter['beginIndexing']>>()
      .mockResolvedValue(claim),
    isCurrentCommand: vi.fn().mockResolvedValue(true),
    replaceChunksAndMarkIndexed: vi.fn().mockResolvedValue(true),
    markFailed: vi.fn().mockResolvedValue(true),
    disable: vi.fn().mockResolvedValue(true),
  } satisfies RagDocumentWriter;

  return {
    service: new RagDocumentIndexingService(config, embeddings, writer),
    embed,
    writer,
  };
}

describe('RagDocumentIndexingService', () => {
  it('embeds normalized chunks and atomically requests indexed replacement', async () => {
    const { service, embed, writer } = setup();
    const signal = new AbortController().signal;

    const result = await service.index(document, signal);

    expect(result).toMatchObject({ chunkCount: 1, skipped: false });
    expect(result.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(writer.beginIndexing).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'The beginner area opens at 09:00.\nLifts close at 16:00.',
      }),
      result.contentHash,
      'BAAI/bge-m3',
      1,
      {},
    );
    expect(embed).toHaveBeenCalledWith(
      ['The beginner area opens at 09:00.\nLifts close at 16:00.'],
      signal,
    );
    expect(writer.replaceChunksAndMarkIndexed).toHaveBeenCalledWith(
      document.sourceKey,
      result.contentHash,
      'BAAI/bge-m3',
      claim,
      [
        {
          index: 0,
          content: 'The beginner area opens at 09:00.\nLifts close at 16:00.',
          embedding: vector,
        },
      ],
    );
  });

  it('skips re-embedding when the same source hash and model are already indexed', async () => {
    const { service, embed, writer } = setup();

    const first = await service.index(document);
    writer.beginIndexing.mockResolvedValueOnce({ kind: 'skip' });
    const equivalent = await service.index({
      ...document,
      content: document.content.replace(/\r\n/g, '\n'),
    });

    expect(equivalent.contentHash).toBe(first.contentHash);
    expect(equivalent.skipped).toBe(true);
    expect(embed).toHaveBeenCalledOnce();
    expect(writer.beginIndexing).toHaveBeenCalledTimes(2);
  });

  it('marks a pending document failed if embedding or replacement fails', async () => {
    const { service, writer } = setup();
    writer.replaceChunksAndMarkIndexed.mockRejectedValueOnce(
      new Error('database unavailable'),
    );

    await expect(service.index(document)).rejects.toThrow(
      'database unavailable',
    );
    expect(writer.markFailed).toHaveBeenCalledWith(
      document.sourceKey,
      expect.stringMatching(/^[0-9a-f]{64}$/),
      claim,
      'index_commit_failed',
    );
  });

  it('includes the source dependency snapshot in indexing identity even with unchanged rendered text', async () => {
    const { service } = setup();
    const first = await service.index({
      ...document,
      sourceState: { v: 1, fields: [] },
    });
    const second = await service.index({
      ...document,
      sourceState: { v: 1, fields: ['changed'] },
    });
    expect(first.contentHash).not.toBe(second.contentHash);
  });

  it('rejects inconsistent merchant scope before writing', async () => {
    const { service, writer } = setup();

    await expect(
      service.index({ ...document, accessScope: 'merchant', merchantId: null }),
    ).rejects.toThrow(
      'Merchant-scoped RAG sources require a valid merchant ID',
    );
    expect(writer.beginIndexing).not.toHaveBeenCalled();
  });

  it('rejects source types or access scopes outside the persistence allowlists', async () => {
    const { service, writer } = setup();

    await expect(
      service.index({
        ...document,
        sourceType: 'unknown' as RagIndexDocument['sourceType'],
      }),
    ).rejects.toThrow('RAG source type is not supported');
    await expect(
      service.index({
        ...document,
        accessScope: 'private' as RagIndexDocument['accessScope'],
      }),
    ).rejects.toThrow('RAG access scope is not supported');
    expect(writer.beginIndexing).not.toHaveBeenCalled();
  });

  it('rejects invalid provider vectors and records failed indexing state', async () => {
    const { service, embed, writer } = setup();
    embed.mockResolvedValueOnce([[Number.NaN]]);

    await expect(service.index(document)).rejects.toThrow(
      'Embedding provider returned an invalid vector',
    );
    expect(writer.replaceChunksAndMarkIndexed).not.toHaveBeenCalled();
    expect(writer.markFailed).toHaveBeenCalledOnce();
  });
});
