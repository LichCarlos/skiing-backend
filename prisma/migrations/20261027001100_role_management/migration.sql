ALTER TABLE "Role"
ADD COLUMN "RoleDescription" VARCHAR(300),
ADD COLUMN "SystemRoleCode" VARCHAR(50);

UPDATE "Role"
SET "SystemRoleCode" = CASE "RoleKey"
  WHEN 'user' THEN 'registered_user'
  WHEN 'merchant' THEN 'merchant_template'
  WHEN 'system_admin' THEN 'system_admin'
  ELSE NULL
END;

CREATE UNIQUE INDEX "Role_SystemRoleCode_key" ON "Role"("SystemRoleCode");
