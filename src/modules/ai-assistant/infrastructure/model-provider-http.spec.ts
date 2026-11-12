import { ConfigService } from '@nestjs/config';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { OpenAiCompatibleChatModelProvider } from './openai-compatible-chat-model.provider.js';
import { OpenAiCompatibleEmbeddingProvider } from './openai-compatible-embedding.provider.js';
import {
  failureDiagnostic,
  UpstreamHttpError,
} from '../../../shared/diagnostics/failure-diagnostic.js';

type Handler = (request: IncomingMessage, response: ServerResponse) => void;
async function fixture(handler: Handler) {
  const requests: string[] = [];
  const closed: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url ?? '');
    response.once('close', () => closed.push(request.url ?? ''));
    request.resume();
    handler(request, response);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing test port');
  const base = `http://127.0.0.1:${address.port}/v1`;
  return {
    requests,
    closed,
    chat(values: Record<string, string> = {}) {
      return new OpenAiCompatibleChatModelProvider(
        new ConfigService({
          CHAT_MODEL_BASE_URL: base,
          CHAT_MODEL_API_KEY: 'local-test-only',
          CHAT_MODEL_TIMEOUT_MS: '5000',
          ...values,
        }),
      );
    },
    embedding(values: Record<string, string> = {}) {
      return new OpenAiCompatibleEmbeddingProvider(
        new ConfigService({
          EMBEDDING_BASE_URL: base,
          EMBEDDING_TIMEOUT_MS: '5000',
          ...values,
        }),
      );
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
const delta = 'data: {"choices":[{"delta":{"content":"雪场"}}]}\n\n';
async function collect(stream: AsyncIterable<string>) {
  const result = [];
  for await (const value of stream) result.push(value);
  return result;
}

describe('Model adapters through real loopback HTTP', () => {
  it('cancels a connection kept open after [DONE] without leaking trailing data', async () => {
    const api = await fixture((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write(
        delta +
          'data: [DONE]\n\ndata: {"choices":[{"delta":{"content":"ignored"}}]}\n\n',
      );
    });
    try {
      expect(await collect(api.chat().stream({ messages: [] }))).toEqual([
        '雪场',
      ]);
      await vi.waitFor(() =>
        expect(api.closed).toEqual(['/v1/chat/completions']),
      );
      expect(api.requests).toHaveLength(1);
    } finally {
      await api.close();
    }
  });
  it('closes the physical upstream when a caller returns its iterator', async () => {
    const api = await fixture((_request, response) => {
      response.writeHead(200);
      response.write(delta);
    });
    const stream = api.chat().stream({ messages: [] })[Symbol.asyncIterator]();
    try {
      expect((await stream.next()).value).toBe('雪场');
      await stream.return?.();
      await vi.waitFor(() => expect(api.closed).toHaveLength(1));
      expect(api.requests).toHaveLength(1);
    } finally {
      await stream.return?.();
      await api.close();
    }
  });
  it('aborts a pending network read when the caller disconnects', async () => {
    const api = await fixture((_request, response) => {
      response.writeHead(200);
      response.write(delta);
    });
    const abort = new AbortController();
    const stream = api
      .chat()
      .stream({ messages: [] }, abort.signal)
      [Symbol.asyncIterator]();
    try {
      expect((await stream.next()).value).toBe('雪场');
      const waiting = stream.next();
      abort.abort();
      await expect(waiting).rejects.toThrow();
      await vi.waitFor(() => expect(api.closed).toHaveLength(1));
      expect(api.requests).toHaveLength(1);
    } finally {
      abort.abort();
      await stream.return?.();
      await api.close();
    }
  });
  it('applies the deadline to the body after response headers', async () => {
    const api = await fixture((_request, response) => {
      response.writeHead(200);
      response.write(': keepalive\n\n');
    });
    try {
      const result = collect(
        api.chat({ CHAT_MODEL_TIMEOUT_MS: '300' }).stream({ messages: [] }),
      );
      await expect(result).rejects.toThrow();
      expect(
        failureDiagnostic(await result.catch((error: unknown) => error)),
      ).toEqual({ kind: 'timeout', upstreamStatus: null, code: null });
      await vi.waitFor(() => expect(api.closed).toHaveLength(1));
      expect(api.requests).toHaveLength(1);
    } finally {
      await api.close();
    }
  });
  it('does not send a request for an already aborted caller', async () => {
    const api = await fixture((_request, response) => response.end());
    const abort = new AbortController();
    abort.abort();
    try {
      await expect(
        collect(api.chat().stream({ messages: [] }, abort.signal)),
      ).rejects.toThrow();
      expect(api.requests).toEqual([]);
    } finally {
      await api.close();
    }
  });
  it.each(['chat', 'embedding'] as const)(
    'rejects %s redirects without replaying the request',
    async (kind) => {
      const api = await fixture((request, response) => {
        if (request.url === '/redirect-target')
          response.end('should not receive this request');
        else {
          response.writeHead(307, { location: '/redirect-target' });
          response.end();
        }
      });
      try {
        const result =
          kind === 'chat'
            ? collect(
                api.chat().stream({
                  messages: [{ role: 'user', content: 'local test' }],
                }),
              )
            : api.embedding().embed(['local source']);
        await expect(result).rejects.toThrow();
        expect(api.requests).toEqual([
          kind === 'chat' ? '/v1/chat/completions' : '/v1/embeddings',
        ]);
      } finally {
        await api.close();
      }
    },
  );
  it.each(['chat', 'embedding'] as const)(
    'closes %s HTTP errors and redacts the provider body',
    async (kind) => {
      const api = await fixture((_request, response) => {
        response.writeHead(503);
        response.write('sensitive-provider-error');
      });
      try {
        const result =
          kind === 'chat'
            ? collect(api.chat().stream({ messages: [] }))
            : api.embedding().embed(['local source']);
        await expect(result).rejects.toThrow(
          /^Model provider returned HTTP 503$/,
        );
        const error = await result.catch((value: unknown) => value);
        expect(error).toBeInstanceOf(UpstreamHttpError);
        expect(failureDiagnostic(error)).toEqual({
          kind: 'upstream_http',
          upstreamStatus: 503,
          code: null,
        });
        await vi.waitFor(() => expect(api.closed).toHaveLength(1));
        expect(api.requests).toHaveLength(1);
      } finally {
        await api.close();
      }
    },
  );
  it('rejects a physical stream truncated before [DONE]', async () => {
    const api = await fixture((_request, response) => response.end(delta));
    try {
      await expect(
        collect(api.chat().stream({ messages: [] })),
      ).rejects.toThrow('before [DONE]');
      expect(api.requests).toHaveLength(1);
    } finally {
      await api.close();
    }
  });
  it('orders embedding responses from real JSON and retains the 1024-dimension contract', async () => {
    const first = Array.from({ length: 1024 }, () => 0.25),
      second = Array.from({ length: 1024 }, () => -0.5);
    const api = await fixture((_request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          data: [
            { index: 1, embedding: second },
            { index: 0, embedding: first },
          ],
        }),
      );
    });
    try {
      expect(await api.embedding().embed(['first', 'second'])).toEqual([
        first,
        second,
      ]);
      expect(api.requests).toHaveLength(1);
    } finally {
      await api.close();
    }
  });

  it('cancels an embedding JSON body that stalls after headers without retry', async () => {
    const api = await fixture((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.write('{"data":[');
    });
    try {
      const result = api
        .embedding({ EMBEDDING_TIMEOUT_MS: '300' })
        .embed(['source']);
      await expect(result).rejects.toThrow('invalid JSON');
      expect(
        failureDiagnostic(await result.catch((error: unknown) => error)),
      ).toEqual({ kind: 'timeout', upstreamStatus: null, code: null });
      await vi.waitFor(() => expect(api.closed).toHaveLength(1));
      expect(api.requests).toHaveLength(1);
    } finally {
      await api.close();
    }
  });
});
