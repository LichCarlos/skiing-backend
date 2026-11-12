CREATE TABLE "LoginAttemptBucket" (
  "BucketKey" CHAR(64) NOT NULL,
  "Attempts" INTEGER NOT NULL,
  "ExpiresAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "LoginAttemptBucket_pkey" PRIMARY KEY ("BucketKey"),
  CONSTRAINT "LoginAttemptBucket_Attempts_check" CHECK ("Attempts" BETWEEN 1 AND 30),
  CONSTRAINT "LoginAttemptBucket_Key_check" CHECK ("BucketKey" ~ '^[0-9a-f]{64}$')
);
CREATE INDEX "LoginAttemptBucket_ExpiresAt_idx" ON "LoginAttemptBucket"("ExpiresAt");
