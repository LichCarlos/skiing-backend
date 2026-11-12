import { describe, expect, it } from 'vitest';
import {
  RAG_CHUNK_MAX_CHARACTERS,
  RAG_CHUNK_OVERLAP_CHARACTERS,
  splitRagText,
} from './split-rag-text.js';

describe('splitRagText', () => {
  it('splits long text with a deterministic overlap', () => {
    const text = 'x'.repeat(2_500);
    const chunks = splitRagText(text);

    expect(chunks.map(({ index }) => index)).toEqual([0, 1, 2]);
    expect(
      chunks.every(
        ({ content }) => Array.from(content).length <= RAG_CHUNK_MAX_CHARACTERS,
      ),
    ).toBe(true);
    expect(chunks[0]?.content.slice(-RAG_CHUNK_OVERLAP_CHARACTERS)).toBe(
      chunks[1]?.content.slice(0, RAG_CHUNK_OVERLAP_CHARACTERS),
    );
    expect(chunks[1]?.content.slice(-RAG_CHUNK_OVERLAP_CHARACTERS)).toBe(
      chunks[2]?.content.slice(0, RAG_CHUNK_OVERLAP_CHARACTERS),
    );
  });

  it('prefers sentence boundaries and counts Unicode code points', () => {
    const sentence = '雪道安全说明。';
    const text = `${'雪'.repeat(1_190)}${sentence}${'友'.repeat(50)}`;
    const chunks = splitRagText(text);

    expect(chunks[0]?.content.endsWith('。')).toBe(true);
    expect(
      chunks.every(
        ({ content }) => Array.from(content).length <= RAG_CHUNK_MAX_CHARACTERS,
      ),
    ).toBe(true);
  });

  it('normalizes line endings and ignores blank input', () => {
    expect(splitRagText(' \r\n\t ')).toEqual([]);
    expect(splitRagText('first\r\nsecond')[0]?.content).toBe('first\nsecond');
  });
});
