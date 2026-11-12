ALTER TABLE "MerchantProfile" ADD COLUMN "Version" INTEGER NOT NULL DEFAULT 1, ADD COLUMN "CreateTime" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, ADD COLUMN "UpdateTime" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "MerchantProfile" ADD CONSTRAINT "MerchantProfile_Version_positive" CHECK ("Version" > 0);
ALTER TABLE "RagDocument" ADD COLUMN "LastFailureReason" VARCHAR(50), ADD COLUMN "LastFailureAt" TIMESTAMPTZ(6), ADD COLUMN "IndexStartedAt" TIMESTAMPTZ(6);
ALTER TABLE "Asset" ADD COLUMN "StorageDeletedAt" TIMESTAMPTZ(6), ADD COLUMN "CleanupFailureCode" VARCHAR(50);
CREATE INDEX "Asset_cleanup_candidates" ON "Asset" ("AssetId", "CreateTime") WHERE "StorageDeletedAt" IS NULL;
CREATE INDEX "SkiResort_CustomFields_gin" ON "SkiResort" USING GIN ("CustomFields" jsonb_path_ops);
CREATE INDEX "Article_CustomFields_gin" ON "Article" USING GIN ("CustomFields" jsonb_path_ops);
CREATE INDEX "Dynamic_CustomFields_gin" ON "Dynamic" USING GIN ("CustomFields" jsonb_path_ops);
