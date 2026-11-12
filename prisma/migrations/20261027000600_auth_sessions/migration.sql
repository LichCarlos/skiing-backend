-- CreateTable
CREATE TABLE "AuthSession" (
    "SessionId" UUID NOT NULL,
    "UserId" INTEGER NOT NULL,
    "ExpiresAt" TIMESTAMPTZ(6) NOT NULL,
    "RevokedAt" TIMESTAMPTZ(6),
    "CreateTime" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("SessionId")
);

-- CreateTable
CREATE TABLE "AuthRefreshToken" (
    "RefreshTokenId" BIGSERIAL NOT NULL,
    "SessionId" UUID NOT NULL,
    "TokenHash" CHAR(64) NOT NULL,
    "ExpiresAt" TIMESTAMPTZ(6) NOT NULL,
    "ConsumedAt" TIMESTAMPTZ(6),
    "CreateTime" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthRefreshToken_pkey" PRIMARY KEY ("RefreshTokenId")
);

-- CreateIndex
CREATE INDEX "AuthSession_UserId_RevokedAt_ExpiresAt_idx" ON "AuthSession"("UserId", "RevokedAt", "ExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuthRefreshToken_TokenHash_key" ON "AuthRefreshToken"("TokenHash");

-- CreateIndex
CREATE INDEX "AuthRefreshToken_SessionId_ConsumedAt_idx" ON "AuthRefreshToken"("SessionId", "ConsumedAt");

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_UserId_fkey" FOREIGN KEY ("UserId") REFERENCES "User"("UserId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthRefreshToken" ADD CONSTRAINT "AuthRefreshToken_SessionId_fkey" FOREIGN KEY ("SessionId") REFERENCES "AuthSession"("SessionId") ON DELETE CASCADE ON UPDATE CASCADE;
