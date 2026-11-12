import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';
import type {
  RagCandidate,
  RagCandidateRetriever,
  RagRetrievalQuery,
} from '../application/ports/rag-candidate-retriever.js';
import type { RagAccessFilter } from '../domain/rag-access.js';
import { currentPublicRagSource } from './rag-source-visibility.sql.js';

const EMBEDDING_DIMENSION = 1024;

interface RagCandidateRow {
  chunkId: string;
  sourceKey: string;
  sourceType: string;
  sourceId: number | null;
  title: string;
  chunkIndex: number;
  content: string;
  similarity: number;
}

@Injectable()
export class PrismaRagCandidateRetriever implements RagCandidateRetriever {
  constructor(private readonly prisma: PrismaService) {}

  async search(
    query: RagRetrievalQuery,
    access: RagAccessFilter,
  ): Promise<RagCandidate[]> {
    if (!access.public && access.merchant.kind === 'none' && !access.admin) {
      return [];
    }
    validateQuery(query);

    const vector = `[${query.embedding.join(',')}]`;
    const merchantId =
      access.merchant.kind === 'selected' ? access.merchant.merchantId : null;
    const rows = await this.prisma.$queryRaw<RagCandidateRow[]>(Prisma.sql`
      SELECT chunk."RagChunkId"::text AS "chunkId",
             document."SourceKey" AS "sourceKey",
             document."SourceType" AS "sourceType",
             document."SourceId" AS "sourceId",
             document."Title" AS "title",
             chunk."ChunkIndex" AS "chunkIndex",
             chunk."ChunkContent" AS "content",
             1 - (chunk."Embedding" <=> ${vector}::vector(1024)) AS "similarity"
      FROM "RagChunk" AS chunk
      INNER JOIN "RagDocument" AS document
        ON document."RagDocumentId" = chunk."RagDocumentId"
      WHERE document."Status" = 'indexed'
        AND document."ManualDisabled" = false
        AND chunk."EmbeddingModel" = ${query.embeddingModel}
        AND (${currentPublicRagSource()})
        AND (
          (${access.public} AND document."AccessScope" = 'public')
          OR (${access.merchant.kind === 'all'} AND document."AccessScope" = 'merchant')
          OR (
            ${access.merchant.kind === 'selected'}
            AND document."AccessScope" = 'merchant'
            AND document."MerchantId" = ${merchantId}
          )
          OR (${access.admin} AND document."AccessScope" = 'admin')
        )
      ORDER BY chunk."Embedding" <=> ${vector}::vector(1024), chunk."RagChunkId"
      LIMIT ${query.limit}
    `);

    return rows;
  }
}

function validateQuery(query: RagRetrievalQuery): void {
  if (
    query.embedding.length !== EMBEDDING_DIMENSION ||
    query.embedding.some((value) => !Number.isFinite(value))
  ) {
    throw new RangeError(
      `RAG query embedding must contain ${EMBEDDING_DIMENSION} finite numbers`,
    );
  }
  if (!query.embeddingModel.trim()) {
    throw new TypeError('RAG embedding model must not be empty');
  }
  if (!Number.isSafeInteger(query.limit) || query.limit < 1) {
    throw new RangeError('RAG retrieval limit must be a positive integer');
  }
}
