import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';
import type {
  RagDocumentWriter,
  RagIndexClaim,
  RagIndexDocument,
  RagIndexedChunk,
  RagIndexOptions,
} from '../application/ports/rag-document-writer.js';

const EMBEDDING_DIMENSION = 1024;
const INSERT_BATCH_SIZE = 100;

interface LockedDocument {
  RagDocumentId: number;
  ContentHash: string;
  Status: string;
  ManualDisabled: boolean;
  ControlVersion: number;
  IndexGeneration: bigint;
}

@Injectable()
export class PrismaRagDocumentWriter implements RagDocumentWriter {
  constructor(private readonly prisma: PrismaService) {}

  beginIndexing(
    document: RagIndexDocument,
    contentHash: string,
    embeddingModel: string,
    chunkCount: number,
    options: RagIndexOptions = {},
  ): Promise<RagIndexClaim> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "RagDocument"
          ("SourceKey", "SourceType", "SourceId", "Title", "Content",
           "AccessScope", "MerchantId", "Status", "ContentHash", "Metadata",
           "SourceUpdatedAt")
        VALUES (
          ${document.sourceKey}, ${document.sourceType}, ${document.sourceId},
          ${document.title}, ${document.content}, ${document.accessScope},
          ${document.merchantId}, 'pending', ${contentHash},
          ${JSON.stringify({ sourceState: document.sourceState ?? null })}::jsonb,
          ${document.sourceUpdatedAt}
        )
        ON CONFLICT ("SourceKey") DO NOTHING
      `);
      const rows = await tx.$queryRaw<LockedDocument[]>(Prisma.sql`
        SELECT "RagDocumentId", "ContentHash", "Status", "ManualDisabled",
               "ControlVersion", "IndexGeneration"
        FROM "RagDocument"
        WHERE "SourceKey" = ${document.sourceKey}
        FOR UPDATE
      `);
      const current = rows[0];
      if (!current) throw new Error('RAG document could not be claimed');
      if (
        options.expectedControlVersion !== undefined &&
        current.ControlVersion !== options.expectedControlVersion
      ) {
        return { kind: 'stale' };
      }
      if (current.ManualDisabled) return { kind: 'manual-disabled' };

      if (
        !options.force &&
        current.ContentHash === contentHash &&
        current.Status === 'indexed'
      ) {
        const counts = await tx.$queryRaw<
          { total: bigint; matchingModel: bigint }[]
        >(Prisma.sql`
          SELECT COUNT(*)::bigint AS total,
                 COUNT(*) FILTER (WHERE "EmbeddingModel" = ${embeddingModel})::bigint
                   AS "matchingModel"
          FROM "RagChunk"
          WHERE "RagDocumentId" = ${current.RagDocumentId}
        `);
        if (
          counts[0]?.total === BigInt(chunkCount) &&
          counts[0]?.matchingModel === BigInt(chunkCount)
        ) {
          return { kind: 'skip' };
        }
      }

      const indexGeneration = current.IndexGeneration + 1n;
      await tx.ragDocument.update({
        where: { RagDocumentId: current.RagDocumentId },
        data: {
          SourceType: document.sourceType,
          SourceId: document.sourceId,
          Title: document.title,
          Content: document.content,
          AccessScope: document.accessScope,
          MerchantId: document.merchantId,
          Status: 'pending',
          IndexStartedAt: new Date(),
          LastFailureReason: null,
          LastFailureAt: null,
          ContentHash: contentHash,
          Metadata: {
            sourceState: (document.sourceState ??
              null) as Prisma.InputJsonValue,
          },
          SourceUpdatedAt: document.sourceUpdatedAt,
          IndexedAt: null,
          IndexGeneration: indexGeneration,
        },
      });
      return {
        kind: 'claimed',
        ragDocumentId: current.RagDocumentId,
        controlVersion: current.ControlVersion,
        indexGeneration,
      };
    });
  }

  async replaceChunksAndMarkIndexed(
    sourceKey: string,
    contentHash: string,
    embeddingModel: string,
    claim: Extract<RagIndexClaim, { kind: 'claimed' }>,
    chunks: readonly RagIndexedChunk[],
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.ragDocument.updateMany({
        where: {
          RagDocumentId: claim.ragDocumentId,
          SourceKey: sourceKey,
          ContentHash: contentHash,
          Status: 'pending',
          ManualDisabled: false,
          ControlVersion: claim.controlVersion,
          IndexGeneration: claim.indexGeneration,
        },
        data: { Status: 'pending' },
      });
      if (locked.count !== 1) return false;
      if (chunks.length === 0) throw new Error('RAG document has no chunks');

      await tx.ragChunk.deleteMany({
        where: { RagDocumentId: claim.ragDocumentId },
      });
      for (
        let offset = 0;
        offset < chunks.length;
        offset += INSERT_BATCH_SIZE
      ) {
        const batch = chunks.slice(offset, offset + INSERT_BATCH_SIZE);
        const values = batch.map((chunk) => {
          validateEmbedding(chunk.embedding);
          const vector = `[${chunk.embedding.join(',')}]`;
          return Prisma.sql`(
            ${claim.ragDocumentId}, ${chunk.index}, ${chunk.content},
            ${vector}${Prisma.raw(`::vector(${EMBEDDING_DIMENSION})`)}, ${embeddingModel}
          )`;
        });
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO "RagChunk"
            ("RagDocumentId", "ChunkIndex", "ChunkContent", "Embedding", "EmbeddingModel")
          VALUES ${Prisma.join(values)}
        `);
      }

      const completed = await tx.ragDocument.updateMany({
        where: {
          RagDocumentId: claim.ragDocumentId,
          SourceKey: sourceKey,
          ContentHash: contentHash,
          Status: 'pending',
          ManualDisabled: false,
          ControlVersion: claim.controlVersion,
          IndexGeneration: claim.indexGeneration,
        },
        data: {
          Status: 'indexed',
          IndexedAt: new Date(),
          LastFailureReason: null,
          LastFailureAt: null,
        },
      });
      if (completed.count !== 1) {
        throw new Error('RAG document changed while committing chunks');
      }
      return true;
    });
  }

  async markFailed(
    sourceKey: string,
    contentHash: string,
    claim: Extract<RagIndexClaim, { kind: 'claimed' }>,
    reason: 'embedding_failed' | 'index_commit_failed' = 'embedding_failed',
  ): Promise<boolean> {
    const result = await this.prisma.ragDocument.updateMany({
      where: {
        RagDocumentId: claim.ragDocumentId,
        SourceKey: sourceKey,
        ContentHash: contentHash,
        Status: 'pending',
        ManualDisabled: false,
        ControlVersion: claim.controlVersion,
        IndexGeneration: claim.indexGeneration,
      },
      data: {
        Status: 'failed',
        IndexedAt: null,
        LastFailureReason: reason,
        LastFailureAt: new Date(),
      },
    });
    return result.count === 1;
  }

  async isCurrentCommand(
    sourceKey: string,
    controlVersion: number,
  ): Promise<boolean> {
    const document = await this.prisma.ragDocument.findUnique({
      where: { SourceKey: sourceKey },
      select: { ControlVersion: true, ManualDisabled: true },
    });
    return (
      document?.ControlVersion === controlVersion && !document.ManualDisabled
    );
  }

  async disable(
    sourceKey: string,
    expectedControlVersion?: number,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<LockedDocument[]>(Prisma.sql`
        SELECT "RagDocumentId", "ContentHash", "Status", "ManualDisabled",
               "ControlVersion", "IndexGeneration"
        FROM "RagDocument"
        WHERE "SourceKey" = ${sourceKey}
        FOR UPDATE
      `);
      const document = rows[0];
      if (
        !document ||
        (expectedControlVersion !== undefined &&
          document.ControlVersion !== expectedControlVersion)
      ) {
        return false;
      }
      await tx.ragDocument.update({
        where: { RagDocumentId: document.RagDocumentId },
        data: {
          Status: 'disabled',
          LastFailureReason: 'source_unavailable',
          LastFailureAt: new Date(),
          IndexedAt: null,
          IndexGeneration: document.IndexGeneration + 1n,
        },
      });
      await tx.ragChunk.deleteMany({
        where: { RagDocumentId: document.RagDocumentId },
      });
      return true;
    });
  }
}

function validateEmbedding(embedding: readonly number[]): void {
  if (
    embedding.length !== EMBEDDING_DIMENSION ||
    embedding.some((value) => !Number.isFinite(value))
  ) {
    throw new RangeError(
      `RAG chunk embedding must contain ${EMBEDDING_DIMENSION} finite numbers`,
    );
  }
}
