import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../../shared/persistence/prisma.service.js';
import type { RagEvidenceSnapshot } from '../application/ports/rag-evidence-validator.js';
import { PrismaRagEvidenceValidator } from './prisma-rag-evidence-validator.js';

const source: RagEvidenceSnapshot = {
  chunkId: '91',
  sourceKey: 'resort:7',
  sourceType: 'resort',
  sourceId: 7,
  title: 'Exact title',
  chunkIndex: 0,
  content: 'Exact evidence',
};
function fixture(count: number = 1) {
  const query = vi.fn().mockResolvedValue([{ count }]);
  return {
    query,
    validator: new PrismaRagEvidenceValidator({
      $queryRaw: query,
    } as unknown as PrismaService),
  };
}
describe('Prisma RAG evidence validator', () => {
  it('checks exact evidence and the same authoritative visibility predicate in one parameterized query', async () => {
    const { query, validator } = fixture();
    const payload = {
      ...source,
      content: "reference'; DROP TABLE example; --",
    };
    await expect(
      validator.areCurrent([payload], 'fixture-model'),
    ).resolves.toBe(true);
    const sql = query.mock.calls[0]![0] as { sql: string; values: unknown[] };
    expect(sql.sql).not.toContain(payload.content);
    expect(sql.sql).not.toContain('fixture-model');
    expect(sql.values).toEqual(
      expect.arrayContaining([
        91n,
        payload.content,
        payload.title,
        payload.sourceKey,
        payload.sourceType,
        payload.sourceId,
        0,
        'fixture-model',
      ]),
    );
    expect(sql.sql).toContain('document."Status" = \'indexed\'');
    expect(sql.sql).toContain('document."ManualDisabled" = false');
    expect(sql.sql).toContain('chunk."EmbeddingModel" =');
    expect(sql.sql).toContain('chunk."ChunkContent" =');
    expect(sql.sql).toContain('document."SourceId" IS NOT DISTINCT FROM');
    expect(sql.sql).toContain('document."Metadata"->\'sourceState\'');
    for (const table of [
      'SkiResort',
      'Article',
      'ProjectKnowledge',
      'Dynamic',
      'DictionaryItem',
      'DictionaryType',
      'CustomFieldDefinition',
      'CustomFieldGroup',
    ])
      expect(sql.sql).toContain(`"${table}"`);
    expect(sql.sql).not.toContain('Embedding" <=>');
  });
  it('does not query when there are no cited sources', async () => {
    const { query, validator } = fixture();
    await expect(validator.areCurrent([], '')).resolves.toBe(true);
    expect(query).not.toHaveBeenCalled();
  });
  it('requires every distinct selected chunk, rather than any matching source', async () => {
    const { query, validator } = fixture();
    const second = { ...source, chunkId: '92', chunkIndex: 1 };
    await expect(validator.areCurrent([source, second], 'model')).resolves.toBe(
      false,
    );
    query.mockResolvedValue([{ count: 2 }]);
    await expect(validator.areCurrent([source, second], 'model')).resolves.toBe(
      true,
    );
    query.mockResolvedValue([]);
    await expect(validator.areCurrent([source], 'model')).resolves.toBe(false);
  });
  it.each(['0', '-1', '1 OR 1=1', '1.5', '01', '9223372036854775808'])(
    'rejects unsafe chunk id %s before PostgreSQL',
    async (chunkId) => {
      const { query, validator } = fixture();
      await expect(
        validator.areCurrent([{ ...source, chunkId }], 'model'),
      ).rejects.toThrow('Invalid RAG evidence');
      expect(query).not.toHaveBeenCalled();
    },
  );
  it('rejects duplicate chunks, excessive evidence or an empty embedding model', async () => {
    const { query, validator } = fixture();
    for (const [sources, model] of [
      [[source, source], 'model'],
      [
        Array.from({ length: 6 }, (_, index) => ({
          ...source,
          chunkId: String(index + 1),
        })),
        'model',
      ],
      [[source], ' '],
    ] as const) {
      await expect(validator.areCurrent(sources, model)).rejects.toThrow(
        'Invalid RAG evidence',
      );
    }
    expect(query).not.toHaveBeenCalled();
  });
  it('does not treat database failures as current evidence', async () => {
    const { query, validator } = fixture();
    query.mockRejectedValue(new Error('evidence database unavailable'));
    await expect(validator.areCurrent([source], 'model')).rejects.toThrow(
      'evidence database unavailable',
    );
  });
});
