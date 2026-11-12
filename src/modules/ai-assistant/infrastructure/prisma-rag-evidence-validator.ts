import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';
import type {
  RagEvidenceSnapshot,
  RagEvidenceValidator,
} from '../application/ports/rag-evidence-validator.js';
import { currentPublicRagSource } from './rag-source-visibility.sql.js';

@Injectable()
export class PrismaRagEvidenceValidator implements RagEvidenceValidator {
  constructor(private readonly prisma: PrismaService) {}

  async areCurrent(
    evidence: readonly RagEvidenceSnapshot[],
    embeddingModel: string,
  ): Promise<boolean> {
    if (evidence.length === 0) return true;
    if (
      evidence.length > 5 ||
      !embeddingModel.trim() ||
      new Set(evidence.map((item) => item.chunkId)).size !== evidence.length ||
      evidence.some(
        (item) =>
          !/^[1-9][0-9]{0,18}$/.test(item.chunkId) ||
          BigInt(item.chunkId) > 9223372036854775807n,
      )
    )
      throw new RangeError('Invalid RAG evidence snapshot');

    const matches = evidence.map(
      (item) => Prisma.sql`(
      chunk."RagChunkId" = ${BigInt(item.chunkId)}
      AND document."SourceKey" = ${item.sourceKey}
      AND document."SourceType" = ${item.sourceType}
      AND document."SourceId" IS NOT DISTINCT FROM ${item.sourceId}::integer
      AND document."Title" = ${item.title}
      AND chunk."ChunkIndex" = ${item.chunkIndex}
      AND chunk."ChunkContent" = ${item.content}
    )`,
    );
    const result = await this.prisma.$queryRaw<
      Array<{ count: number }>
    >(Prisma.sql`
      SELECT COUNT(*)::integer AS "count"
      FROM "RagChunk" AS chunk
      INNER JOIN "RagDocument" AS document
        ON document."RagDocumentId" = chunk."RagDocumentId"
      WHERE document."Status" = 'indexed'
        AND document."ManualDisabled" = false
        AND chunk."EmbeddingModel" = ${embeddingModel}
        AND (${currentPublicRagSource()})
        AND (${Prisma.join(matches, ' OR ')})
    `);
    return result[0]?.count === evidence.length;
  }
}
