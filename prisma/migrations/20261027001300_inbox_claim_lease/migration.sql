ALTER TABLE "ConsumedEvent"
  ALTER COLUMN "ProcessedAt" DROP NOT NULL,
  ADD COLUMN "Status" VARCHAR(20) NOT NULL DEFAULT 'completed',
  ADD COLUMN "LockedAt" TIMESTAMPTZ(6),
  ADD COLUMN "LockToken" UUID;

ALTER TABLE "ConsumedEvent"
  ADD CONSTRAINT "ConsumedEvent_status_check"
    CHECK ("Status" IN ('pending', 'processing', 'completed')),
  ADD CONSTRAINT "ConsumedEvent_lease_check"
    CHECK (
      ("Status" = 'processing' AND "LockedAt" IS NOT NULL AND "LockToken" IS NOT NULL)
      OR ("Status" <> 'processing' AND "LockedAt" IS NULL AND "LockToken" IS NULL)
    ),
  ADD CONSTRAINT "ConsumedEvent_completed_check"
    CHECK (("Status" = 'completed') = ("ProcessedAt" IS NOT NULL));

CREATE INDEX "ConsumedEvent_Status_LockedAt_idx"
  ON "ConsumedEvent"("Status", "LockedAt");
