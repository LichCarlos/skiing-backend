import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { readManagementWriteActor } from '../../identity-access/infrastructure/read-management-write-actor.js';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';
import { currentPublicRagSource } from './rag-source-visibility.sql.js';
import {
  RagSourceConflictError,
  RagSourceNotFoundError,
} from '../application/manage-rag-sources.js';
import type {
  ManagedRagStatus,
  RagSourceListInput,
  RagSourceManagementRepository,
  RagSourceVO,
} from '../application/ports/rag-source-management.repository.js';

const SOURCE_TYPES = [
  'resort',
  'article',
  'project_doc',
  'dynamic',
  'dictionary',
] as const;
const ADMIN_LIST = 'ai:knowledge:list';
const ADMIN_REINDEX = 'ai:knowledge:reindex';
const ADMIN_CONTROL = 'ai:knowledge:disable';
const SOURCE_SELECT = {
  RagDocumentId: true,
  SourceKey: true,
  LastFailureReason: true,
  LastFailureAt: true,
  SourceType: true,
  SourceId: true,
  Title: true,
  AccessScope: true,
  Status: true,
  ManualDisabled: true,
  ControlVersion: true,
  SourceUpdatedAt: true,
  IndexedAt: true,
  CreateTime: true,
} satisfies Prisma.RagDocumentSelect;
type SourceRow = Prisma.RagDocumentGetPayload<{ select: typeof SOURCE_SELECT }>;

interface SourceMetaRow {
  RagDocumentId: number;
  SourceEligible: boolean;
  ChunkCount: number;
  EmbeddingModels: string[];
}

