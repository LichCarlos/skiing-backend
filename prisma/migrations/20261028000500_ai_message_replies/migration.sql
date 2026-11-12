ALTER TABLE "AiMessage"
ADD COLUMN "ParentMessageId" BIGINT;

ALTER TABLE "AiMessage"
ADD CONSTRAINT "AiMessage_ParentMessageId_fkey"
FOREIGN KEY ("ParentMessageId") REFERENCES "AiMessage"("MessageId")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AiMessage"
ADD CONSTRAINT "AiMessage_ParentMessage_role_check"
CHECK ("ParentMessageId" IS NULL OR "SenderRole" = 'assistant');

CREATE UNIQUE INDEX "AiMessage_ParentMessageId_key"
ON "AiMessage"("ParentMessageId");
