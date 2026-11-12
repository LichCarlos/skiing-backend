import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EmbeddingProvider } from '../application/ports/embedding-provider.js';
import {
  assertSuccessfulResponse,
  createCompatibleEndpoint,
  createModelRequestSignal,
  modelAuthorizationHeader,
} from './openai-compatible-http.js';

const EMBEDDING_DIMENSION = 1024;

@Injectable()
export class OpenAiCompatibleEmbeddingProvider implements EmbeddingProvider {
  constructor(private readonly config: ConfigService) {}

  async embed(
    texts: readonly string[],
    signal?: AbortSignal,
  ): Promise<number[][]> {
    if (texts.length === 0 || texts.some((text) => text.trim().length === 0)) {
      throw new TypeError('Embedding input must contain non-empty text');
    }

    const requestSignal = createModelRequestSignal(
      this.config.get<string>('EMBEDDING_TIMEOUT_MS'),
      'EMBEDDING_TIMEOUT_MS',
      30_000,
      signal,
    );
    const response = await fetch(
      createCompatibleEndpoint(
        this.config.get<string>('EMBEDDING_BASE_URL'),
        '/embeddings',
      ),
      {
        method: 'POST',
        redirect: 'error',
        headers: {
          'content-type': 'application/json',
          ...modelAuthorizationHeader(
            this.config.get<string>('EMBEDDING_API_KEY'),
          ),
        },
        body: JSON.stringify({
          model: this.config.get<string>('EMBEDDING_MODEL') ?? 'BAAI/bge-m3',
          input: texts,
          encoding_format: 'float',
        }),
        signal: requestSignal,
      },
    );

    await assertSuccessfulResponse(response);
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw new Error('Embedding provider returned invalid JSON', {
        cause: requestSignal.aborted ? requestSignal.reason : error,
      });
    }
    if (
      !isRecord(payload) ||
      !Array.isArray(payload.data) ||
      payload.data.length !== texts.length
    ) {
      throw new Error('Embedding provider returned an invalid batch');
    }

    const ordered: Array<number[] | undefined> = Array.from(
      { length: texts.length },
      () => undefined,
    );
    for (const item of payload.data) {
      if (
        !isRecord(item) ||
        !Number.isSafeInteger(item.index) ||
        (item.index as number) < 0 ||
        (item.index as number) >= texts.length ||
        ordered[item.index as number] !== undefined ||
        !Array.isArray(item.embedding) ||
        item.embedding.length !== EMBEDDING_DIMENSION ||
        item.embedding.some(
          (value) => typeof value !== 'number' || !Number.isFinite(value),
        )
      ) {
        throw new Error('Embedding provider returned an invalid vector');
      }
      ordered[item.index as number] = item.embedding as number[];
    }

    return ordered.map((embedding) => {
      if (embedding === undefined) {
        throw new Error('Embedding provider omitted a batch item');
      }
      return embedding;
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
