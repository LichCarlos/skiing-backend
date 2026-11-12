-- CreateTable
CREATE TABLE "SkiResort" (
    "ResortId" SERIAL NOT NULL,
    "MerchantId" INTEGER,
    "Name" VARCHAR(100) NOT NULL,
    "Province" VARCHAR(50),
    "City" VARCHAR(50),
    "Address" VARCHAR(300),
    "Longitude" DECIMAL(10,7),
    "Latitude" DECIMAL(10,7),
    "CoverImage" VARCHAR(200) NOT NULL,
    "Distance" DECIMAL(5,1) NOT NULL,
    "Score" DECIMAL(2,1) NOT NULL,
    "Price" INTEGER NOT NULL,
    "FitTag" VARCHAR(50) NOT NULL,
    "SnowCondition" VARCHAR(50) NOT NULL,
    "SnowConditionUpdatedAt" TIMESTAMPTZ(6),
    "OpeningHours" VARCHAR(200),
    "TrailSummary" TEXT,
    "FacilitySummary" TEXT,
    "OfficialUrl" VARCHAR(500),
    "Description" VARCHAR(1000) NOT NULL,
    "Status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "UpdateTime" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SkiResort_pkey" PRIMARY KEY ("ResortId"),
    CONSTRAINT "SkiResort_Distance_check" CHECK ("Distance" >= 0),
    CONSTRAINT "SkiResort_Score_check" CHECK ("Score" >= 0 AND "Score" <= 5),
    CONSTRAINT "SkiResort_Price_check" CHECK ("Price" >= 0),
    CONSTRAINT "SkiResort_Longitude_check" CHECK ("Longitude" IS NULL OR ("Longitude" >= -180 AND "Longitude" <= 180)),
    CONSTRAINT "SkiResort_Latitude_check" CHECK ("Latitude" IS NULL OR ("Latitude" >= -90 AND "Latitude" <= 90)),
    CONSTRAINT "SkiResort_Status_check" CHECK ("Status" IN ('active', 'inactive'))
);

-- CreateIndex
CREATE INDEX "SkiResort_MerchantId_Status_idx" ON "SkiResort"("MerchantId", "Status");

-- CreateIndex
CREATE INDEX "SkiResort_Province_City_Status_idx" ON "SkiResort"("Province", "City", "Status");

-- AddForeignKey
ALTER TABLE "SkiResort" ADD CONSTRAINT "SkiResort_MerchantId_fkey" FOREIGN KEY ("MerchantId") REFERENCES "MerchantProfile"("MerchantId") ON DELETE RESTRICT ON UPDATE CASCADE;
