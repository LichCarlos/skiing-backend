ALTER TABLE "User" ADD COLUMN "AvatarAssetId" BIGINT;
CREATE INDEX "User_AvatarAssetId_idx" ON "User"("AvatarAssetId");
ALTER TABLE "User" ADD CONSTRAINT "User_AvatarAssetId_fkey"
  FOREIGN KEY ("AvatarAssetId") REFERENCES "Asset"("AssetId") ON DELETE RESTRICT ON UPDATE CASCADE;
