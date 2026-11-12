CREATE TABLE "RevenueImportJob" (
  "JobId" UUID NOT NULL,
  "ActorUserId" INTEGER NOT NULL,
  "RequestId" UUID NOT NULL,
  "FileHash" CHAR(64) NOT NULL,
  "Status" VARCHAR(20) NOT NULL DEFAULT 'pending',
  "TotalRows" INTEGER NOT NULL,
  "ProcessedRows" INTEGER NOT NULL DEFAULT 0,
  "SucceededRows" INTEGER NOT NULL DEFAULT 0,
  "FailedRows" INTEGER NOT NULL DEFAULT 0,
  "FailureAttempts" INTEGER NOT NULL DEFAULT 0,
  "LockToken" UUID,
  "LeaseUntil" TIMESTAMPTZ(6),
  "NextAttemptAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "TerminalAt" TIMESTAMPTZ(6),
  "InputExpiresAt" TIMESTAMPTZ(6),
  "ResultExpiresAt" TIMESTAMPTZ(6),
  "InputsPurgedAt" TIMESTAMPTZ(6),
  "ResultsPurgedAt" TIMESTAMPTZ(6),
  "TraceId" VARCHAR(100) NOT NULL,
  "ClientIp" VARCHAR(64),
  "UserAgent" VARCHAR(500),
  "CreateTime" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "UpdateTime" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RevenueImportJob_pkey" PRIMARY KEY ("JobId"),
  CONSTRAINT "RevenueImportJob_state_check" CHECK (
    "ActorUserId" > 0 AND "Status" IN ('pending','processing','completed','failed')
    AND "TotalRows" BETWEEN 0 AND 5000 AND "ProcessedRows" BETWEEN 0 AND "TotalRows"
    AND "SucceededRows" >= 0 AND "FailedRows" >= 0
    AND "ProcessedRows" = "SucceededRows" + "FailedRows"
    AND "FailureAttempts" BETWEEN 0 AND 8
  ),
  CONSTRAINT "RevenueImportJob_lease_check" CHECK (
    ("Status" = 'processing' AND "LockToken" IS NOT NULL AND "LeaseUntil" IS NOT NULL)
    OR ("Status" <> 'processing' AND "LockToken" IS NULL AND "LeaseUntil" IS NULL)
  ),
  CONSTRAINT "RevenueImportJob_retention_check" CHECK (
    ("Status" IN ('pending','processing') AND "TerminalAt" IS NULL AND "InputExpiresAt" IS NULL AND "ResultExpiresAt" IS NULL)
    OR ("Status" IN ('completed','failed') AND "TerminalAt" IS NOT NULL AND "InputExpiresAt" > "TerminalAt"
      AND "ResultExpiresAt" > "InputExpiresAt" AND "ProcessedRows" = "TotalRows")
  )
);
CREATE UNIQUE INDEX "RevenueImportJob_ActorUserId_RequestId_key" ON "RevenueImportJob" ("ActorUserId","RequestId");
CREATE INDEX "RevenueImportJob_Status_NextAttemptAt_LeaseUntil_idx" ON "RevenueImportJob" ("Status","NextAttemptAt","LeaseUntil");
CREATE INDEX "RevenueImportJob_InputExpiresAt_idx" ON "RevenueImportJob" ("InputExpiresAt");
CREATE INDEX "RevenueImportJob_ResultExpiresAt_idx" ON "RevenueImportJob" ("ResultExpiresAt");
CREATE TABLE "RevenueImportRow" (
  "JobId" UUID NOT NULL,
  "RowNumber" INTEGER NOT NULL,
  "Input" JSONB,
  "Status" VARCHAR(20) NOT NULL DEFAULT 'pending',
  "RevenueId" INTEGER,
  "Error" VARCHAR(100),
  CONSTRAINT "RevenueImportRow_pkey" PRIMARY KEY ("JobId","RowNumber"),
  CONSTRAINT "RevenueImportRow_JobId_fkey" FOREIGN KEY ("JobId") REFERENCES "RevenueImportJob"("JobId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RevenueImportRow_state_check" CHECK (
    "RowNumber" BETWEEN 2 AND 5001 AND (
      ("Status"='pending' AND "Input" IS NOT NULL AND "RevenueId" IS NULL AND "Error" IS NULL)
      OR ("Status"='succeeded' AND "RevenueId" > 0 AND "Error" IS NULL)
      OR ("Status"='failed' AND "RevenueId" IS NULL AND "Error" IS NOT NULL)
    )
  )
);
CREATE INDEX "RevenueImportRow_JobId_Status_RowNumber_idx" ON "RevenueImportRow" ("JobId","Status","RowNumber");
