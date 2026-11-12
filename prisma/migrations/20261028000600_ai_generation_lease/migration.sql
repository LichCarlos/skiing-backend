ALTER TABLE "AiMessage"
ADD COLUMN "GenerationToken" UUID,
ADD COLUMN "GenerationExpiresAt" TIMESTAMPTZ(6);

UPDATE "AiMessage" SET "GenerationStatus" = 'failed', "Content" = ''
WHERE "GenerationStatus" = 'streaming';

-- Expired requests can be retried after a process interruption. The token fences
-- the previous generator so it cannot overwrite a newer attempt.
ALTER TABLE "AiMessage"
ADD CONSTRAINT "AiMessage_GenerationLease_check"
CHECK ("GenerationStatus" IS DISTINCT FROM 'streaming'
  OR ("GenerationToken" IS NOT NULL AND "GenerationExpiresAt" IS NOT NULL));
