ALTER TABLE "Favorite" ADD COLUMN "DynamicId" INTEGER;
ALTER TABLE "Favorite" DROP CONSTRAINT "Favorite_Target_check";
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_Target_check"
  CHECK (num_nonnulls("ResortId", "ArticleId", "DynamicId") = 1);
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_DynamicId_fkey"
  FOREIGN KEY ("DynamicId") REFERENCES "Dynamic"("DynamicId") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "Favorite_UserId_DynamicId_key" ON "Favorite"("UserId", "DynamicId");
CREATE INDEX "Favorite_DynamicId_UserId_idx" ON "Favorite"("DynamicId", "UserId");