@Injectable()
export class PrismaRagSourceManagementRepository implements RagSourceManagementRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: number, input: RagSourceListInput) {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await readManagementWriteActor(tx, userId, ADMIN_LIST, true);
          const where: Prisma.RagDocumentWhereInput = {
            SourceType: { in: [...SOURCE_TYPES] },
            ...(input.sourceType ? { SourceType: input.sourceType } : {}),
            ...(input.status ? { Status: input.status } : {}),
            ...(input.manualDisabled !== undefined
              ? { ManualDisabled: input.manualDisabled }
              : {}),
            ...(input.keyword
              ? {
                  OR: [
                    {
                      SourceKey: {
                        contains: input.keyword,
                        mode: 'insensitive',
                      },
                    },
                    { Title: { contains: input.keyword, mode: 'insensitive' } },
                  ],
                }
              : {}),
          };
          const [rows, total] = await Promise.all([
            tx.ragDocument.findMany({
              where,
              select: SOURCE_SELECT,
              orderBy: [{ CreateTime: 'desc' }, { RagDocumentId: 'desc' }],
              skip: (input.page - 1) * input.pageSize,
              take: input.pageSize,
            }),
            tx.ragDocument.count({ where }),
          ]);
          return {
            items: await this.mapSources(tx, rows),
            total,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
    } catch (error) {
      throw mapTransactionConflict(error);
    }
  }

  async find(
    userId: number,
    ragDocumentId: number,
  ): Promise<RagSourceVO | null> {
    return this.prisma.$transaction(
      async (tx) => {
        await readManagementWriteActor(tx, userId, ADMIN_LIST, true);
        const row = await tx.ragDocument.findFirst({
          where: {
            RagDocumentId: ragDocumentId,
            SourceType: { in: [...SOURCE_TYPES] },
          },
          select: SOURCE_SELECT,
        });
        if (!row) return null;
        return (await this.mapSources(tx, [row]))[0]!;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async reindex(
    userId: number,
    ragDocumentId: number,
    input: { expectedVersion: number; reason: string; traceId: string },
  ): Promise<{ source: RagSourceVO; eventId: string }> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const actor = await readManagementWriteActor(
            tx,
            userId,
            ADMIN_REINDEX,
            true,
          );
          const current = await this.lockSource(tx, ragDocumentId);
          assertExpectedVersion(current, input.expectedVersion);
          if (current.ManualDisabled)
            throw new RagSourceConflictError(
              'Manually disabled RAG sources cannot be reindexed',
            );
          assertVersionCanIncrement(current.ControlVersion);

          const eventId = randomUUID();
          const controlVersion = current.ControlVersion + 1;
          await tx.ragDocument.update({
            where: { RagDocumentId: ragDocumentId },
            data: {
              ControlVersion: controlVersion,
              IndexGeneration: { increment: 1n },
              Status: 'pending',
              IndexedAt: null,
            },
          });
          await enqueueReindex(tx, current, eventId, controlVersion);
          await appendAudit(tx, {
            actorUserId: userId,
            account: actor.account,
            actionKey: ADMIN_REINDEX,
            targetId: ragDocumentId,
            traceId: input.traceId,
            reason: input.reason,
            metadata: {
              beforeControlVersion: current.ControlVersion,
              afterControlVersion: controlVersion,
              manualDisabled: current.ManualDisabled,
              eventId,
            },
          });
          const source = (await this.loadSource(tx, ragDocumentId))!;
          return { source, eventId };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      throw mapTransactionConflict(error);
    }
  }

  async setEnabled(
    userId: number,
    ragDocumentId: number,
    input: {
      enabled: boolean;
      expectedVersion: number;
      reason: string;
      traceId: string;
    },
  ): Promise<{ source: RagSourceVO; eventId: string | null }> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const actor = await readManagementWriteActor(
            tx,
            userId,
            ADMIN_CONTROL,
            true,
          );
          const current = await this.lockSource(tx, ragDocumentId);
          assertExpectedVersion(current, input.expectedVersion);
          const currentlyEnabled = !current.ManualDisabled;
          if (currentlyEnabled === input.enabled) {
            return {
              source: (await this.loadSource(tx, ragDocumentId))!,
              eventId: null,
            };
          }
          assertVersionCanIncrement(current.ControlVersion);
          const controlVersion = current.ControlVersion + 1;
          let eventId: string | null = null;
          await tx.ragDocument.update({
            where: { RagDocumentId: ragDocumentId },
            data: {
              ManualDisabled: !input.enabled,
              ControlVersion: controlVersion,
              IndexGeneration: { increment: 1n },
              Status: input.enabled ? 'pending' : 'disabled',
              IndexedAt: null,
            },
          });
          if (input.enabled) {
            eventId = randomUUID();
            await enqueueReindex(tx, current, eventId, controlVersion);
          } else {
            await tx.ragChunk.deleteMany({
              where: { RagDocumentId: ragDocumentId },
            });
          }
          await appendAudit(tx, {
            actorUserId: userId,
            account: actor.account,
            actionKey: ADMIN_CONTROL,
            targetId: ragDocumentId,
            traceId: input.traceId,
            reason: input.reason,
            metadata: {
              beforeControlVersion: current.ControlVersion,
              afterControlVersion: controlVersion,
              beforeManualDisabled: current.ManualDisabled,
              afterManualDisabled: !input.enabled,
              eventId,
            },
          });
          return {
            source: (await this.loadSource(tx, ragDocumentId))!,
            eventId,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      throw mapTransactionConflict(error);
    }
  }

  private async lockSource(tx: Prisma.TransactionClient, id: number) {
    const rows = await tx.$queryRaw<
      {
        RagDocumentId: number;
        SourceKey: string;
        SourceType: string;
        SourceId: number | null;
        ManualDisabled: boolean;
        ControlVersion: number;
      }[]
    >(Prisma.sql`
      SELECT "RagDocumentId", "SourceKey", "SourceType", "SourceId",
             "ManualDisabled", "ControlVersion"
      FROM "RagDocument"
      WHERE "RagDocumentId" = ${id}
        AND "SourceType" IN (${Prisma.join(SOURCE_TYPES)})
      FOR UPDATE
    `);
    if (!rows[0]) throw new RagSourceNotFoundError();
    return rows[0];
  }

  private async loadSource(tx: Prisma.TransactionClient, id: number) {
    const row = await tx.ragDocument.findFirst({
      where: {
        RagDocumentId: id,
        SourceType: { in: [...SOURCE_TYPES] },
      },
      select: SOURCE_SELECT,
    });
    return row ? (await this.mapSources(tx, [row]))[0]! : null;
  }

  private async mapSources(
    tx: Prisma.TransactionClient,
    rows: SourceRow[],
  ): Promise<RagSourceVO[]> {
    if (rows.length === 0) return [];
    const ids = rows.map(({ RagDocumentId }) => RagDocumentId);
    const [eligibility, chunks] = await Promise.all([
      tx.$queryRaw<{ RagDocumentId: number; SourceEligible: boolean }[]>(
        Prisma.sql`
          SELECT document."RagDocumentId",
                 (${currentPublicRagSource()}) AS "SourceEligible"
          FROM "RagDocument" AS document
          WHERE document."RagDocumentId" IN (${Prisma.join(ids)})
        `,
      ),
      tx.$queryRaw<SourceMetaRow[]>(Prisma.sql`
        SELECT "RagDocumentId", COUNT(*)::integer AS "ChunkCount",
               COALESCE(ARRAY_AGG(DISTINCT "EmbeddingModel" COLLATE "C" ORDER BY "EmbeddingModel" COLLATE "C"), ARRAY[]::text[])
                 AS "EmbeddingModels"
        FROM "RagChunk"
        WHERE "RagDocumentId" IN (${Prisma.join(ids)})
        GROUP BY "RagDocumentId"
      `),
    ]);
    const eligibleById = new Map(
      eligibility.map((row) => [row.RagDocumentId, row.SourceEligible]),
    );
    const chunksById = new Map(chunks.map((row) => [row.RagDocumentId, row]));
    return rows.map((row) => {
      const meta = chunksById.get(row.RagDocumentId);
      return {
        ragDocumentId: row.RagDocumentId,
        sourceKey: row.SourceKey,
        sourceType: row.SourceType as RagSourceVO['sourceType'],
        sourceId: row.SourceId,
        title: row.Title,
        accessScope: row.AccessScope as RagSourceVO['accessScope'],
        status: row.Status as ManagedRagStatus,
        manualDisabled: row.ManualDisabled,
        controlVersion: row.ControlVersion,
        sourceEligible: eligibleById.get(row.RagDocumentId) ?? false,
        chunkCount: meta?.ChunkCount ?? 0,
        embeddingModels: meta?.EmbeddingModels ?? [],
        embeddingDimension: 1024,
        sourceUpdatedAt: row.SourceUpdatedAt,
        indexedAt: row.IndexedAt,
        createdAt: row.CreateTime,
        failureReason: row.LastFailureReason ?? null,
        failureAt: row.LastFailureAt ?? null,
        failureCode: row.Status === 'failed' ? 'indexing_failed' : null,
      };
    });
  }
}

