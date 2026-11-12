-- CreateTable
CREATE TABLE "ResortRevenueRecord" (
    "RevenueId" SERIAL NOT NULL,
    "ResortId" INTEGER NOT NULL,
    "ReportDate" DATE NOT NULL,
    "RevenueAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "Source" VARCHAR(20) NOT NULL,
    "Note" VARCHAR(300),
    "CreatedBy" INTEGER NOT NULL,
    "CreateTime" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "UpdateTime" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResortRevenueRecord_pkey" PRIMARY KEY ("RevenueId"),
    CONSTRAINT "ResortRevenueRecord_Amount_check" CHECK ("RevenueAmount" >= 0),
    CONSTRAINT "ResortRevenueRecord_Source_check" CHECK ("Source" IN ('manual', 'import'))
);

-- CreateIndex
CREATE INDEX "ResortRevenueRecord_CreatedBy_CreateTime_idx" ON "ResortRevenueRecord"("CreatedBy", "CreateTime");

-- CreateIndex
CREATE UNIQUE INDEX "ResortRevenueRecord_ResortId_ReportDate_key" ON "ResortRevenueRecord"("ResortId", "ReportDate");

-- AddForeignKey
ALTER TABLE "ResortRevenueRecord" ADD CONSTRAINT "ResortRevenueRecord_ResortId_fkey" FOREIGN KEY ("ResortId") REFERENCES "SkiResort"("ResortId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResortRevenueRecord" ADD CONSTRAINT "ResortRevenueRecord_CreatedBy_fkey" FOREIGN KEY ("CreatedBy") REFERENCES "User"("UserId") ON DELETE RESTRICT ON UPDATE CASCADE;
