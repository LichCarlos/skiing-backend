CREATE TABLE "OutboxEvent" (
    "EventId" UUID NOT NULL,
    "EventType" VARCHAR(200) NOT NULL,
    "AggregateType" VARCHAR(100) NOT NULL,
    "AggregateId" VARCHAR(100) NOT NULL,
    "Payload" JSONB NOT NULL,
    "Status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "Attempts" INTEGER NOT NULL DEFAULT 0,
    "MaxAttempts" INTEGER NOT NULL DEFAULT 8,
    "AvailableAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "LockedAt" TIMESTAMPTZ(6),
    "LockToken" UUID,
    "LastError" TEXT,
    "OccurredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "PublishedAt" TIMESTAMPTZ(6),
    "CreatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("EventId"),
    CONSTRAINT "OutboxEvent_status_check" CHECK ("Status" IN ('pending', 'processing', 'published', 'failed')),
    CONSTRAINT "OutboxEvent_attempts_check" CHECK ("Attempts" >= 0 AND "MaxAttempts" > 0),
    CONSTRAINT "OutboxEvent_lease_check" CHECK (
        ("Status" = 'processing' AND "LockedAt" IS NOT NULL AND "LockToken" IS NOT NULL)
        OR ("Status" <> 'processing' AND "LockedAt" IS NULL AND "LockToken" IS NULL)
    ),
    CONSTRAINT "OutboxEvent_published_check" CHECK (("Status" = 'published') = ("PublishedAt" IS NOT NULL))
);

CREATE INDEX "OutboxEvent_Status_AvailableAt_CreatedAt_idx"
ON "OutboxEvent"("Status", "AvailableAt", "CreatedAt");

CREATE INDEX "OutboxEvent_AggregateType_AggregateId_CreatedAt_idx"
ON "OutboxEvent"("AggregateType", "AggregateId", "CreatedAt");

CREATE TABLE "ConsumedEvent" (
    "ConsumerKey" VARCHAR(150) NOT NULL,
    "EventId" UUID NOT NULL,
    "EventType" VARCHAR(200) NOT NULL,
    "ProcessedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConsumedEvent_pkey" PRIMARY KEY ("ConsumerKey", "EventId")
);

CREATE INDEX "ConsumedEvent_ProcessedAt_idx"
ON "ConsumedEvent"("ProcessedAt");
