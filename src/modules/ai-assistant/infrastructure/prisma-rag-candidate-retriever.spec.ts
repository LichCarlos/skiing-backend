import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';
import type { RagRetrievalQuery } from '../application/ports/rag-candidate-retriever.js';
import { PrismaRagCandidateRetriever } from './prisma-rag-candidate-retriever.js';

const query: RagRetrievalQuery = {
  embedding: Array.from({ length: 1024 }, (_, index) => index / 1024),
  embeddingModel: 'BAAI/bge-m3',
  limit: 5,
};

describe('PrismaRagCandidateRetriever', () => {
  it('parameterizes the vector/model/limit and applies indexed scope filters in SQL', async () => {
    const rows = [
      {
        chunkId: '91',
        sourceKey: 'resort:42',
        sourceType: 'resort',
        sourceId: 42,
        title: 'North Ridge',
        chunkIndex: 2,
        content: 'A public resort source excerpt.',
        similarity: 0.87,
      },
    ];
    const queryRaw = vi.fn().mockResolvedValue(rows);
    const prisma = { $queryRaw: queryRaw } as unknown as PrismaService;
    const repository = new PrismaRagCandidateRetriever(prisma);

    await expect(
      repository.search(query, {
        public: true,
        merchant: { kind: 'selected', merchantId: 23 },
        admin: false,
      }),
    ).resolves.toEqual(rows);

    const statement = queryRaw.mock.calls[0]?.[0] as {
      sql: string;
      values: unknown[];
    };
    expect(statement.sql).toContain('document."Status" = \'indexed\'');
    expect(statement.sql).toContain('chunk."Embedding" <=>');
    expect(statement.sql).toContain('document."AccessScope" = \'public\'');
    expect(statement.sql).toContain('document."AccessScope" = \'merchant\'');
    expect(statement.sql).toContain('document."MerchantId" =');
    expect(statement.sql).toContain('document."AccessScope" = \'admin\'');
    expect(statement.sql).not.toContain('BAAI/bge-m3');
    expect(statement.values).toContain('BAAI/bge-m3');
    expect(statement.values).toContain(23);
    expect(statement.values).toContain(5);
    expect(statement.values).toContain(`[${query.embedding.join(',')}]`);
    // Structural guard only: real SQL semantics are exercised by test:db.
    expect(statement.sql).toContain('document."Metadata"->\'sourceState\'');
    for (const table of [
      'SkiResort',
      'Article',
      'ProjectKnowledge',
      'Dynamic',
      'DictionaryItem',
      'DictionaryType',
      'CustomFieldDefinition',
      'CustomFieldGroup',
    ]) {
      expect(statement.sql).toContain(`"${table}"`);
    }
    expect(statement.sql.indexOf('WITH RECURSIVE ancestry')).toBeLessThan(
      statement.sql.indexOf('ORDER BY chunk."Embedding"'),
    );
    expect(statement.sql).toContain('author."Status" = \'active\'');
    expect(statement.sql).toContain('f."IsPublic"=true');
    expect(statement.sql).toContain('g."Status"=\'active\'');
    expect(statement.sql).toContain(
      'category."DictType" = \'knowledge.article_category\'',
    );
    expect(statement.sql).toContain('category_type."PubliclyReadable" = true');
    expect(statement.sql).toContain('a."PublishTime" IS NOT NULL');
    expect(statement.sql).toContain('p."PublishTime" IS NOT NULL');
  });

  it('does not access PostgreSQL when the resolved scope has no visible sources', async () => {
    const queryRaw = vi.fn();
    const prisma = { $queryRaw: queryRaw } as unknown as PrismaService;
    const repository = new PrismaRagCandidateRetriever(prisma);

    await expect(
      repository.search(query, {
        public: false,
        merchant: { kind: 'none' },
        admin: false,
      }),
    ).resolves.toEqual([]);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('rejects dimension, non-finite, model and limit errors before querying', async () => {
    const queryRaw = vi.fn();
    const prisma = { $queryRaw: queryRaw } as unknown as PrismaService;
    const repository = new PrismaRagCandidateRetriever(prisma);
    const publicAccess = {
      public: true,
      merchant: { kind: 'none' } as const,
      admin: false,
    };

    await expect(
      repository.search({ ...query, embedding: [0] }, publicAccess),
    ).rejects.toThrow('1024 finite numbers');
    await expect(
      repository.search(
        {
          ...query,
          embedding: query.embedding.map((value, index) =>
            index === 0 ? Number.NaN : value,
          ),
        },
        publicAccess,
      ),
    ).rejects.toThrow('1024 finite numbers');
    await expect(
      repository.search({ ...query, embeddingModel: '  ' }, publicAccess),
    ).rejects.toThrow('embedding model must not be empty');
    await expect(
      repository.search({ ...query, limit: 0 }, publicAccess),
    ).rejects.toThrow('limit must be a positive integer');
    expect(queryRaw).not.toHaveBeenCalled();
  });
});
