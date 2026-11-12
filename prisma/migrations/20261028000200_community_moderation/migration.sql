ALTER TABLE "Dynamic"
  ADD COLUMN "ModeratedAt" TIMESTAMPTZ(6),
  ADD COLUMN "ModeratedByUserId" INTEGER,
  ADD COLUMN "ModerationReason" VARCHAR(500);

ALTER TABLE "Dynamic"
  ADD CONSTRAINT "Dynamic_ModeratedByUserId_fkey"
  FOREIGN KEY ("ModeratedByUserId") REFERENCES "User"("UserId")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Dynamic_ModeratedByUserId_idx"
  ON "Dynamic"("ModeratedByUserId");