async function enqueueReindex(
  tx: Prisma.TransactionClient,
  source: {
    RagDocumentId: number;
    SourceKey: string;
    SourceType: string;
    SourceId: number | null;
  },
  eventId: string,
  controlVersion: number,
): Promise<void> {
  await tx.outboxEvent.create({
    data: {
      EventId: eventId,
      EventType: 'rag.source.reindex-requested.v1',
      AggregateType: 'RagDocument',
      AggregateId: String(source.RagDocumentId),
      Payload: {
        ragDocumentId: source.RagDocumentId,
        sourceKey: source.SourceKey,
        sourceType: source.SourceType,
        sourceId: source.SourceId,
        controlVersion,
      },
    },
  });
}

async function appendAudit(
  tx: Prisma.TransactionClient,
  input: {
    actorUserId: number;
    account: string;
    actionKey: string;
    targetId: number;
    traceId: string;
    reason: string;
    metadata: Prisma.InputJsonObject;
  },
) {
  await tx.operationLog.create({
    data: {
      ActorUserId: input.actorUserId,
      ActorAccountSnapshot: input.account,
      ActionKey: input.actionKey,
      ResourceKey: 'ai:knowledge',
      TargetType: 'RagDocument',
      TargetId: String(input.targetId),
      Result: 'success',
      Reason: input.reason,
      TraceId: input.traceId,
      Metadata: input.metadata,
    },
  });
}

function assertExpectedVersion(
  current: { ControlVersion: number },
  expectedVersion: number,
): void {
  if (current.ControlVersion !== expectedVersion) {
    throw new RagSourceConflictError('RAG source control version is stale');
  }
}

function assertVersionCanIncrement(version: number): void {
  if (version >= 2_147_483_647) {
    throw new RagSourceConflictError('RAG source control version is exhausted');
  }
}

function mapTransactionConflict(error: unknown): unknown {
  const rawCode =
    isRecord(error) && error.code === 'P2010' && isRecord(error.meta)
      ? error.meta.code
      : undefined;
  if (
    isRecord(error) &&
    (error.code === 'P2034' ||
      error.code === '40001' ||
      error.code === '40P01' ||
      rawCode === '40001' ||
      rawCode === '40P01')
  ) {
    return new RagSourceConflictError(
      'RAG source changed concurrently; reload before retrying',
    );
  }
  return error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
