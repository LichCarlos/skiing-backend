import { PrismaClient } from '@prisma/client';
import { readdirSync } from 'node:fs';

const prisma = new PrismaClient();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function verifyDatabase(): Promise<void> {
  const migrations = await prisma.$queryRaw<
    Array<{ migration_name: string }>
  >`SELECT migration_name
    FROM "_prisma_migrations"
    WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
  const appliedMigrationNames = new Set(
    migrations.map(({ migration_name }) => migration_name),
  );
  const requiredMigrations = readdirSync(
    new URL('../prisma/migrations/', import.meta.url),
    { withFileTypes: true },
  )
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  assert(requiredMigrations.length > 0, 'Migration source directory is empty');
  for (const requiredMigration of requiredMigrations) {
    assert(
      appliedMigrationNames.has(requiredMigration),
      `Required migration is missing: ${requiredMigration}`,
    );
  }

  const extensions = await prisma.$queryRaw<
    Array<{ extname: string }>
  >`SELECT extname FROM pg_extension WHERE extname = 'vector'`;
  assert(extensions.length === 1, 'pgvector extension is not installed');

  const indexes = await prisma.$queryRaw<
    Array<{ indexname: string }>
  >`SELECT indexname
    FROM pg_indexes
    WHERE indexname IN (
      'rag_chunk_embedding_hnsw',
      'ResortRevenueRecord_ResortId_ReportDate_key',
      'ConsumedEvent_pkey',
      'Permission_PermissionKey_key',
      'AiMessage_ConversationId_ClientRequestId_key',
      'AiMessage_ParentMessageId_key',
      'AiConversation_UserId_DeletedAt_UpdateTime_idx',
      'User_AvatarAssetId_idx',
      'RevenueWriteRequest_pkey',
      'RevenueWriteRequest_ExpiresAt_idx',
      'RevenueImportJob_ActorUserId_RequestId_key',
      'RevenueImportJob_Status_NextAttemptAt_LeaseUntil_idx',
      'RevenueImportJob_InputExpiresAt_idx',
      'RevenueImportJob_ResultExpiresAt_idx',
      'RevenueImportRow_JobId_Status_RowNumber_idx',
      'LoginAttemptBucket_pkey',
      'LoginAttemptBucket_ExpiresAt_idx',
      'Asset_cleanup_candidates', 'SkiResort_CustomFields_gin', 'Article_CustomFields_gin', 'Dynamic_CustomFields_gin'
    )`;
  const indexNames = new Set(indexes.map(({ indexname }) => indexname));
  for (const requiredIndex of [
    'rag_chunk_embedding_hnsw',
    'ResortRevenueRecord_ResortId_ReportDate_key',
    'ConsumedEvent_pkey',
    'Permission_PermissionKey_key',
    'AiMessage_ConversationId_ClientRequestId_key',
    'AiMessage_ParentMessageId_key',
    'AiConversation_UserId_DeletedAt_UpdateTime_idx',
    'User_AvatarAssetId_idx',
    'RevenueWriteRequest_pkey',
    'RevenueWriteRequest_ExpiresAt_idx',
    'RevenueImportJob_ActorUserId_RequestId_key',
    'RevenueImportJob_Status_NextAttemptAt_LeaseUntil_idx',
    'RevenueImportJob_InputExpiresAt_idx',
    'RevenueImportJob_ResultExpiresAt_idx',
    'RevenueImportRow_JobId_Status_RowNumber_idx',
    'LoginAttemptBucket_pkey',
    'LoginAttemptBucket_ExpiresAt_idx',
    'Asset_cleanup_candidates',
    'SkiResort_CustomFields_gin',
    'Article_CustomFields_gin',
    'Dynamic_CustomFields_gin',
  ]) {
    assert(
      indexNames.has(requiredIndex),
      `Required index is missing: ${requiredIndex}`,
    );
  }

  const constraints = await prisma.$queryRaw<
    Array<{ conname: string }>
  >`SELECT conname
    FROM pg_constraint
    WHERE conname IN (
      'OutboxEvent_lease_check',
      'OutboxEvent_status_check',
      'ResortRevenueRecord_Amount_check',
      'Role_DataScope_check',
      'RagDocument_MerchantScope_check',
      'AiMessage_GenerationStatus_check',
      'AiMessage_GenerationLease_check',
      'User_AvatarAssetId_fkey',
      'RevenueWriteRequest_Operation_check',
      'RevenueWriteRequest_Actor_check',
      'RevenueWriteRequest_Expiry_check',
      'RevenueImportJob_state_check',
      'RevenueImportJob_lease_check',
      'RevenueImportJob_retention_check',
      'RevenueImportRow_state_check',
      'RevenueImportRow_JobId_fkey',
      'RagDocument_ControlVersion_positive',
      'RagDocument_IndexGeneration_nonnegative',
      'LoginAttemptBucket_Attempts_check',
      'LoginAttemptBucket_Key_check', 'MerchantProfile_Version_positive'
    )`;
  const constraintNames = new Set(constraints.map(({ conname }) => conname));
  for (const requiredConstraint of [
    'OutboxEvent_lease_check',
    'OutboxEvent_status_check',
    'ResortRevenueRecord_Amount_check',
    'Role_DataScope_check',
    'RagDocument_MerchantScope_check',
    'AiMessage_GenerationStatus_check',
    'AiMessage_GenerationLease_check',
    'User_AvatarAssetId_fkey',
    'RevenueWriteRequest_Operation_check',
    'RevenueWriteRequest_Actor_check',
    'RevenueWriteRequest_Expiry_check',
    'RevenueImportJob_state_check',
    'RevenueImportJob_lease_check',
    'RevenueImportJob_retention_check',
    'RevenueImportRow_state_check',
    'RevenueImportRow_JobId_fkey',
    'RagDocument_ControlVersion_positive',
    'RagDocument_IndexGeneration_nonnegative',
    'LoginAttemptBucket_Attempts_check',
    'LoginAttemptBucket_Key_check',
    'MerchantProfile_Version_positive',
  ]) {
    assert(
      constraintNames.has(requiredConstraint),
      `Required database constraint is missing: ${requiredConstraint}`,
    );
  }

  const lifecycleColumns = await prisma.$queryRaw<
    Array<{
      table_name: string;
      column_name: string;
      data_type: string;
      is_nullable: string;
    }>
  >`SELECT table_name,column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema=current_schema() AND ((table_name='MerchantProfile' AND column_name IN ('Version','CreateTime','UpdateTime')) OR (table_name='RagDocument' AND column_name IN ('LastFailureReason','LastFailureAt','IndexStartedAt')) OR (table_name='Asset' AND column_name IN ('StorageDeletedAt','CleanupFailureCode')))`;
  assert(
    lifecycleColumns.length === 8,
    'Merchant lifecycle / RAG reason / storage cleanup columns missing',
  );
  assert(
    lifecycleColumns.find(
      (c) => c.table_name === 'MerchantProfile' && c.column_name === 'Version',
    )?.is_nullable === 'NO',
    'Merchant version must not be nullable',
  );
  const avatarForeignKey = await prisma.$queryRaw<
    Array<{ confdeltype: string }>
  >`SELECT confdeltype::text AS confdeltype FROM pg_constraint
    WHERE conname = 'User_AvatarAssetId_fkey' AND conrelid = '"User"'::regclass`;
  assert(
    avatarForeignKey[0]?.confdeltype === 'r',
    'Avatar asset foreign key must restrict deletion',
  );
  const avatarColumn = await prisma.$queryRaw<
    Array<{ data_type: string; is_nullable: string }>
  >`SELECT data_type, is_nullable FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'User' AND column_name = 'AvatarAssetId'`;
  assert(
    avatarColumn[0]?.data_type === 'bigint' &&
      avatarColumn[0]?.is_nullable === 'YES',
    'AvatarAssetId must be nullable bigint',
  );

  const ragControlColumns = await prisma.$queryRaw<
    Array<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>
  >`SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'RagDocument'
      AND column_name IN ('ManualDisabled', 'ControlVersion', 'IndexGeneration')`;
  for (const [name, type, defaultValue] of [
    ['ManualDisabled', 'boolean', 'false'],
    ['ControlVersion', 'integer', '1'],
    ['IndexGeneration', 'bigint', '0'],
  ]) {
    const column = ragControlColumns.find((row) => row.column_name === name);
    assert(
      column?.data_type === type &&
        column.is_nullable === 'NO' &&
        column.column_default === defaultValue,
      `RAG control column ${name} must be non-null ${type} with default ${defaultValue}`,
    );
  }

  const builtInRoles = await prisma.role.findMany({
    where: {
      SystemRoleCode: {
        in: ['registered_user', 'merchant_template', 'system_admin'],
      },
    },
    include: { RolePermissions: { include: { Permission: true } } },
  });
  assert(builtInRoles.length === 3, 'Built-in role seed is incomplete');
  const roles = new Map(
    builtInRoles.map((role) => [role.SystemRoleCode, role]),
  );
  assert(
    roles.get('registered_user')?.DataScope === 'self',
    'User scope must be self',
  );
  assert(
    roles.get('merchant_template')?.DataScope === 'merchant',
    'Merchant scope must be merchant',
  );
  assert(
    roles.get('system_admin')?.DataScope === 'all',
    'System administrator scope must be all',
  );

  const permissionKeys = (roleKey: string): Set<string> => {
    const role = roles.get(roleKey);
    assert(role, `Missing built-in role: ${roleKey}`);
    return new Set(
      role.RolePermissions.map(({ Permission }) => Permission.PermissionKey),
    );
  };
  const merchantPermissions = permissionKeys('merchant_template');
  const adminPermissions = permissionKeys('system_admin');
  for (const key of [
    'system:user:reset-password',
    'system:event:list',
    'system:event:retry',
    'ai:knowledge:list',
    'ai:knowledge:reindex',
    'ai:knowledge:disable',
    'system:ai-conversation:list',
    'system:ai-conversation:read-content',
  ]) {
    assert(
      adminPermissions.has(key),
      `System administrator must receive ${key}`,
    );
    assert(
      !merchantPermissions.has(key) &&
        !permissionKeys('registered_user').has(key),
      `Non-admin templates must not receive ${key}`,
    );
  }
  assert(
    permissionKeys('registered_user').has('ai:conversation:use'),
    'Registered user template must include AI conversation use',
  );
  assert(
    merchantPermissions.has('revenue:merchant:list'),
    'Merchant must be able to read its revenue',
  );
  assert(
    !merchantPermissions.has('revenue:system:upsert'),
    'Merchant must not receive system revenue write permission',
  );
  assert(
    adminPermissions.has('revenue:system:list') &&
      adminPermissions.has('revenue:system:upsert'),
    'System administrator must receive revenue write permission',
  );

  const initialAdminAccount = process.env.INITIAL_ADMIN_ACCOUNT?.trim();
  assert(initialAdminAccount, 'CI initial administrator account is required');
  const admin = await prisma.user.findUnique({
    where: { Account: initialAdminAccount },
    include: { UserRoles: { include: { Role: true } } },
  });
  assert(admin, 'Initial administrator was not created');
  assert(admin.Status === 'active', 'Initial administrator is not active');
  assert(
    admin.UserRoles.length === 1 &&
      admin.UserRoles[0]?.Role.RoleKey === 'system_admin',
    'Initial administrator must have only the system_admin role',
  );

  console.info(
    `Database verified: ${migrations.length} migrations including the committed baseline, pgvector/HNSW, ${indexNames.size} uniqueness/vector indexes, ${constraintNames.size} database constraints, RAG control columns/defaults, ${builtInRoles.length} built-in roles, initial administrator, and revenue/AI permission boundaries.`,
  );
}

verifyDatabase()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
