-- CreateTable
CREATE TABLE "RagDocument" (
    "RagDocumentId" SERIAL NOT NULL,
    "SourceKey" VARCHAR(200) NOT NULL,
    "SourceType" VARCHAR(30) NOT NULL,
    "SourceId" INTEGER,
    "Title" VARCHAR(300) NOT NULL,
    "Content" TEXT NOT NULL,
    "AccessScope" VARCHAR(20) NOT NULL,
    "MerchantId" INTEGER,
    "Status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "ContentHash" CHAR(64) NOT NULL,
    "Metadata" JSONB,
    "SourceUpdatedAt" TIMESTAMPTZ(6) NOT NULL,
    "IndexedAt" TIMESTAMPTZ(6),
    "CreateTime" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RagDocument_pkey" PRIMARY KEY ("RagDocumentId"),
    CONSTRAINT "RagDocument_SourceType_check" CHECK ("SourceType" IN ('resort', 'article', 'dynamic', 'project_doc', 'dictionary', 'revenue')),
    CONSTRAINT "RagDocument_AccessScope_check" CHECK ("AccessScope" IN ('public', 'merchant', 'admin')),
    CONSTRAINT "RagDocument_Status_check" CHECK ("Status" IN ('pending', 'indexed', 'failed', 'disabled')),
    CONSTRAINT "RagDocument_MerchantScope_check" CHECK ("AccessScope" <> 'merchant' OR "MerchantId" IS NOT NULL)
);

-- CreateTable
CREATE TABLE "RagChunk" (
    "RagChunkId" BIGSERIAL NOT NULL,
    "RagDocumentId" INTEGER NOT NULL,
    "ChunkIndex" INTEGER NOT NULL,
    "ChunkContent" TEXT NOT NULL,
    "Embedding" vector(1024) NOT NULL,
    "EmbeddingModel" VARCHAR(100) NOT NULL,
    "TokenCount" INTEGER NOT NULL DEFAULT 0,
    "Metadata" JSONB,
    "CreateTime" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RagChunk_pkey" PRIMARY KEY ("RagChunkId"),
    CONSTRAINT "RagChunk_ChunkIndex_check" CHECK ("ChunkIndex" >= 0),
    CONSTRAINT "RagChunk_TokenCount_check" CHECK ("TokenCount" >= 0)
);

-- CreateTable
CREATE TABLE "AiConversation" (
    "ConversationId" UUID NOT NULL,
    "UserId" INTEGER,
    "GuestSessionId" VARCHAR(100),
    "Title" VARCHAR(200),
    "Status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "CreateTime" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "UpdateTime" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiConversation_pkey" PRIMARY KEY ("ConversationId"),
    CONSTRAINT "AiConversation_Status_check" CHECK ("Status" IN ('active', 'archived')),
    CONSTRAINT "AiConversation_Owner_check" CHECK (("UserId" IS NOT NULL AND "GuestSessionId" IS NULL) OR ("UserId" IS NULL AND "GuestSessionId" IS NOT NULL))
);

-- CreateTable
CREATE TABLE "AiMessage" (
    "MessageId" BIGSERIAL NOT NULL,
    "ConversationId" UUID NOT NULL,
    "SenderRole" VARCHAR(20) NOT NULL,
    "Content" TEXT NOT NULL,
    "ModelName" VARCHAR(100),
    "PromptTokens" INTEGER NOT NULL DEFAULT 0,
    "CompletionTokens" INTEGER NOT NULL DEFAULT 0,
    "Citations" JSONB,
    "CreateTime" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiMessage_pkey" PRIMARY KEY ("MessageId"),
    CONSTRAINT "AiMessage_SenderRole_check" CHECK ("SenderRole" IN ('user', 'assistant')),
    CONSTRAINT "AiMessage_PromptTokens_check" CHECK ("PromptTokens" >= 0),
    CONSTRAINT "AiMessage_CompletionTokens_check" CHECK ("CompletionTokens" >= 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "RagDocument_SourceKey_key" ON "RagDocument"("SourceKey");

-- CreateIndex
CREATE INDEX "RagDocument_Status_AccessScope_MerchantId_idx" ON "RagDocument"("Status", "AccessScope", "MerchantId");

-- CreateIndex
CREATE INDEX "RagChunk_RagDocumentId_idx" ON "RagChunk"("RagDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "RagChunk_RagDocumentId_ChunkIndex_key" ON "RagChunk"("RagDocumentId", "ChunkIndex");

-- CreateIndex
CREATE INDEX rag_chunk_embedding_hnsw ON "RagChunk" USING hnsw ("Embedding" vector_cosine_ops);

-- CreateIndex
CREATE INDEX "AiConversation_UserId_UpdateTime_idx" ON "AiConversation"("UserId", "UpdateTime");

-- CreateIndex
CREATE INDEX "AiConversation_GuestSessionId_UpdateTime_idx" ON "AiConversation"("GuestSessionId", "UpdateTime");

-- CreateIndex
CREATE INDEX "AiMessage_ConversationId_CreateTime_idx" ON "AiMessage"("ConversationId", "CreateTime");

-- AddForeignKey
ALTER TABLE "RagDocument" ADD CONSTRAINT "RagDocument_MerchantId_fkey" FOREIGN KEY ("MerchantId") REFERENCES "MerchantProfile"("MerchantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RagChunk" ADD CONSTRAINT "RagChunk_RagDocumentId_fkey" FOREIGN KEY ("RagDocumentId") REFERENCES "RagDocument"("RagDocumentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiConversation" ADD CONSTRAINT "AiConversation_UserId_fkey" FOREIGN KEY ("UserId") REFERENCES "User"("UserId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiMessage" ADD CONSTRAINT "AiMessage_ConversationId_fkey" FOREIGN KEY ("ConversationId") REFERENCES "AiConversation"("ConversationId") ON DELETE CASCADE ON UPDATE CASCADE;
