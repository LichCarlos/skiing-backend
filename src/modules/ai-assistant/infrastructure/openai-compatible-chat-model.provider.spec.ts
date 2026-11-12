import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import type { ChatModelInput } from '../application/ports/chat-model-provider.js';
import { OpenAiCompatibleChatModelProvider } from './openai-compatible-chat-model.provider.js';

function createConfig(values: Record<string, string>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

function streamResponse(parts: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  });
  return new Response(body);
}

describe('OpenAiCompatibleChatModelProvider', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('streams SSE deltas using the configured model and bearer credential', async () => {
    fetchMock.mockResolvedValue(
      streamResponse([
        'data: {"choices":[{"delta":{"content":"Fresh "}}]}\r\n\r',
        '\ndata: {"choices":[{"delta":{"content":"snow"}}]}\n\n',
        'data: [DONE]\n\n',
      ]),
    );
    const provider = new OpenAiCompatibleChatModelProvider(
      createConfig({
        CHAT_MODEL_BASE_URL: 'https://api.example.test/v1/',
        CHAT_MODEL_API_KEY: 'server-secret',
        CHAT_MODEL_NAME: 'deepseek-v4.1-flash',
      }),
    );
    const input: ChatModelInput = {
      messages: [
        { role: 'system', content: 'Use only cited evidence.' },
        { role: 'user', content: 'What is the snow condition?' },
      ],
      temperature: 0.2,
      maxTokens: 500,
    };
    const deltas: string[] = [];
    for await (const delta of provider.stream(input)) deltas.push(delta);

    expect(deltas).toEqual(['Fresh ', 'snow']);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://api.example.test/v1/chat/completions',
    );
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(request.method).toBe('POST');
    expect(new Headers(request.headers).get('authorization')).toBe(
      'Bearer server-secret',
    );
    expect(typeof request.body).toBe('string');
    expect(JSON.parse(request.body as string)).toEqual({
      model: 'deepseek-v4.1-flash',
      messages: input.messages,
      stream: true,
      temperature: 0.2,
      max_tokens: 500,
    });
  });

  it('does not retry a failed non-idempotent model request', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }));
    const provider = new OpenAiCompatibleChatModelProvider(
      createConfig({
        CHAT_MODEL_BASE_URL: 'https://api.example.test/v1',
        CHAT_MODEL_API_KEY: 'server-secret',
      }),
    );

    await expect(
      provider
        .stream({ messages: [{ role: 'user', content: 'Hello' }] })
        [Symbol.asyncIterator]()
        .next(),
    ).rejects.toThrow('Model provider returned HTTP 503');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('uses the verified Flash ID and configured thinking/output limits', async () => {
    fetchMock.mockResolvedValue(streamResponse(['data: [DONE]\n\n']));
    const provider = new OpenAiCompatibleChatModelProvider(
      createConfig({
        CHAT_MODEL_BASE_URL: 'https://api.example.test',
        CHAT_MODEL_API_KEY: 'server-secret',
        CHAT_MODEL_NAME: '  ',
        CHAT_MODEL_THINKING: 'disabled',
        CHAT_MODEL_MAX_TOKENS: '2048',
      }),
    );
    for await (const _delta of provider.stream({ messages: [] })) {
      /* drain */
    }
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(request.body as string)).toEqual({
      model: 'deepseek-flash',
      messages: [],
      stream: true,
      thinking: { type: 'disabled' },
      max_tokens: 2048,
    });
  });

  it('allows a probe to use a smaller output limit than the runtime setting', async () => {
    fetchMock.mockResolvedValue(streamResponse(['data: [DONE]\n\n']));
    const provider = new OpenAiCompatibleChatModelProvider(
      createConfig({
        CHAT_MODEL_BASE_URL: 'https://api.example.test',
        CHAT_MODEL_API_KEY: 'server-secret',
        CHAT_MODEL_MAX_TOKENS: '2048',
      }),
    );
    for await (const _delta of provider.stream({
      messages: [],
      maxTokens: 256,
    })) {
      /* drain */
    }
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(request.body as string).max_tokens).toBe(256);
  });

  it.each([
    ['CHAT_MODEL_THINKING', 'invalid'],
    ['CHAT_MODEL_MAX_TOKENS', '0'],
    ['CHAT_MODEL_MAX_TOKENS', 'NaN'],
    ['CHAT_MODEL_MAX_TOKENS', '1.5'],
  ])(
    'rejects invalid provider settings before sending a request: %s=%s',
    async (key, value) => {
      const provider = new OpenAiCompatibleChatModelProvider(
        createConfig({
          CHAT_MODEL_BASE_URL: 'https://api.example.test',
          CHAT_MODEL_API_KEY: 'server-secret',
          [key]: value,
        }),
      );
      await expect(
        provider.stream({ messages: [] })[Symbol.asyncIterator]().next(),
      ).rejects.toThrow();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('rejects a stream that closes without the completion sentinel', async () => {
    fetchMock.mockResolvedValue(
      streamResponse([
        'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
      ]),
    );
    const provider = new OpenAiCompatibleChatModelProvider(
      createConfig({
        CHAT_MODEL_BASE_URL: 'https://api.example.test/v1',
        CHAT_MODEL_API_KEY: 'server-secret',
      }),
    );
    const consume = async () => {
      for await (const _delta of provider.stream({
        messages: [{ role: 'user', content: 'Hello' }],
      })) {
        // Consume the stream to observe its terminal state.
      }
    };

    await expect(consume()).rejects.toThrow(
      'Chat model stream ended before [DONE]',
    );
  });

  it('requires a server-side API key before making a request', async () => {
    const provider = new OpenAiCompatibleChatModelProvider(
      createConfig({ CHAT_MODEL_BASE_URL: 'https://api.example.test/v1' }),
    );

    await expect(
      provider
        .stream({ messages: [{ role: 'user', content: 'Hello' }] })
        [Symbol.asyncIterator]()
        .next(),
    ).rejects.toThrow('CHAT_MODEL_API_KEY is required');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects provider URLs containing credentials', async () => {
    const provider = new OpenAiCompatibleChatModelProvider(
      createConfig({
        CHAT_MODEL_BASE_URL: 'https://user:secret@api.example.test/v1',
        CHAT_MODEL_API_KEY: 'server-secret',
      }),
    );

    await expect(
      provider
        .stream({ messages: [{ role: 'user', content: 'Hello' }] })
        [Symbol.asyncIterator]()
        .next(),
    ).rejects.toThrow('without credentials');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['done', 'cancel', 'invalid'])(
    'closes the upstream body on %s',
    async (mode) => {
      const cancel = vi.fn();
      fetchMock.mockResolvedValue(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  mode === 'done'
                    ? 'data: [DONE]\n\n'
                    : mode === 'invalid'
                      ? 'data: not-json\n\n'
                      : 'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
                ),
              );
            },
            cancel,
          }),
        ),
      );
      const provider = new OpenAiCompatibleChatModelProvider(
        createConfig({
          CHAT_MODEL_API_KEY: 'test-key',
          CHAT_MODEL_BASE_URL: 'http://localhost/v1',
        }),
      );
      const iterator = provider
        .stream({ messages: [] })
        [Symbol.asyncIterator]();
      if (mode === 'invalid') await expect(iterator.next()).rejects.toThrow();
      else if (mode === 'cancel') {
        expect((await iterator.next()).value).toBe('partial');
        await iterator.return?.();
      } else expect((await iterator.next()).done).toBe(true);
      expect(cancel).toHaveBeenCalledOnce();
    },
  );

  it.each(['\n', '\r\n', '\r'])(
    'handles fragmented UTF-8 and SSE line ending %j',
    async (eol) => {
      const bytes = new TextEncoder().encode(
        `: heartbeat${eol}${eol}data: {"choices":[{"delta":{"content":"雪🎿"}}]}${eol}${eol}data: {"choices":[]}${eol}${eol}data: [DONE]${eol}${eol}`,
      );
      fetchMock.mockResolvedValue(
        new Response(
          new ReadableStream({
            start(controller) {
              for (const byte of bytes)
                controller.enqueue(new Uint8Array([byte]));
              controller.close();
            },
          }),
        ),
      );
      const provider = new OpenAiCompatibleChatModelProvider(
        createConfig({
          CHAT_MODEL_API_KEY: 'test-key',
          CHAT_MODEL_BASE_URL: 'http://localhost/v1',
        }),
      );
      const result = [];
      for await (const delta of provider.stream({ messages: [] }))
        result.push(delta);
      expect(result).toEqual(['雪🎿']);
    },
  );
  it.each([
    'null',
    '[]',
    '{}',
    '{"choices":[null]}',
    '{"choices":[{"delta":null}]}',
    '{"choices":[{"delta":{"content":42}}]}',
    '{"error":{"message":"sensitive-provider-message"}}',
  ])(
    'rejects malformed/error payload without exposing provider content %#',
    async (payload) => {
      fetchMock.mockResolvedValue(
        streamResponse([`data: ${payload}\n\ndata: [DONE]\n\n`]),
      );
      const provider = new OpenAiCompatibleChatModelProvider(
        createConfig({
          CHAT_MODEL_API_KEY: 'test-key',
          CHAT_MODEL_BASE_URL: 'http://localhost/v1',
        }),
      );
      await expect(
        provider.stream({ messages: [] })[Symbol.asyncIterator]().next(),
      ).rejects.toThrow(
        /^Chat model returned an (invalid stream|error) event$/,
      );
    },
  );
  it.each(['data: ', ': ', 'data: {}\ndata: '])(
    'bounds an unterminated SSE record including comments/multiline data %#',
    async (prefix) => {
      const cancel = vi.fn();
      fetchMock.mockResolvedValue(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(prefix + 'x'.repeat(1_048_577)),
              );
            },
            cancel,
          }),
        ),
      );
      const provider = new OpenAiCompatibleChatModelProvider(
        createConfig({
          CHAT_MODEL_API_KEY: 'test-key',
          CHAT_MODEL_BASE_URL: 'http://localhost/v1',
        }),
      );
      await expect(
        provider.stream({ messages: [] })[Symbol.asyncIterator]().next(),
      ).rejects.toThrow('size limit');
      expect(cancel).toHaveBeenCalledOnce();
    },
  );
  it('rejects invalid UTF-8 and closes its body', async () => {
    const cancel = vi.fn();
    fetchMock.mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array([0xc3, 0x28]));
          },
          cancel,
        }),
      ),
    );
    const provider = new OpenAiCompatibleChatModelProvider(
      createConfig({
        CHAT_MODEL_API_KEY: 'test-key',
        CHAT_MODEL_BASE_URL: 'http://localhost/v1',
      }),
    );
    await expect(
      provider.stream({ messages: [] })[Symbol.asyncIterator]().next(),
    ).rejects.toThrow();
    expect(cancel).toHaveBeenCalledOnce();
  });
});
