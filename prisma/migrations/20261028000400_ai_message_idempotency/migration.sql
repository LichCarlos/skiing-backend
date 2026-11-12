ALTER TABLE "AiMessage"
ADD COLUMN "GenerationStatus" VARCHAR(20);

UPDATE "AiMessage" SET "GenerationStatus" = 'completed'
WHERE "SenderRole" = 'assistant';

ALTER TABLE "AiMessage"
ADD CONSTRAINT "AiMessage_GenerationStatus_check"
CHECK (
  "GenerationStatus" IS NULL
  OR ("SenderRole" = 'assistant' AND "GenerationStatus" IN ('streaming', 'completed', 'failed'))
);
