import { describe, expect, it, vi } from 'vitest';
import { parseBackfillOptions, runRagBackfill } from './rag-backfill.js';

describe('RAG authoritative backfill', () => {
  it('validates the source allowlist and bounded/resumable options', () => {
    expect(
      parseBackfillOptions([
        '--source',
        'article',
        '--after-id',
        '19',
        '--batch-size',
        '2',
      ]),
    ).toEqual({ sources: ['article'], afterId: 19, batchSize: 2 });
    for (const args of [
      ['--source', 'revenue'],
      ['--source', 'Article; DROP TABLE'],
      ['--after-id', '1'],
      ['--batch-size', '501'],
      ['--batch-size', '-1'],
      ['--after-id', '0.1'],
      ['--source'],
      ['--source', 'article', '--source', 'resort'],
      ['--unknown', '1'],
    ])
      expect(() => parseBackfillOptions(args)).toThrow();
  });

  it('pages to a fixed high-water ID and reports only successful checkpoints', async () => {
    const reader = {
      upperBound: vi.fn(async () => 6),
      page: vi.fn(async (_source, after: number) =>
        after === 2 ? [3, 5] : [6],
      ),
    };
    const replay = vi.fn(async () => true);
    const progress = vi.fn();
    expect(
      await runRagBackfill(
        { sources: ['article'], afterId: 2, batchSize: 2 },
        reader,
        replay,
        progress,
      ),
    ).toBe(3);
    expect(reader.upperBound).toHaveBeenCalledOnce();
    expect(reader.page.mock.calls).toEqual([
      ['article', 2, 6, 2],
      ['article', 5, 6, 2],
    ]);
    expect(progress.mock.calls).toEqual([
      ['article', 3],
      ['article', 5],
      ['article', 6],
    ]);
  });

  it('fails at the source ID without leaking provider details or advancing checkpoints', async () => {
    const reader = { upperBound: async () => 3, page: async () => [1, 2, 3] };
    const replay = vi.fn(async (_source, id: number) => {
      if (id === 2) throw new Error('secret API key');
      return true;
    });
    const progress = vi.fn();
    await expect(
      runRagBackfill(
        { sources: ['article'], afterId: 0, batchSize: 100 },
        reader,
        replay,
        progress,
      ),
    ).rejects.toThrow('RAG backfill failed: article:2');
    expect(replay).toHaveBeenCalledTimes(2);
    expect(progress.mock.calls).toEqual([['article', 1]]);
  });

  it('rejects non-advancing pages and empty replay acknowledgements', async () => {
    const options = { sources: ['article'] as const, afterId: 0, batchSize: 1 };
    await expect(
      runRagBackfill(
        options,
        { upperBound: async () => 1, page: async () => [0] },
        async () => true,
        () => {},
      ),
    ).rejects.toThrow('Invalid backfill page order');
    await expect(
      runRagBackfill(
        options,
        { upperBound: async () => 1, page: async () => [1] },
        async () => false,
        () => {},
      ),
    ).rejects.toThrow('article:1');
  });
});
