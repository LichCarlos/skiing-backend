import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  parseVerificationTarget,
  verifyModelProviders,
} from './verify-model-providers.js';

const chat = {
  CHAT_MODEL_BASE_URL: 'https://api.deepseek.com',
  CHAT_MODEL_API_KEY: 'synthetic-chat-secret',
  CHAT_MODEL_NAME: 'deepseek-flash',
  CHAT_MODEL_THINKING: 'disabled',
};
const embedding = {
  EMBEDDING_BASE_URL: 'http://127.0.0.1:8000/v1',
  EMBEDDING_API_KEY: 'synthetic-embedding-secret',
  EMBEDDING_MODEL: 'BAAI/bge-m3',
};
function stream(text = 'LINJI_AI_OK', done = true) {
  return new Response(
    `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n${done ? 'data: [DONE]\n\n' : ''}`,
  );
}
function embeddings(vectors?: number[][]) {
  const v = (a: number, b: number) => [a, b, ...Array<number>(1022).fill(0)];
  return Response.json({
    data: (vectors ?? [v(1, 0), v(0.9, 0.1), v(0, 1)]).map(
      (embedding, index) => ({ index, embedding }),
    ),
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('Explicit live-provider verification', () => {
  it('requires an explicit target before enabling a billable probe', () => {
    expect(parseVerificationTarget(['--help'])).toBe('help');
    expect(parseVerificationTarget(['--', '--chat'])).toBe('chat');
    expect(parseVerificationTarget(['--embedding'])).toBe('embedding');
    expect(parseVerificationTarget(['--all'])).toBe('all');
    expect(() => parseVerificationTarget([])).toThrow(
      'explicit_target_required',
    );
    expect(() => parseVerificationTarget(['--chat', '--all'])).toThrow();
  });

  it('checks model availability and exercises the production streaming adapter', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ data: [{ id: 'deepseek-flash' }] }),
      )
      .mockResolvedValueOnce(stream());
    vi.stubGlobal('fetch', fetch);
    const result = await verifyModelProviders('chat', chat);
    expect(result.passed).toBe(true);
    expect(result.checks[0]).toMatchObject({
      status: 'passed',
      model: 'deepseek-flash',
      streamChunks: 1,
    });
    expect(String(fetch.mock.calls[0]![0])).toBe(
      'https://api.deepseek.com/models',
    );
    expect(fetch.mock.calls[1]![0]).toBe(
      'https://api.deepseek.com/chat/completions',
    );
    const body = JSON.parse(fetch.mock.calls[1]![1].body);
    expect(body).toMatchObject({
      max_tokens: 256,
      thinking: { type: 'disabled' },
      stream: true,
    });
    expect(JSON.stringify(result)).not.toContain(chat.CHAT_MODEL_API_KEY);
    expect(JSON.stringify(result)).not.toContain('LINJI_AI_OK');
  });

  it('rejects an unavailable model before a chat request is charged', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(Response.json({ data: [{ id: 'other' }] }));
    vi.stubGlobal('fetch', fetch);
    const report = await verifyModelProviders('chat', chat);
    expect(report.checks[0]).toMatchObject({
      status: 'failed',
      code: 'model_not_available',
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('does not retry provider authorization failures or expose their bodies', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response('private-provider-error', { status: 401 }),
      );
    vi.stubGlobal('fetch', fetch);
    const report = await verifyModelProviders('chat', chat);
    expect(report.checks[0]).toMatchObject({
      code: 'provider_http_error',
      httpStatus: 401,
    });
    expect(JSON.stringify(report)).not.toContain('private-provider-error');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('reports missing embedding settings without making an upstream request', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const report = await verifyModelProviders('embedding', chat);
    expect(report.passed).toBe(false);
    expect(report.checks[0]).toMatchObject({
      status: 'not_configured',
      code: 'missing_configuration',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    'http://external.test/v1',
    'ftp://127.0.0.1',
    'https://user:password@external.test/v1',
    'https://external.test/v1?key=secret',
    'https://external.test/v1#fragment',
    'invalid-url',
  ])(
    'rejects unsafe provider address %s before transmitting credentials',
    async (url) => {
      const fetch = vi.fn();
      vi.stubGlobal('fetch', fetch);
      const report = await verifyModelProviders('chat', {
        ...chat,
        CHAT_MODEL_BASE_URL: url,
      });
      expect(report.checks[0]).toMatchObject({ code: 'invalid_configuration' });
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it('rejects malformed model lists without a generation request', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ data: null }));
    vi.stubGlobal('fetch', fetch);
    const report = await verifyModelProviders('chat', chat);
    expect(report.checks[0]).toMatchObject({ code: 'invalid_model_list' });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('does not accept a truncated stream as successful', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ data: [{ id: 'deepseek-flash' }] }),
      )
      .mockResolvedValueOnce(stream('LINJI_AI_OK', false));
    vi.stubGlobal('fetch', fetch);
    expect((await verifyModelProviders('chat', chat)).passed).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('checks three real-shaped 1024-dimensional vectors and a semantic comparison', async () => {
    const fetch = vi.fn().mockResolvedValue(embeddings());
    vi.stubGlobal('fetch', fetch);
    const report = await verifyModelProviders('embedding', embedding);
    expect(report.passed).toBe(true);
    expect(report.checks[0]).toMatchObject({
      status: 'passed',
      vectors: 3,
      dimension: 1024,
    });
    expect(report.checks[0]!.relatedSimilarity).toBeGreaterThan(
      report.checks[0]!.unrelatedSimilarity!,
    );
    expect(JSON.stringify(report)).not.toContain('synthetic-embedding-secret');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each(['dimension', 'zero', 'identical'] as const)(
    'rejects an invalid %s embedding provider',
    async (kind) => {
      const length = kind === 'dimension' ? 1023 : 1024;
      const vector = Array<number>(length).fill(0);
      if (kind !== 'zero') vector[0] = 1;
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(embeddings([vector, vector, vector])),
      );
      expect((await verifyModelProviders('embedding', embedding)).passed).toBe(
        false,
      );
    },
  );

  it('never converts arbitrary transport errors into unredacted output', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockRejectedValue(new Error(`credential: ${chat.CHAT_MODEL_API_KEY}`)),
    );
    const report = await verifyModelProviders('chat', chat);
    expect(report.checks[0]).toMatchObject({ code: 'provider_request_failed' });
    expect(JSON.stringify(report)).not.toContain(chat.CHAT_MODEL_API_KEY);
  });

  it('reports partial success without marking full RAG or database acceptance complete', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ data: [{ id: 'deepseek-flash' }] }),
      )
      .mockResolvedValueOnce(stream());
    vi.stubGlobal('fetch', fetch);
    const report = await verifyModelProviders('all', chat);
    expect(report.passed).toBe(false);
    expect(report.scope).toBe('real-provider-smoke-only');
    expect(report.checks.map((check) => check.status)).toEqual([
      'passed',
      'not_configured',
    ]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
