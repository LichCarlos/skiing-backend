import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  ChatModelInput,
  ChatModelProvider,
} from '../application/ports/chat-model-provider.js';
import {
  assertSuccessfulResponse,
  createCompatibleEndpoint,
  createModelRequestSignal,
  modelAuthorizationHeader,
} from './openai-compatible-http.js';

const MAX_SSE_EVENT_CHARACTERS = 1_048_576;

@Injectable()
export class OpenAiCompatibleChatModelProvider implements ChatModelProvider {
  constructor(private readonly config: ConfigService) {}

  async *stream(
    input: ChatModelInput,
    signal?: AbortSignal,
  ): AsyncIterable<string> {
    const apiKey = this.config.get<string>('CHAT_MODEL_API_KEY');
    if (!apiKey?.trim()) throw new Error('CHAT_MODEL_API_KEY is required');
    const thinking = this.config.get<string>('CHAT_MODEL_THINKING')?.trim();
    if (thinking && thinking !== 'enabled' && thinking !== 'disabled')
      throw new Error('CHAT_MODEL_THINKING must be enabled or disabled');
    const configuredMaxTokens = this.config.get<string>(
      'CHAT_MODEL_MAX_TOKENS',
    );
    const maxTokens =
      input.maxTokens ??
      (configuredMaxTokens?.trim() ? Number(configuredMaxTokens) : undefined);
    if (
      maxTokens !== undefined &&
      (!Number.isSafeInteger(maxTokens) || maxTokens < 1)
    )
      throw new Error('CHAT_MODEL_MAX_TOKENS must be a positive integer');

    const requestSignal = createModelRequestSignal(
      this.config.get<string>('CHAT_MODEL_TIMEOUT_MS'),
      'CHAT_MODEL_TIMEOUT_MS',
      120_000,
      signal,
    );
    const response = await fetch(
      createCompatibleEndpoint(
        this.config.get<string>('CHAT_MODEL_BASE_URL'),
        '/chat/completions',
      ),
      {
        method: 'POST',
        // Do not replay a prompt or credential through a provider redirect.
        redirect: 'error',
        headers: {
          accept: 'text/event-stream',
          'content-type': 'application/json',
          ...modelAuthorizationHeader(apiKey),
        },
        body: JSON.stringify({
          model:
            this.config.get<string>('CHAT_MODEL_NAME')?.trim() ||
            'deepseek-flash',
          messages: input.messages,
          stream: true,
          ...(thinking ? { thinking: { type: thinking } } : {}),
          ...(input.temperature === undefined
            ? {}
            : { temperature: input.temperature }),
          ...(maxTokens === undefined ? {} : { max_tokens: maxTokens }),
        }),
        signal: requestSignal,
      },
    );

    await assertSuccessfulResponse(response);
    if (!response.body) throw new Error('Chat model returned an empty stream');

    let completed = false;
    try {
      for await (const data of readSseData(response.body)) {
        if (data === '[DONE]') {
          completed = true;
          break;
        }

        let chunk: unknown;
        try {
          chunk = JSON.parse(data) as unknown;
        } catch {
          throw new Error('Chat model returned an invalid stream event');
        }
        if (!isRecord(chunk))
          throw new Error('Chat model returned an invalid stream event');
        if (chunk.error) throw new Error('Chat model returned an error event');
        if (!Array.isArray(chunk.choices))
          throw new Error('Chat model returned an invalid stream event');
        // Empty choices may carry usage metadata. Other choices are irrelevant
        // because this adapter requests one completion, never n > 1.
        const choice: unknown = chunk.choices[0];
        if (choice === undefined) continue;
        if (!isRecord(choice) || !isRecord(choice.delta))
          throw new Error('Chat model returned an invalid stream event');
        const content = choice.delta.content;
        if (
          content !== undefined &&
          content !== null &&
          typeof content !== 'string'
        )
          throw new Error('Chat model returned an invalid stream event');
        if (typeof content === 'string' && content.length > 0) yield content;
      }
    } catch (error) {
      requestSignal.throwIfAborted();
      throw error;
    }
    if (!completed) throw new Error('Chat model stream ended before [DONE]');
  }
}

async function* readSseData(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '';
  let event = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });

      while (true) {
        const separator = /\r\n|\r|\n/.exec(buffer);
        if (!separator || separator.index === undefined) break;
        // A CR at a transport boundary may be the first half of CRLF.
        if (
          !done &&
          separator[0] === '\r' &&
          separator.index === buffer.length - 1
        )
          break;
        const line = buffer.slice(0, separator.index);
        buffer = buffer.slice(separator.index + separator[0].length);
        if (event.length + line.length > MAX_SSE_EVENT_CHARACTERS)
          throw new Error('Chat model stream event exceeded size limit');
        if (line === '') {
          const data = eventData(event);
          event = '';
          if (data !== null) yield data;
        } else event += `${line}\n`;
      }
      if (event.length + buffer.length > MAX_SSE_EVENT_CHARACTERS)
        throw new Error('Chat model stream event exceeded size limit');

      if (done) break;
    }

    const finalData = eventData(event + buffer);
    if (finalData !== null) yield finalData;
  } finally {
    // releaseLock alone leaves the HTTP body/socket alive on [DONE], errors,
    // or when the application stops reading after its own output limit.
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function eventData(event: string): string | null {
  const lines = event.split(/\r?\n/);
  const dataLines = lines
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).replace(/^ /, ''));
  return dataLines.length > 0 ? dataLines.join('\n') : null;
}
