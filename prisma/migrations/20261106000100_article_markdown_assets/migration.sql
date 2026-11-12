ALTER TABLE "Article" ADD COLUMN "ContentFormat" VARCHAR(20) NOT NULL DEFAULT 'plain_text';
ALTER TABLE "Article" ADD CONSTRAINT "Article_ContentFormat_check" CHECK ("ContentFormat" IN ('plain_text','markdown_v1'));
CREATE TABLE "ArticleBodyAsset" (
 "ArticleId" INTEGER NOT NULL REFERENCES "Article"("ArticleId") ON DELETE CASCADE,
 "AssetId" BIGINT NOT NULL REFERENCES "Asset"("AssetId") ON DELETE RESTRICT,
 PRIMARY KEY ("ArticleId","AssetId")
);
CREATE INDEX "ArticleBodyAsset_AssetId_idx" ON "ArticleBodyAsset"("AssetId");

ALTER TABLE "Dynamic" ADD COLUMN "ContentFormat" VARCHAR(20) NOT NULL DEFAULT 'plain_text', ADD COLUMN "Version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Dynamic" ADD CONSTRAINT "Dynamic_ContentFormat_check" CHECK ("ContentFormat" IN ('plain_text','markdown_v1'));
ALTER TABLE "Dynamic" ADD CONSTRAINT "Dynamic_Version_check" CHECK ("Version" > 0);
