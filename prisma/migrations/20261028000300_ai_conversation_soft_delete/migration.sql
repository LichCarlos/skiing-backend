ALTER TABLE "AiConversation"
ADD COLUMN "DeletedAt" TIMESTAMPTZ(6);

CREATE INDEX "AiConversation_UserId_DeletedAt_UpdateTime_idx"
ON "AiConversation"("UserId", "DeletedAt", "UpdateTime");
