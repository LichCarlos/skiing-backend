INSERT INTO "DictionaryType" ("DictType", "DictName", "GroupKey", "PubliclyReadable")
VALUES ('knowledge.article_category', '知识文章分类', 'knowledge', true);

CREATE TABLE "Article" (
    "ArticleId" SERIAL NOT NULL,
    "Title" VARCHAR(200) NOT NULL,
    "Summary" VARCHAR(1000) NOT NULL,
    "Body" TEXT NOT NULL,
    "CoverAssetId" BIGINT,
    "CategoryDictType" VARCHAR(100) NOT NULL DEFAULT 'knowledge.article_category',
    "CategoryValue" VARCHAR(100) NOT NULL,
    "AuthorId" INTEGER,
    "AuthorName" VARCHAR(100),
    "Status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "PublishTime" TIMESTAMPTZ(6),
    "Version" INTEGER NOT NULL DEFAULT 1,
    "CustomFields" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "SchemaVersion" INTEGER NOT NULL DEFAULT 1,
    "CreateTime" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "UpdateTime" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "DeletedAt" TIMESTAMPTZ(6),
    CONSTRAINT "Article_pkey" PRIMARY KEY ("ArticleId"),
    CONSTRAINT "Article_CoverAssetId_fkey" FOREIGN KEY ("CoverAssetId") REFERENCES "Asset"("AssetId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Article_Category_fkey" FOREIGN KEY ("CategoryDictType", "CategoryValue") REFERENCES "DictionaryItem"("DictType", "Value") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Article_AuthorId_fkey" FOREIGN KEY ("AuthorId") REFERENCES "User"("UserId") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Article_Status_check" CHECK ("Status" IN ('draft', 'published', 'withdrawn')),
    CONSTRAINT "Article_Version_check" CHECK ("Version" > 0 AND "SchemaVersion" > 0),
    CONSTRAINT "Article_CustomFields_check" CHECK (jsonb_typeof("CustomFields") = 'object'),
    CONSTRAINT "Article_TitleSummary_check" CHECK (CHAR_LENGTH(BTRIM("Title")) > 0 AND CHAR_LENGTH(BTRIM("Summary")) > 0)
);

CREATE INDEX "Article_Status_PublishTime_ArticleId_idx"
ON "Article"("Status", "PublishTime", "ArticleId");

CREATE INDEX "Article_CategoryDictType_CategoryValue_Status_idx"
ON "Article"("CategoryDictType", "CategoryValue", "Status");

CREATE INDEX "Article_AuthorId_CreateTime_idx"
ON "Article"("AuthorId", "CreateTime");

CREATE TABLE "Dynamic" (
    "DynamicId" SERIAL NOT NULL,
    "AuthorId" INTEGER NOT NULL,
    "Content" TEXT NOT NULL,
    "ResortId" INTEGER,
    "Status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "CustomFields" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "SchemaVersion" INTEGER NOT NULL DEFAULT 1,
    "CreateTime" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "UpdateTime" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "DeletedAt" TIMESTAMPTZ(6),
    CONSTRAINT "Dynamic_pkey" PRIMARY KEY ("DynamicId"),
    CONSTRAINT "Dynamic_AuthorId_fkey" FOREIGN KEY ("AuthorId") REFERENCES "User"("UserId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Dynamic_ResortId_fkey" FOREIGN KEY ("ResortId") REFERENCES "SkiResort"("ResortId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Dynamic_Status_check" CHECK ("Status" IN ('pending', 'published', 'hidden')),
    CONSTRAINT "Dynamic_SchemaVersion_check" CHECK ("SchemaVersion" > 0),
    CONSTRAINT "Dynamic_Content_check" CHECK (CHAR_LENGTH(BTRIM("Content")) > 0),
    CONSTRAINT "Dynamic_CustomFields_check" CHECK (jsonb_typeof("CustomFields") = 'object')
);

CREATE INDEX "Dynamic_Status_CreateTime_DynamicId_idx"
ON "Dynamic"("Status", "CreateTime", "DynamicId");

CREATE INDEX "Dynamic_AuthorId_Status_CreateTime_idx"
ON "Dynamic"("AuthorId", "Status", "CreateTime");

CREATE INDEX "Dynamic_ResortId_Status_idx"
ON "Dynamic"("ResortId", "Status");

CREATE TABLE "DynamicImage" (
    "DynamicId" INTEGER NOT NULL,
    "AssetId" BIGINT NOT NULL,
    "SortOrder" INTEGER NOT NULL,
    "CreateTime" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DynamicImage_pkey" PRIMARY KEY ("DynamicId", "AssetId"),
    CONSTRAINT "DynamicImage_DynamicId_fkey" FOREIGN KEY ("DynamicId") REFERENCES "Dynamic"("DynamicId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DynamicImage_AssetId_fkey" FOREIGN KEY ("AssetId") REFERENCES "Asset"("AssetId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DynamicImage_SortOrder_check" CHECK ("SortOrder" >= 0),
    CONSTRAINT "DynamicImage_DynamicId_SortOrder_key" UNIQUE ("DynamicId", "SortOrder")
);

CREATE INDEX "DynamicImage_AssetId_idx" ON "DynamicImage"("AssetId");

CREATE TABLE "Comment" (
    "CommentId" SERIAL NOT NULL,
    "DynamicId" INTEGER NOT NULL,
    "AuthorId" INTEGER NOT NULL,
    "Content" VARCHAR(2000) NOT NULL,
    "Status" VARCHAR(20) NOT NULL DEFAULT 'visible',
    "ModeratedAt" TIMESTAMPTZ(6),
    "ModeratedByUserId" INTEGER,
    "ModerationReason" VARCHAR(500),
    "CreateTime" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "UpdateTime" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "DeletedAt" TIMESTAMPTZ(6),
    CONSTRAINT "Comment_pkey" PRIMARY KEY ("CommentId"),
    CONSTRAINT "Comment_DynamicId_fkey" FOREIGN KEY ("DynamicId") REFERENCES "Dynamic"("DynamicId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Comment_AuthorId_fkey" FOREIGN KEY ("AuthorId") REFERENCES "User"("UserId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Comment_ModeratedByUserId_fkey" FOREIGN KEY ("ModeratedByUserId") REFERENCES "User"("UserId") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Comment_Status_check" CHECK ("Status" IN ('visible', 'hidden')),
    CONSTRAINT "Comment_Content_check" CHECK (CHAR_LENGTH(BTRIM("Content")) > 0),
    CONSTRAINT "Comment_Moderation_check" CHECK (("ModeratedAt" IS NULL) = ("ModeratedByUserId" IS NULL))
);

CREATE INDEX "Comment_DynamicId_Status_CreateTime_idx"
ON "Comment"("DynamicId", "Status", "CreateTime");

CREATE INDEX "Comment_AuthorId_CreateTime_idx"
ON "Comment"("AuthorId", "CreateTime");

CREATE TABLE "LikeRecord" (
    "UserId" INTEGER NOT NULL,
    "DynamicId" INTEGER NOT NULL,
    "CreateTime" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LikeRecord_pkey" PRIMARY KEY ("UserId", "DynamicId"),
    CONSTRAINT "LikeRecord_UserId_fkey" FOREIGN KEY ("UserId") REFERENCES "User"("UserId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LikeRecord_DynamicId_fkey" FOREIGN KEY ("DynamicId") REFERENCES "Dynamic"("DynamicId") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "LikeRecord_DynamicId_CreateTime_idx"
ON "LikeRecord"("DynamicId", "CreateTime");

CREATE TABLE "Favorite" (
    "FavoriteId" BIGSERIAL NOT NULL,
    "UserId" INTEGER NOT NULL,
    "ResortId" INTEGER,
    "ArticleId" INTEGER,
    "CreateTime" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Favorite_pkey" PRIMARY KEY ("FavoriteId"),
    CONSTRAINT "Favorite_UserId_fkey" FOREIGN KEY ("UserId") REFERENCES "User"("UserId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Favorite_ResortId_fkey" FOREIGN KEY ("ResortId") REFERENCES "SkiResort"("ResortId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Favorite_ArticleId_fkey" FOREIGN KEY ("ArticleId") REFERENCES "Article"("ArticleId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Favorite_Target_check" CHECK (("ResortId" IS NOT NULL) <> ("ArticleId" IS NOT NULL))
);

CREATE UNIQUE INDEX "Favorite_UserId_ResortId_key"
ON "Favorite"("UserId", "ResortId");

CREATE UNIQUE INDEX "Favorite_UserId_ArticleId_key"
ON "Favorite"("UserId", "ArticleId");

CREATE INDEX "Favorite_UserId_CreateTime_idx"
ON "Favorite"("UserId", "CreateTime");

CREATE INDEX "Favorite_ArticleId_UserId_idx"
ON "Favorite"("ArticleId", "UserId");

CREATE TABLE "SystemConfig" (
    "ConfigKey" VARCHAR(150) NOT NULL,
    "Value" JSONB NOT NULL,
    "Description" VARCHAR(300),
    "Status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "Version" INTEGER NOT NULL DEFAULT 1,
    "UpdatedByUserId" INTEGER,
    "CreateTime" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "UpdateTime" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SystemConfig_pkey" PRIMARY KEY ("ConfigKey"),
    CONSTRAINT "SystemConfig_UpdatedByUserId_fkey" FOREIGN KEY ("UpdatedByUserId") REFERENCES "User"("UserId") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SystemConfig_Status_check" CHECK ("Status" IN ('active', 'disabled')),
    CONSTRAINT "SystemConfig_Version_check" CHECK ("Version" > 0),
    CONSTRAINT "SystemConfig_ConfigKey_check" CHECK (CHAR_LENGTH(BTRIM("ConfigKey")) > 0)
);

CREATE INDEX "SystemConfig_Status_ConfigKey_idx"
ON "SystemConfig"("Status", "ConfigKey");

CREATE TABLE "OperationLog" (
    "OperationLogId" BIGSERIAL NOT NULL,
    "ActorUserId" INTEGER,
    "ActorAccountSnapshot" VARCHAR(50) NOT NULL,
    "ActionKey" VARCHAR(150) NOT NULL,
    "ResourceKey" VARCHAR(100) NOT NULL,
    "TargetType" VARCHAR(100) NOT NULL,
    "TargetId" VARCHAR(150) NOT NULL,
    "Result" VARCHAR(20) NOT NULL,
    "Reason" VARCHAR(500),
    "TraceId" VARCHAR(100) NOT NULL,
    "ClientIp" VARCHAR(64),
    "UserAgent" VARCHAR(500),
    "Metadata" JSONB,
    "CreateTime" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OperationLog_pkey" PRIMARY KEY ("OperationLogId"),
    CONSTRAINT "OperationLog_ActorUserId_fkey" FOREIGN KEY ("ActorUserId") REFERENCES "User"("UserId") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "OperationLog_Result_check" CHECK ("Result" IN ('success', 'failure')),
    CONSTRAINT "OperationLog_RequiredFields_check" CHECK (
        CHAR_LENGTH(BTRIM("ActorAccountSnapshot")) > 0
        AND CHAR_LENGTH(BTRIM("ActionKey")) > 0
        AND CHAR_LENGTH(BTRIM("ResourceKey")) > 0
        AND CHAR_LENGTH(BTRIM("TraceId")) > 0
    )
);

CREATE INDEX "OperationLog_ActorUserId_CreateTime_idx"
ON "OperationLog"("ActorUserId", "CreateTime");

CREATE INDEX "OperationLog_ResourceKey_TargetType_TargetId_CreateTime_idx"
ON "OperationLog"("ResourceKey", "TargetType", "TargetId", "CreateTime");

CREATE INDEX "OperationLog_TraceId_idx" ON "OperationLog"("TraceId");

ALTER TABLE "AiMessage" ADD COLUMN "ClientRequestId" UUID;

CREATE UNIQUE INDEX "AiMessage_ConversationId_ClientRequestId_key"
ON "AiMessage"("ConversationId", "ClientRequestId");
