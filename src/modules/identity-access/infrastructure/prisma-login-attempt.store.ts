import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';
import type { LoginAttemptStore } from '../application/ports/login-attempt-store.js';
import {
  LOGIN_WINDOW_MS,
  loginLimitDecision,
  type LoginBucket,
} from '../domain/login-limit.js';
import { LoginBucketKeys } from './login-bucket-keys.js';

@Injectable()
export class PrismaLoginAttemptStore implements LoginAttemptStore {
  constructor(
    private readonly prisma: PrismaService,
    private readonly keys: LoginBucketKeys,
  ) {}
  async consume(account: string, clientIp: string) {
    const accountKey = this.keys.account(account),
      ipKey = this.keys.ip(clientIp);
    return this.prisma.$transaction(
      async (tx) => {
        // Deterministic order also covers absent rows; hash collisions only serialize.
        for (const key of [accountKey, ipKey].sort())
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text`;
        const rows = await tx.$queryRaw<
          Array<{ BucketKey: string; Attempts: number; ExpiresAt: Date }>
        >`
        SELECT "BucketKey", "Attempts", "ExpiresAt" FROM "LoginAttemptBucket"
        WHERE "BucketKey" IN (${accountKey}, ${ipKey}) ORDER BY "BucketKey" FOR UPDATE`;
        // clock_timestamp, not transaction start time: lock contention must not age windows.
        const [clock] = await tx.$queryRaw<
          Array<{ now: Date }>
        >`SELECT clock_timestamp() AS now`;
        const now = clock!.now;
        const buckets = new Map(
          rows.map((row) => [
            row.BucketKey,
            {
              attempts: row.Attempts,
              expiresAt: row.ExpiresAt,
            } satisfies LoginBucket,
          ]),
        );
        const decision = loginLimitDecision(
          now,
          buckets.get(accountKey),
          buckets.get(ipKey),
        );
        if (!decision.allowed) return decision;
        for (const key of [accountKey, ipKey].sort()) {
          const old = buckets.get(key),
            active = old && old.expiresAt > now;
          await tx.loginAttemptBucket.upsert({
            where: { BucketKey: key },
            create: {
              BucketKey: key,
              Attempts: 1,
              ExpiresAt: new Date(now.getTime() + LOGIN_WINDOW_MS),
            },
            update: {
              Attempts: active ? old.attempts + 1 : 1,
              ExpiresAt: active
                ? old.expiresAt
                : new Date(now.getTime() + LOGIN_WINDOW_MS),
            },
          });
        }
        return decision;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 2000,
        timeout: 5000,
      },
    );
  }
  async purgeExpired(): Promise<number> {
    return this.prisma.$executeRaw`
      WITH expired AS (
        SELECT "BucketKey" FROM "LoginAttemptBucket" WHERE "ExpiresAt" <= clock_timestamp()
        ORDER BY "ExpiresAt", "BucketKey" LIMIT 1000 FOR UPDATE SKIP LOCKED
      ) DELETE FROM "LoginAttemptBucket" b USING expired e WHERE b."BucketKey" = e."BucketKey"`;
  }
}
