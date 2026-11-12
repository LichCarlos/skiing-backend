CREATE TABLE "ProjectKnowledge" (
    "ProjectKnowledgeId" SERIAL NOT NULL,
    "Title" VARCHAR(200) NOT NULL,
    "Content" TEXT NOT NULL,
    "Category" VARCHAR(80) NOT NULL,
    "SourceUrl" VARCHAR(2048),
    "Status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "PublishTime" TIMESTAMPTZ(6),
    "Version" INTEGER NOT NULL DEFAULT 1,
    "CreateTime" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "UpdateTime" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "DeletedAt" TIMESTAMPTZ(6),
    CONSTRAINT "ProjectKnowledge_pkey" PRIMARY KEY ("ProjectKnowledgeId"),
    CONSTRAINT "ProjectKnowledge_Status_check" CHECK ("Status" IN ('draft', 'published', 'withdrawn')),
    CONSTRAINT "ProjectKnowledge_Version_check" CHECK ("Version" > 0)
);
CREATE INDEX "ProjectKnowledge_Status_PublishTime_ProjectKnowledgeId_idx" ON "ProjectKnowledge"("Status", "PublishTime", "ProjectKnowledgeId");
CREATE INDEX "ProjectKnowledge_Category_Status_idx" ON "ProjectKnowledge"("Category", "Status");
