import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';

import type {
  ConsumedEventIdentity,
  InboxClaim,
  InboxLease,
} from '../application/ports/inbox-lease.js';
export type {
  ConsumedEventIdentity,
  InboxClaim,
} from '../application/ports/inbox-lease.js';

@Injectable()
export class PrismaInboxExecutor implements InboxLease {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Atomically claims an event for an effect that is not part of the Prisma
   * transaction (for example, an embedding provider call). A completed event
   * is never claimed again. An abandoned processing lease can be reclaimed so
   * a worker crash does not permanently lose the event.
   */
  async claim(
    identity: ConsumedEventIdentity,
    leaseMilliseconds = 10 * 60 * 1_000,
  ): Promise<InboxClaim | null> {
    const lockToken = randomUUID();
    return this.prisma.$transaction(async (transaction) => {
      const inserted = await transaction.consumedEvent.createMany({
        data: {
          ConsumerKey: identity.consumerKey,
          EventId: identity.eventId,
          EventType: identity.eventType,
          Status: 'processing',
          LockedAt: new Date(),
          LockToken: lockToken,
          ProcessedAt: null,
        },
        skipDuplicates: true,
      });
      if (inserted.count === 1) return { lockToken };

      const rows = await transaction.$queryRaw<{ LockToken: string }[]>(
        Prisma.sql`
          UPDATE "ConsumedEvent"
             SET "Status" = 'processing',
                 "LockedAt" = NOW(),
                 "LockToken" = ${lockToken}::uuid,
                 "ProcessedAt" = NULL
           WHERE "ConsumerKey" = ${identity.consumerKey}
             AND "EventId" = ${identity.eventId}::uuid
             AND "Status" <> 'completed'
             AND (
               "Status" <> 'processing'
               OR "LockedAt" <= NOW() - (${leaseMilliseconds} * INTERVAL '1 millisecond')
             )
         RETURNING "LockToken"
        `,
      );
      return rows[0]?.LockToken ? { lockToken: rows[0].LockToken } : null;
    });
  }

  async complete(
    identity: ConsumedEventIdentity,
    claim: InboxClaim,
  ): Promise<boolean> {
    const result = await this.prisma.consumedEvent.updateMany({
      where: {
        ConsumerKey: identity.consumerKey,
        EventId: identity.eventId,
        Status: 'processing',
        LockToken: claim.lockToken,
      },
      data: {
        Status: 'completed',
        ProcessedAt: new Date(),
        LockedAt: null,
        LockToken: null,
      },
    });
    return result.count === 1;
  }

  async release(
    identity: ConsumedEventIdentity,
    claim: InboxClaim,
  ): Promise<boolean> {
    const result = await this.prisma.consumedEvent.updateMany({
      where: {
        ConsumerKey: identity.consumerKey,
        EventId: identity.eventId,
        Status: 'processing',
        LockToken: claim.lockToken,
      },
      data: {
        Status: 'pending',
        ProcessedAt: null,
        LockedAt: null,
        LockToken: null,
      },
    });
    return result.count === 1;
  }

  executeOnce(
    identity: ConsumedEventIdentity,
    effect: (transaction: Prisma.TransactionClient) => Promise<void>,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      const inserted = await transaction.consumedEvent.createMany({
        data: {
          ConsumerKey: identity.consumerKey,
          EventId: identity.eventId,
          EventType: identity.eventType,
          Status: 'completed',
          ProcessedAt: new Date(),
        },
        skipDuplicates: true,
      });

      if (inserted.count === 0) return false;
      await effect(transaction);
      return true;
    });
  }

  async isProcessed(identity: ConsumedEventIdentity): Promise<boolean> {
    return (
      (await this.prisma.consumedEvent.count({
        where: {
          ConsumerKey: identity.consumerKey,
          EventId: identity.eventId,
          Status: 'completed',
        },
      })) > 0
    );
  }

  async recordProcessed(identity: ConsumedEventIdentity): Promise<boolean> {
    const result = await this.prisma.consumedEvent.createMany({
      data: {
        ConsumerKey: identity.consumerKey,
        EventId: identity.eventId,
        EventType: identity.eventType,
        Status: 'completed',
        ProcessedAt: new Date(),
      },
      skipDuplicates: true,
    });
    return result.count === 1;
  }
}
