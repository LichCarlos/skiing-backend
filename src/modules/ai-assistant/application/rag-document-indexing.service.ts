import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EMBEDDING_PROVIDER,
  type EmbeddingProvider,
} from './ports/embedding-provider.js';
import {
  RAG_DOCUMENT_WRITER,
  type RagDocumentWriter,
  type RagIndexOptions,
  type RagIndexDocument,
} from './ports/rag-document-writer.js';
import { splitRagText } from '../domain/split-rag-text.js';

const EMBEDDING_DIMENSION = 1024;
const EMBEDDING_BATCH_SIZE = 32;
const SOURCE_TYPES = [
  'resort',
  'article',
  'dynamic',
  'project_doc',
  'dictionary',
  'revenue',
] as const;
const ACCESS_SCOPES = ['public', 'merchant', 'admin'] as const;

export interface RagIndexResult {
  contentHash: string;
  chunkCount: number;
  skipped: boolean;
}

@Injectable()
export class RagDocumentIndexingService {
  constructor(
    private readonly config: ConfigService,
    @Inject(EMBEDDING_PROVIDER)
    private readonly embeddings: EmbeddingProvider,
    @Inject(RAG_DOCUMENT_WRITER)
    private readonly writer: RagDocumentWriter,
  ) {}

  async index(
    input: RagIndexDocument,
    signal?: AbortSignal,
    options: RagIndexOptions = {},
  ): Promise<RagIndexResult> {
    const document = validateDocument(input);
    const chunks = splitRagText(document.content);
    if (chunks.length === 0) throw new TypeError('RAG source content is empty');

    const contentHash = hashDocument(document);
    const embeddingModel =
      this.config.get<string>('EMBEDDING_MODEL')?.trim() || 'BAAI/bge-m3';
    const claim = await this.writer.beginIndexing(
      document,
      contentHash,
      embeddingModel,
      chunks.length,
      options,
    );
    if (claim.kind !== 'claimed') {
      return { contentHash, chunkCount: chunks.length, skipped: true };
    }

    let failureReason: 'embedding_failed' | 'index_commit_failed' =
      'embedding_failed';
    try {
      const indexedChunks = await embedChunks(
        chunks,
        embeddingModel,
        this.embeddings,
        signal,
      );
      failureReason = 'index_commit_failed';
      const committed = await this.writer.replaceChunksAndMarkIndexed(
        document.sourceKey,
        contentHash,
        embeddingModel,
        claim,
        indexedChunks,
      );
      return { contentHash, chunkCount: chunks.length, skipped: !committed };
    } catch (error) {
      try {
        const current = await this.writer.markFailed(
          document.sourceKey,
          contentHash,
          claim,
          failureReason,
        );
        if (!current) {
          return { contentHash, chunkCount: chunks.length, skipped: true };
        }
      } catch (markFailedError) {
        throw new AggregateError(
          [error, markFailedError],
          'RAG indexing failed and the document could not be marked failed',
        );
      }
      throw error;
    }
  }
}

async function embedChunks(
  chunks: ReturnType<typeof splitRagText>,
  embeddingModel: string,
  embeddings: EmbeddingProvider,
  signal?: AbortSignal,
) {
  const indexedChunks = [];
  for (let offset = 0; offset < chunks.length; offset += EMBEDDING_BATCH_SIZE) {
    const batch = chunks.slice(offset, offset + EMBEDDING_BATCH_SIZE);
    const vectors = await embeddings.embed(
      batch.map(({ content }) => content),
      signal,
    );
    if (vectors.length !== batch.length) {
      throw new Error('Embedding provider returned an unexpected vector count');
    }

    for (const [index, embedding] of vectors.entries()) {
      if (
        embedding.length !== EMBEDDING_DIMENSION ||
        embedding.some((value) => !Number.isFinite(value))
      ) {
        throw new Error('Embedding provider returned an invalid vector');
      }
      indexedChunks.push({
        ...batch[index]!,
        embedding,
      });
    }
  }
  return indexedChunks;
}

function validateDocument(document: RagIndexDocument): RagIndexDocument {
  const sourceKey = document.sourceKey.trim();
  const title = document.title.trim();
  const content = document.content.replace(/\r\n?/g, '\n').trim();
  if (!sourceKey || Array.from(sourceKey).length > 200) {
    throw new TypeError('RAG source key must contain 1 to 200 characters');
  }
  if (!title || Array.from(title).length > 300) {
    throw new TypeError('RAG title must contain 1 to 300 characters');
  }
  if (!content) throw new TypeError('RAG source content is empty');
  if (!(SOURCE_TYPES as readonly string[]).includes(document.sourceType)) {
    throw new TypeError('RAG source type is not supported');
  }
  if (!(ACCESS_SCOPES as readonly string[]).includes(document.accessScope)) {
    throw new TypeError('RAG access scope is not supported');
  }
  if (
    document.sourceId !== null &&
    (!Number.isSafeInteger(document.sourceId) || document.sourceId < 1)
  ) {
    throw new TypeError('RAG source ID must be a positive safe integer');
  }
  if (
    !(document.sourceUpdatedAt instanceof Date) ||
    Number.isNaN(document.sourceUpdatedAt.getTime())
  ) {
    throw new TypeError('RAG source update time must be a valid Date');
  }
  if (document.accessScope === 'merchant') {
    if (
      document.merchantId === null ||
      !Number.isSafeInteger(document.merchantId) ||
      document.merchantId < 1
    ) {
      throw new TypeError(
        'Merchant-scoped RAG sources require a valid merchant ID',
      );
    }
  } else if (document.merchantId !== null) {
    throw new TypeError(
      'Only merchant-scoped RAG sources may set a merchant ID',
    );
  }

  return { ...document, sourceKey, title, content };
}

function hashDocument(document: RagIndexDocument): string {
  const canonical = JSON.stringify({
    sourceKey: document.sourceKey,
    sourceType: document.sourceType,
    sourceId: document.sourceId,
    title: document.title,
    content: document.content,
    accessScope: document.accessScope,
    merchantId: document.merchantId,
    sourceUpdatedAt: document.sourceUpdatedAt.toISOString(),
    sourceState: document.sourceState ?? null,
  });
  return createHash('sha256').update(canonical).digest('hex');
}
