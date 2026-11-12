CREATE TABLE "RoleDataScope" (
    "RoleId" INTEGER NOT NULL,
    "ResourceKey" VARCHAR(100) NOT NULL,
    "ScopeType" VARCHAR(20) NOT NULL,
    "ScopeConfig" JSONB,
    "CreateTime" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "UpdateTime" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RoleDataScope_pkey" PRIMARY KEY ("RoleId", "ResourceKey"),
    CONSTRAINT "RoleDataScope_RoleId_fkey" FOREIGN KEY ("RoleId") REFERENCES "Role"("RoleId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RoleDataScope_ResourceKey_check" CHECK (CHAR_LENGTH(BTRIM("ResourceKey")) > 0),
    CONSTRAINT "RoleDataScope_ScopeType_check" CHECK ("ScopeType" IN ('self', 'merchant', 'selected', 'all'))
);

CREATE INDEX "RoleDataScope_ResourceKey_ScopeType_idx"
ON "RoleDataScope"("ResourceKey", "ScopeType");

CREATE TABLE "CustomFieldGroup" (
    "EntityType" VARCHAR(50) NOT NULL,
    "GroupKey" VARCHAR(100) NOT NULL,
    "Label" VARCHAR(100) NOT NULL,
    "SortOrder" INTEGER NOT NULL DEFAULT 0,
    "VisibilityRule" JSONB,
    "Status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "CreateTime" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "UpdateTime" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomFieldGroup_pkey" PRIMARY KEY ("EntityType", "GroupKey"),
    CONSTRAINT "CustomFieldGroup_EntityType_check" CHECK ("EntityType" IN ('ski_resort', 'article', 'dynamic', 'merchant_profile')),
    CONSTRAINT "CustomFieldGroup_Status_check" CHECK ("Status" IN ('active', 'disabled')),
    CONSTRAINT "CustomFieldGroup_Keys_check" CHECK (CHAR_LENGTH(BTRIM("GroupKey")) > 0 AND CHAR_LENGTH(BTRIM("Label")) > 0)
);

CREATE INDEX "CustomFieldGroup_EntityType_Status_SortOrder_idx"
ON "CustomFieldGroup"("EntityType", "Status", "SortOrder");

CREATE TABLE "CustomFieldDefinition" (
    "FieldDefinitionId" SERIAL NOT NULL,
    "EntityType" VARCHAR(50) NOT NULL,
    "FieldKey" VARCHAR(100) NOT NULL,
    "Label" VARCHAR(100) NOT NULL,
    "DataType" VARCHAR(30) NOT NULL,
    "GroupKey" VARCHAR(100) NOT NULL,
    "SortOrder" INTEGER NOT NULL DEFAULT 0,
    "Required" BOOLEAN NOT NULL DEFAULT false,
    "DefaultValue" JSONB,
    "OptionsDictType" VARCHAR(100),
    "Validation" JSONB,
    "Searchable" BOOLEAN NOT NULL DEFAULT false,
    "Filterable" BOOLEAN NOT NULL DEFAULT false,
    "Sortable" BOOLEAN NOT NULL DEFAULT false,
    "Status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "SchemaVersion" INTEGER NOT NULL DEFAULT 1,
    "CreateTime" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "UpdateTime" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomFieldDefinition_pkey" PRIMARY KEY ("FieldDefinitionId"),
    CONSTRAINT "CustomFieldDefinition_EntityType_FieldKey_key" UNIQUE ("EntityType", "FieldKey"),
    CONSTRAINT "CustomFieldDefinition_Group_fkey" FOREIGN KEY ("EntityType", "GroupKey") REFERENCES "CustomFieldGroup"("EntityType", "GroupKey") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CustomFieldDefinition_OptionsDictType_fkey" FOREIGN KEY ("OptionsDictType") REFERENCES "DictionaryType"("DictType") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CustomFieldDefinition_EntityType_check" CHECK ("EntityType" IN ('ski_resort', 'article', 'dynamic', 'merchant_profile')),
    CONSTRAINT "CustomFieldDefinition_DataType_check" CHECK ("DataType" IN ('text', 'textarea', 'integer', 'decimal', 'boolean', 'date', 'single_select', 'multi_select', 'url')),
    CONSTRAINT "CustomFieldDefinition_Status_check" CHECK ("Status" IN ('draft', 'active', 'disabled')),
    CONSTRAINT "CustomFieldDefinition_SchemaVersion_check" CHECK ("SchemaVersion" > 0),
    CONSTRAINT "CustomFieldDefinition_Keys_check" CHECK (CHAR_LENGTH(BTRIM("FieldKey")) > 0 AND CHAR_LENGTH(BTRIM("Label")) > 0)
);

CREATE INDEX "CustomFieldDefinition_EntityType_GroupKey_Status_SortOrder_idx"
ON "CustomFieldDefinition"("EntityType", "GroupKey", "Status", "SortOrder");

CREATE INDEX "CustomFieldDefinition_OptionsDictType_idx"
ON "CustomFieldDefinition"("OptionsDictType");

CREATE TABLE "RoleFieldPermission" (
    "RoleId" INTEGER NOT NULL,
    "EntityType" VARCHAR(50) NOT NULL,
    "FieldKey" VARCHAR(100) NOT NULL,
    "CanRead" BOOLEAN NOT NULL DEFAULT false,
    "CanWrite" BOOLEAN NOT NULL DEFAULT false,
    "CreateTime" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "UpdateTime" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RoleFieldPermission_pkey" PRIMARY KEY ("RoleId", "EntityType", "FieldKey"),
    CONSTRAINT "RoleFieldPermission_RoleId_fkey" FOREIGN KEY ("RoleId") REFERENCES "Role"("RoleId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RoleFieldPermission_FieldDefinition_fkey" FOREIGN KEY ("EntityType", "FieldKey") REFERENCES "CustomFieldDefinition"("EntityType", "FieldKey") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "RoleFieldPermission_EntityType_FieldKey_idx"
ON "RoleFieldPermission"("EntityType", "FieldKey");

ALTER TABLE "MerchantProfile"
ADD COLUMN "CustomFields" JSONB NOT NULL DEFAULT '{}'::jsonb,
ADD COLUMN "SchemaVersion" INTEGER NOT NULL DEFAULT 1,
ADD CONSTRAINT "MerchantProfile_CustomFields_check" CHECK (jsonb_typeof("CustomFields") = 'object'),
ADD CONSTRAINT "MerchantProfile_SchemaVersion_check" CHECK ("SchemaVersion" > 0);

ALTER TABLE "SkiResort"
ADD COLUMN "CustomFields" JSONB NOT NULL DEFAULT '{}'::jsonb,
ADD COLUMN "SchemaVersion" INTEGER NOT NULL DEFAULT 1,
ADD CONSTRAINT "SkiResort_CustomFields_check" CHECK (jsonb_typeof("CustomFields") = 'object'),
ADD CONSTRAINT "SkiResort_SchemaVersion_check" CHECK ("SchemaVersion" > 0);
