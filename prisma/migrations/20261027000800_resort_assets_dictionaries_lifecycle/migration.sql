CREATE TABLE "DictionaryType" (
    "DictType" VARCHAR(100) NOT NULL,
    "DictName" VARCHAR(100) NOT NULL,
    "GroupKey" VARCHAR(100) NOT NULL,
    "Status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "PubliclyReadable" BOOLEAN NOT NULL DEFAULT false,
    "CreateTime" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "UpdateTime" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DictionaryType_pkey" PRIMARY KEY ("DictType"),
    CONSTRAINT "DictionaryType_Status_check" CHECK ("Status" IN ('active', 'disabled')),
    CONSTRAINT "DictionaryType_DictType_check" CHECK (CHAR_LENGTH(BTRIM("DictType")) > 0)
);

CREATE INDEX "DictionaryType_GroupKey_Status_idx"
ON "DictionaryType"("GroupKey", "Status");

CREATE TABLE "DictionaryItem" (
    "ItemId" SERIAL NOT NULL,
    "DictType" VARCHAR(100) NOT NULL,
    "ParentId" INTEGER,
    "Label" VARCHAR(100) NOT NULL,
    "Value" VARCHAR(100) NOT NULL,
    "Color" VARCHAR(20),
    "SortOrder" INTEGER NOT NULL DEFAULT 0,
    "IsDefault" BOOLEAN NOT NULL DEFAULT false,
    "Status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "CreateTime" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "UpdateTime" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DictionaryItem_pkey" PRIMARY KEY ("ItemId"),
    CONSTRAINT "DictionaryItem_DictType_fkey" FOREIGN KEY ("DictType") REFERENCES "DictionaryType"("DictType") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DictionaryItem_Parent_fkey" FOREIGN KEY ("DictType", "ParentId") REFERENCES "DictionaryItem"("DictType", "ItemId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DictionaryItem_Status_check" CHECK ("Status" IN ('active', 'disabled')),
    CONSTRAINT "DictionaryItem_Parent_check" CHECK ("ParentId" IS NULL OR "ParentId" <> "ItemId"),
    CONSTRAINT "DictionaryItem_LabelValue_check" CHECK (CHAR_LENGTH(BTRIM("Label")) > 0 AND CHAR_LENGTH(BTRIM("Value")) > 0),
    CONSTRAINT "DictionaryItem_DictType_ItemId_key" UNIQUE ("DictType", "ItemId"),
    CONSTRAINT "DictionaryItem_DictType_Value_key" UNIQUE ("DictType", "Value")
);

CREATE INDEX "DictionaryItem_DictType_ParentId_SortOrder_idx"
ON "DictionaryItem"("DictType", "ParentId", "SortOrder");

INSERT INTO "DictionaryType" ("DictType", "DictName", "GroupKey", "PubliclyReadable")
VALUES ('resort.fit_tag', '雪场适配标签', 'resort', true);

INSERT INTO "DictionaryItem" ("DictType", "Label", "Value", "SortOrder")
SELECT
    'resort.fit_tag',
    MIN(BTRIM("FitTag")),
    LOWER(BTRIM("FitTag")),
    ROW_NUMBER() OVER (ORDER BY LOWER(BTRIM("FitTag")))::INTEGER
FROM "SkiResort"
WHERE "FitTag" IS NOT NULL AND CHAR_LENGTH(BTRIM("FitTag")) > 0
GROUP BY LOWER(BTRIM("FitTag"));

