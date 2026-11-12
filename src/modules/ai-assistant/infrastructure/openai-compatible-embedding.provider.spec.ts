import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { OpenAiCompatibleEmbeddingProvider } from './openai-compatible-embedding.provider.js';

function createConfig(values: Record<string, string>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

describe('OpenAiCompatibleEmbeddingProvider', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('preserves input order and validates 1024-dimensional vectors', async () => {
    const first = Array.from({ length: 1024 }, () => 0.25);
    const second = Array.from({ length: 1024 }, () => -0.5);
    fetchMock.mockResolvedValue(
      Response.json({
        data: [
          { index: 1, embedding: second },
          { index: 0, embedding: first },
        ],
      }),
    );
    const provider = new OpenAiCompatibleEmbeddingProvider(
      createConfig({
        EMBEDDING_BASE_URL: 'https://embed.example.test/v1/',
        EMBEDDING_API_KEY: 'embedding-secret',
        EMBEDDING_MODEL: 'BAAI/bge-m3',
      }),
    );

    await expect(
      provider.embed(['first source', 'second source']),
    ).resolves.toEqual([first, second]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://embed.example.test/v1/embeddings',
    );
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(request.headers).get('authorization')).toBe(
      'Bearer embedding-secret',
    );
    expect(typeof request.body).toBe('string');
    expect(JSON.parse(request.body as string)).toEqual({
      model: 'BAAI/bge-m3',
      input: ['first source', 'second source'],
      encoding_format: 'float',
    });
  });

  it('rejects missing or malformed vectors without retrying the request', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ data: [{ index: 0, embedding: [0.1, Number.NaN] }] }),
    );
    const provider = new OpenAiCompatibleEmbeddingProvider(
      createConfig({ EMBEDDING_BASE_URL: 'http://localhost:8000/v1' }),
    );

    await expect(provider.embed(['source'])).rejects.toThrow('invalid vector');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('rejects empty text batches before making a request', async () => {
    const provider = new OpenAiCompatibleEmbeddingProvider(
      createConfig({ EMBEDDING_BASE_URL: 'http://localhost:8000/v1' }),
    );

    await expect(provider.embed(['  '])).rejects.toThrow('non-empty text');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    null,
    [],
    {},
    { data: null },
    { data: [null] },
    { data: [{ index: 0, embedding: null }] },
  ])('rejects malformed batch envelopes consistently %#', async (payload) => {
    fetchMock.mockResolvedValue(Response.json(payload));
    const provider = new OpenAiCompatibleEmbeddingProvider(
      createConfig({ EMBEDDING_BASE_URL: 'http://localhost/v1' }),
    );
    await expect(provider.embed(['source'])).rejects.toThrow(
      /^Embedding provider returned an invalid (batch|vector)$/,
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it('redacts invalid JSON rather than propagating a native parse excerpt', async () => {
    fetchMock.mockResolvedValue(
      new Response('sensitive-provider-body invalid json'),
    );
    const provider = new OpenAiCompatibleEmbeddingProvider(
      createConfig({ EMBEDDING_BASE_URL: 'http://localhost/v1' }),
    );
    await expect(provider.embed(['source'])).rejects.toThrow(
      /^Embedding provider returned invalid JSON$/,
    );
  });
});
