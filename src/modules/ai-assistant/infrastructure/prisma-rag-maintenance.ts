import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';
import { currentPublicRagSource } from './rag-source-visibility.sql.js';
import { appendOutboxEvent } from '../../integration-events/infrastructure/append-outbox-event.js';

@Injectable()
export class PrismaRagMaintenance {
  constructor(private readonly prisma: PrismaService) {}
  async sweep(input: {
    apply: boolean;
    afterId?: number;
    batchSize?: number;
    minAgeHours?: number;
  }) {
    const after = input.afterId ?? 0,
      batch = input.batchSize ?? 100,
      age = input.minAgeHours ?? 24;
    if (
      !Number.isInteger(after) ||
      after < 0 ||
      !Number.isInteger(batch) ||
      batch < 1 ||
      batch > 500 ||
      !Number.isInteger(age) ||
      age < 24 ||
      age > 8760
    )
      throw new RangeError('Invalid maintenance limits');
    return this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<
          {
            RagDocumentId: number;
            SourceType: string;
            SourceId: number | null;
            SourceKey: string;
            Status: string;
            ManualDisabled: boolean;
          }[]
        >(Prisma.sql`
        SELECT document."RagDocumentId",document."SourceType",document."SourceId",document."SourceKey",document."Status",document."ManualDisabled"
        FROM "RagDocument" document
        WHERE document."RagDocumentId">${after} AND document."AccessScope"='public'
          AND COALESCE(document."IndexStartedAt",document."CreateTime") <= NOW()-(${age}*INTERVAL '1 hour')
          AND (document."ManualDisabled" OR document."Status"='pending' OR (${currentPublicRagSource()}) IS NOT TRUE)
          AND (document."Content"<>'' OR document."Status" IN ('pending','failed') OR EXISTS(SELECT 1 FROM "RagChunk" c WHERE c."RagDocumentId"=document."RagDocumentId"))
        ORDER BY document."RagDocumentId" LIMIT ${batch} ${input.apply ? Prisma.sql`FOR UPDATE OF document SKIP LOCKED` : Prisma.empty}`);
        if (input.apply)
          for (const row of rows) {
            await tx.ragChunk.deleteMany({
              where: { RagDocumentId: row.RagDocumentId },
            });
            await tx.ragDocument.update({
              where: { RagDocumentId: row.RagDocumentId },
              data: {
                Status: 'disabled',
                Content: '',
                Metadata: Prisma.DbNull,
                IndexedAt: null,
                IndexGeneration: { increment: 1 },
                LastFailureReason:
                  row.Status === 'pending'
                    ? 'index_lease_expired'
                    : 'stale_index_cleaned',
                LastFailureAt: new Date(),
              },
            });
            // Rebuild from current authoritative data. Old dictionary source keys stay
            // cleared; the dictionary handler resolves the current key by item ID.
            const requeued =
              !row.ManualDisabled && row.SourceId !== null
                ? await requeue(tx, row)
                : false;
            await tx.operationLog.create({
              data: {
                ActorUserId: null,
                ActorAccountSnapshot: 'system:maintenance',
                ActionKey: 'ai:index:cleanup',
                ResourceKey: 'rag',
                TargetType: 'RagDocument',
                TargetId: String(row.RagDocumentId),
                Result: 'success',
                Reason:
                  row.Status === 'pending'
                    ? 'index_lease_expired'
                    : 'stale_index_cleaned',
                TraceId: randomUUID(),
                Metadata: {
                  sourceType: row.SourceType,
                  chunksRemoved: true,
                  requeue: requeued,
                },
              },
            });
          }
        return {
          dryRun: !input.apply,
          candidates: rows.length,
          cleaned: input.apply ? rows.length : 0,
          nextCursor: rows.at(-1)?.RagDocumentId ?? null,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 30000,
      },
    );
  }
}
async function requeue(
  tx: Prisma.TransactionClient,
  row: { SourceType: string; SourceId: number | null; SourceKey: string },
) {
  const config: Record<string, { key: string; event: string }> = {
    resort: { key: 'resortId', event: 'resort.changed.v1' },
    article: { key: 'articleId', event: 'article.changed.v1' },
    dynamic: { key: 'dynamicId', event: 'dynamic.changed.v1' },
    project_doc: { key: 'projectKnowledgeId', event: 'project_doc.changed.v1' },
  };
  const item = config[row.SourceType];
  if (item) {
    await appendOutboxEvent(tx, {
      eventType: item.event,
      aggregateType: 'RagMaintenance',
      aggregateId: String(row.SourceId),
      payload: { [item.key]: row.SourceId },
    });
    return true;
  }
  if (row.SourceType === 'dictionary') {
    const dictionary = await tx.dictionaryItem.findUnique({
      where: { ItemId: row.SourceId! },
      select: { DictType: true },
    });
    if (dictionary) {
      await appendOutboxEvent(tx, {
        eventType: 'dictionary.changed.v1',
        aggregateType: 'DictionaryItem',
        aggregateId: String(row.SourceId),
        payload: { itemId: row.SourceId, dictType: dictionary.DictType },
      });
      return true;
    }
  }
  return false;
}