CREATE TABLE "Asset" (
    "AssetId" BIGSERIAL NOT NULL,
    "OwnerUserId" INTEGER NOT NULL,
    "StorageKey" VARCHAR(500) NOT NULL,
    "OriginalName" VARCHAR(255) NOT NULL,
    "MimeType" VARCHAR(100) NOT NULL,
    "SizeBytes" BIGINT NOT NULL,
    "Sha256" CHAR(64) NOT NULL,
    "Status" VARCHAR(20) NOT NULL DEFAULT 'pending_scan',
    "CreateTime" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "UpdateTime" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Asset_pkey" PRIMARY KEY ("AssetId"),
    CONSTRAINT "Asset_OwnerUserId_fkey" FOREIGN KEY ("OwnerUserId") REFERENCES "User"("UserId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Asset_StorageKey_key" UNIQUE ("StorageKey"),
    CONSTRAINT "Asset_SizeBytes_check" CHECK ("SizeBytes" > 0),
    CONSTRAINT "Asset_Sha256_check" CHECK ("Sha256" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "Asset_Status_check" CHECK ("Status" IN ('pending_scan', 'ready', 'rejected', 'deleted'))
);

CREATE INDEX "Asset_OwnerUserId_Status_CreateTime_idx"
ON "Asset"("OwnerUserId", "Status", "CreateTime");

CREATE INDEX "Asset_Sha256_idx" ON "Asset"("Sha256");

ALTER TABLE "SkiResort" DROP CONSTRAINT "SkiResort_Status_check";
ALTER TABLE "SkiResort" RENAME CONSTRAINT "SkiResort_Score_check" TO "SkiResort_Rating_check";
ALTER TABLE "SkiResort" RENAME CONSTRAINT "SkiResort_Distance_check" TO "SkiResort_LegacyDistance_check";
ALTER TABLE "SkiResort" RENAME COLUMN "Score" TO "Rating";
ALTER TABLE "SkiResort" ALTER COLUMN "Rating" DROP NOT NULL;
ALTER TABLE "SkiResort" RENAME COLUMN "CoverImage" TO "LegacyCoverImage";
ALTER TABLE "SkiResort" ALTER COLUMN "LegacyCoverImage" DROP NOT NULL;
ALTER TABLE "SkiResort" ADD COLUMN "District" VARCHAR(50);
ALTER TABLE "SkiResort" ADD COLUMN "CoverAssetId" BIGINT;
ALTER TABLE "SkiResort" ADD COLUMN "RatingCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SkiResort" ADD COLUMN "OpenStatus" VARCHAR(20) NOT NULL DEFAULT 'unknown';
ALTER TABLE "SkiResort" ADD COLUMN "DeletedAt" TIMESTAMPTZ(6);
ALTER TABLE "SkiResort" RENAME COLUMN "Distance" TO "LegacyDistance";

UPDATE "SkiResort"
SET "Status" = CASE "Status"
    WHEN 'active' THEN 'published'
    WHEN 'inactive' THEN 'offline'
END;

ALTER TABLE "SkiResort" ALTER COLUMN "Status" SET DEFAULT 'draft';
ALTER TABLE "SkiResort" ADD CONSTRAINT "SkiResort_Status_check"
CHECK ("Status" IN ('draft', 'pending_review', 'published', 'offline'));
ALTER TABLE "SkiResort" ADD CONSTRAINT "SkiResort_RatingCount_check"
CHECK ("RatingCount" >= 0);
ALTER TABLE "SkiResort" ADD CONSTRAINT "SkiResort_OpenStatus_check"
CHECK ("OpenStatus" IN ('open', 'closed', 'limited', 'unknown'));
ALTER TABLE "SkiResort" ADD CONSTRAINT "SkiResort_CoverAssetId_fkey"
FOREIGN KEY ("CoverAssetId") REFERENCES "Asset"("AssetId") ON DELETE RESTRICT ON UPDATE CASCADE;

DROP INDEX "SkiResort_Province_City_Status_idx";

CREATE INDEX "SkiResort_Province_City_District_Status_idx"
ON "SkiResort"("Province", "City", "District", "Status");

CREATE INDEX "SkiResort_Status_OpenStatus_DeletedAt_idx"
ON "SkiResort"("Status", "OpenStatus", "DeletedAt");

CREATE TABLE "ResortFitTag" (
    "ResortId" INTEGER NOT NULL,
    "DictType" VARCHAR(100) NOT NULL DEFAULT 'resort.fit_tag',
    "ItemId" INTEGER NOT NULL,
    CONSTRAINT "ResortFitTag_pkey" PRIMARY KEY ("ResortId", "ItemId"),
    CONSTRAINT "ResortFitTag_ResortId_fkey" FOREIGN KEY ("ResortId") REFERENCES "SkiResort"("ResortId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResortFitTag_Item_fkey" FOREIGN KEY ("DictType", "ItemId") REFERENCES "DictionaryItem"("DictType", "ItemId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ResortFitTag_DictType_check" CHECK ("DictType" = 'resort.fit_tag')
);

CREATE INDEX "ResortFitTag_DictType_ItemId_ResortId_idx"
ON "ResortFitTag"("DictType", "ItemId", "ResortId");

INSERT INTO "ResortFitTag" ("ResortId", "ItemId")
SELECT r."ResortId", d."ItemId"
FROM "SkiResort" r
JOIN "DictionaryItem" d
  ON d."DictType" = 'resort.fit_tag'
 AND d."Value" = LOWER(BTRIM(r."FitTag"))
WHERE r."FitTag" IS NOT NULL AND CHAR_LENGTH(BTRIM(r."FitTag")) > 0;

ALTER TABLE "SkiResort" DROP COLUMN "FitTag";

CREATE TABLE "ResortImage" (
    "ResortId" INTEGER NOT NULL,
    "AssetId" BIGINT NOT NULL,
    "SortOrder" INTEGER NOT NULL,
    "CreateTime" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResortImage_pkey" PRIMARY KEY ("ResortId", "AssetId"),
    CONSTRAINT "ResortImage_ResortId_fkey" FOREIGN KEY ("ResortId") REFERENCES "SkiResort"("ResortId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResortImage_AssetId_fkey" FOREIGN KEY ("AssetId") REFERENCES "Asset"("AssetId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ResortImage_SortOrder_check" CHECK ("SortOrder" >= 0),
    CONSTRAINT "ResortImage_ResortId_SortOrder_key" UNIQUE ("ResortId", "SortOrder")
);

CREATE INDEX "ResortImage_AssetId_idx" ON "ResortImage"("AssetId");
