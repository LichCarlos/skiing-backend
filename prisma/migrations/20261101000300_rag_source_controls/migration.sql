ALTER TABLE "RagDocument"
  ADD COLUMN "ManualDisabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "ControlVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "IndexGeneration" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "RagDocument"
  ADD CONSTRAINT "RagDocument_ControlVersion_positive"
    CHECK ("ControlVersion" > 0),
  ADD CONSTRAINT "RagDocument_IndexGeneration_nonnegative"
    CHECK ("IndexGeneration" >= 0);
