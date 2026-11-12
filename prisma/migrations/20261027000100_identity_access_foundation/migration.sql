CREATE EXTENSION IF NOT EXISTS vector;

-- CreateTable
CREATE TABLE "User" (
    "UserId" SERIAL NOT NULL,
    "Account" VARCHAR(50) NOT NULL,
    "PasswordHash" VARCHAR(255) NOT NULL,
    "Nickname" VARCHAR(50) NOT NULL,
    "Avatar" TEXT,
    "Status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "CreateTime" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("UserId")
);

-- CreateTable
CREATE TABLE "Role" (
    "RoleId" SERIAL NOT NULL,
    "RoleKey" VARCHAR(50) NOT NULL,
    "RoleName" VARCHAR(50) NOT NULL,
    "DataScope" VARCHAR(20) NOT NULL,
    "Status" VARCHAR(20) NOT NULL DEFAULT 'active',

    CONSTRAINT "Role_pkey" PRIMARY KEY ("RoleId"),
    CONSTRAINT "Role_DataScope_check" CHECK ("DataScope" IN ('self', 'merchant', 'all'))
);

-- CreateTable
CREATE TABLE "UserRole" (
    "UserId" INTEGER NOT NULL,
    "RoleId" INTEGER NOT NULL,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("UserId","RoleId")
);

-- CreateTable
CREATE TABLE "Permission" (
    "PermissionId" SERIAL NOT NULL,
    "ParentId" INTEGER,
    "PermissionName" VARCHAR(100) NOT NULL,
    "PermissionType" VARCHAR(20) NOT NULL,
    "PermissionKey" VARCHAR(100) NOT NULL,
    "Route" VARCHAR(200),
    "Icon" VARCHAR(100),
    "SortOrder" INTEGER NOT NULL DEFAULT 0,
    "Visible" BOOLEAN NOT NULL DEFAULT true,
    "Status" VARCHAR(20) NOT NULL DEFAULT 'active',

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("PermissionId")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "RoleId" INTEGER NOT NULL,
    "PermissionId" INTEGER NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("RoleId","PermissionId")
);

-- CreateTable
CREATE TABLE "MerchantProfile" (
    "MerchantId" SERIAL NOT NULL,
    "UserId" INTEGER NOT NULL,
    "BusinessName" VARCHAR(100) NOT NULL,
    "Contact" VARCHAR(100),
    "Status" VARCHAR(20) NOT NULL DEFAULT 'active',

    CONSTRAINT "MerchantProfile_pkey" PRIMARY KEY ("MerchantId")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_Account_key" ON "User"("Account");

-- CreateIndex
CREATE UNIQUE INDEX "Role_RoleKey_key" ON "Role"("RoleKey");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_PermissionKey_key" ON "Permission"("PermissionKey");

-- CreateIndex
CREATE INDEX "Permission_ParentId_SortOrder_idx" ON "Permission"("ParentId", "SortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantProfile_UserId_key" ON "MerchantProfile"("UserId");

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_UserId_fkey" FOREIGN KEY ("UserId") REFERENCES "User"("UserId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_RoleId_fkey" FOREIGN KEY ("RoleId") REFERENCES "Role"("RoleId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Permission" ADD CONSTRAINT "Permission_ParentId_fkey" FOREIGN KEY ("ParentId") REFERENCES "Permission"("PermissionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_RoleId_fkey" FOREIGN KEY ("RoleId") REFERENCES "Role"("RoleId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_PermissionId_fkey" FOREIGN KEY ("PermissionId") REFERENCES "Permission"("PermissionId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantProfile" ADD CONSTRAINT "MerchantProfile_UserId_fkey" FOREIGN KEY ("UserId") REFERENCES "User"("UserId") ON DELETE RESTRICT ON UPDATE CASCADE;
