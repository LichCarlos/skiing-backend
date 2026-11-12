CREATE TABLE "RevenueWriteRequest" (
  "ActorUserId" INTEGER NOT NULL,
  "Operation" VARCHAR(50) NOT NULL,
  "RequestId" UUID NOT NULL,
  "RequestHash" CHAR(64) NOT NULL,
  "Result" JSONB,
  "CreateTime" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "CompletedAt" TIMESTAMPTZ(6) NOT NULL,
  "ExpiresAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "RevenueWriteRequest_pkey" PRIMARY KEY ("ActorUserId", "Operation", "RequestId"),
  CONSTRAINT "RevenueWriteRequest_Operation_check" CHECK ("Operation" = 'revenue.upsert'),
  CONSTRAINT "RevenueWriteRequest_Actor_check" CHECK ("ActorUserId" > 0),
  CONSTRAINT "RevenueWriteRequest_Expiry_check" CHECK ("ExpiresAt" > "CompletedAt")
);
CREATE INDEX "RevenueWriteRequest_ExpiresAt_idx" ON "RevenueWriteRequest" ("ExpiresAt");
