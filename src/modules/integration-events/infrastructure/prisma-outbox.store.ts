import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  ClaimedOutboxEvent,
  IntegrationEvent,
} from '../domain/integration-event.js';
import type {
  OutboxStore,
  TransactionContext,
} from '../application/ports/outbox-store.js';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';

interface OutboxRow {
  EventId: string;
  EventType: string;
  AggregateType: string;
  AggregateId: string;
  Payload: Prisma.JsonValue;
  OccurredAt: Date;
  Attempts: number;
  MaxAttempts: number;
  LockToken: string | null;
}

@Injectable()
export class PrismaOutboxStore implements OutboxStore {
  constructor(private readonly prisma: PrismaService) {}

  async append(
    transaction: TransactionContext,
    event: IntegrationEvent,
  ): Promise<void> {
    const tx = transaction as unknown as Prisma.TransactionClient;
    await tx.outboxEvent.create({
      data: {
        EventId: event.eventId,
        EventType: event.eventType,
        AggregateType: event.aggregateType,
        AggregateId: event.aggregateId,
        Payload: event.payload as Prisma.InputJsonObject,
        OccurredAt: event.occurredAt,
      },
    });
  }

  async claimBatch(
    limit: number,
    leaseMilliseconds: number,
  ): Promise<ClaimedOutboxEvent[]> {
    const rows = await this.prisma.$transaction((tx) =>
      tx.$queryRaw<OutboxRow[]>(Prisma.sql`
        WITH candidates AS (
          SELECT "EventId"
          FROM "OutboxEvent"
          WHERE ("Status" = 'pending' AND "AvailableAt" <= NOW())
             OR ("Status" = 'processing' AND "LockedAt" <= NOW() - (${leaseMilliseconds} * INTERVAL '1 millisecond'))
          ORDER BY "CreatedAt", "EventId"
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        )
        UPDATE "OutboxEvent" AS event
        SET "Status" = 'processing',
            "LockedAt" = NOW(),
            "LockToken" = gen_random_uuid(),
            "Attempts" = event."Attempts" + 1
        FROM candidates
        WHERE event."EventId" = candidates."EventId"
        RETURNING event."EventId", event."EventType", event."AggregateType",
                  event."AggregateId", event."Payload", event."OccurredAt",
                  event."Attempts", event."MaxAttempts", event."LockToken"
      `),
    );

    return rows.map((row) => {
      if (row.LockToken === null) {
        throw new Error(
          `Claimed outbox event ${row.EventId} has no lease token`,
        );
      }
      return {
        eventId: row.EventId,
        eventType: row.EventType,
        aggregateType: row.AggregateType,
        aggregateId: row.AggregateId,
        occurredAt: row.OccurredAt,
        payload: asObjectPayload(row.Payload),
        attempts: row.Attempts,
        maxAttempts: row.MaxAttempts,
        lockToken: row.LockToken,
      };
    });
  }

  async markPublished(
    event: ClaimedOutboxEvent,
    publishedAt: Date,
  ): Promise<boolean> {
    const result = await this.prisma.outboxEvent.updateMany({
      where: {
        EventId: event.eventId,
        Status: 'processing',
        LockToken: event.lockToken,
      },
      data: {
        Status: 'published',
        PublishedAt: publishedAt,
        LockedAt: null,
        LockToken: null,
        LastError: null,
      },
    });
    return result.count === 1;
  }

  async scheduleRetry(
    event: ClaimedOutboxEvent,
    availableAt: Date,
    error: string,
  ): Promise<boolean> {
    const result = await this.prisma.outboxEvent.updateMany({
      where: {
        EventId: event.eventId,
        Status: 'processing',
        LockToken: event.lockToken,
      },
      data: {
        Status: 'pending',
        AvailableAt: availableAt,
        LockedAt: null,
        LockToken: null,
        LastError: error,
      },
    });
    return result.count === 1;
  }

  async markFailed(event: ClaimedOutboxEvent, error: string): Promise<boolean> {
    const result = await this.prisma.outboxEvent.updateMany({
      where: {
        EventId: event.eventId,
        Status: 'processing',
        LockToken: event.lockToken,
      },
      data: {
        Status: 'failed',
        LockedAt: null,
        LockToken: null,
        LastError: error,
      },
    });
    return result.count === 1;
  }
}

function asObjectPayload(value: Prisma.JsonValue): IntegrationEvent['payload'] {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new Error('Outbox event payload must be a JSON object');
  }
  return value as IntegrationEvent['payload'];
}
