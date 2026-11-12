import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../src/shared/persistence/prisma.service.js';
import { BcryptPasswordHasher } from '../src/modules/identity-access/infrastructure/bcrypt-password-hasher.js';
import { RagDocumentIndexingService } from '../src/modules/ai-assistant/application/rag-document-indexing.service.js';
import { PrismaRagDocumentWriter } from '../src/modules/ai-assistant/infrastructure/prisma-rag-document-writer.js';
import { resortSourceState } from '../src/modules/ai-assistant/domain/rag-source-state.js';

// This script is deliberately independent of Web and never targets a normal
// development database. Run only after creating a disposable validation DB.
const database = new URL(process.env.DATABASE_URL ?? '');
const databaseName = database.pathname.slice(1);
if (
  !['localhost', '127.0.0.1', '[::1]'].includes(database.hostname) ||
  !/^linji_browser_validation_[a-z0-9_]+$/.test(databaseName) ||
  process.env.AI_BROWSER_FIXTURE_CONFIRM !== databaseName
) {
  throw new Error(
    'A loopback disposable linji_browser_validation_* DB and matching AI_BROWSER_FIXTURE_CONFIRM are required',
  );
}
const action = process.argv[2];
if (!['create', 'verify', 'cleanup'].includes(action ?? ''))
  throw new Error('Use create, verify or cleanup');
const manifestPath = resolve('storage/ai-browser-fixture.json');
const prisma = new PrismaService();

interface Manifest {
  databaseName: string;
  runId: string;
  adminAccount: string;
  auditorAccount: string;
  metadataAccount: string;
  customRagAccount: string;
  registeredAccount: string;
  conversationId: string;
  deletedConversationId: string;
  foreignConversationId: string;
  ragDocumentId: number;
  resortId: number;
  sourceTitle: string;
  privateQuestion: string;
  privateAnswer: string;
  userIds: number[];
  roleIds: number[];
}

async function create() {
  try {
    await readFile(manifestPath);
    throw new Error(
      'Fixture manifest exists; verify or clean it before creating another run',
    );
  } catch (error) {
    if (!(
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ))
      throw error;
  }
  const adminAccount = process.env.INITIAL_ADMIN_ACCOUNT?.trim();
  const password = process.env.AI_BROWSER_FIXTURE_PASSWORD;
  if (
    !adminAccount ||
    !password ||
    Buffer.byteLength(password) < 8 ||
    Buffer.byteLength(password) > 72
  )
    throw new Error(
      'Test seed administrator and 8-72 byte fixture password are required',
    );
  const admin = await prisma.user.findUniqueOrThrow({
    where: { Account: adminAccount },
    include: { UserRoles: { include: { Role: true } } },
  });
  if (
    !admin.UserRoles.some(({ Role }) => Role.SystemRoleCode === 'system_admin')
  )
    throw new Error('Seed administrator is required');
  if (
    (await prisma.user.count()) !== 1 ||
    (await prisma.ragDocument.count()) ||
    (await prisma.aiConversation.count())
  )
    throw new Error('Create requires a freshly seeded isolated database');
  const runId = `browser-${randomUUID().slice(0, 8)}`;
  const hash = await new BcryptPasswordHasher().hash(password);
  const permissions = await prisma.permission.findMany();
  const byKey = new Map(
    permissions.map((p) => [p.PermissionKey, p.PermissionId]),
  );
  const base = ['management:portal:enter', 'account:profile:read'];
  const manifest = await prisma.$transaction(async (tx) => {
    const userIds: number[] = [],
      roleIds: number[] = [];
    async function actor(label: string, keys: string[], scope = 'all') {
      const role = await tx.role.create({
        data: {
          RoleKey: `${runId}-${label}`,
          RoleName: label,
          DataScope: scope,
          RolePermissions: {
            create: keys.map((key) => {
              const PermissionId = byKey.get(key);
              if (!PermissionId) throw new Error(`Missing permission ${key}`);
              return { PermissionId };
            }),
          },
        },
      });
      roleIds.push(role.RoleId);
      const account = `${runId}-${label}`;
      const user = await tx.user.create({
        data: {
          Account: account,
          Nickname: label,
          PasswordHash: hash,
          UserRoles: { create: { RoleId: role.RoleId } },
        },
      });
      userIds.push(user.UserId);
      return { id: user.UserId, account };
    }
    const owner = await actor('registered', ['account:profile:read'], 'self');
    const foreign = await actor('foreign', ['account:profile:read'], 'self');
    const auditor = await actor('auditor', [
      ...base,
      'system:ai-conversation:list',
      'system:ai-conversation:read-content',
    ]);
    const metadata = await actor('metadata', [
      ...base,
      'system:ai-conversation:list',
    ]);
    const custom = await actor('rag-custom', [
      ...base,
      'ai:knowledge:list',
      'ai:knowledge:reindex',
      'ai:knowledge:disable',
    ]);
    const privateQuestion = `${runId}: synthetic private ski question`;
    const privateAnswer = `${runId}: synthetic private ski answer`;
    const conversation = await tx.aiConversation.create({
      data: {
        UserId: owner.id,
        Title: `${runId}-secret-title`,
        Messages: {
          create: [
            { SenderRole: 'user', Content: privateQuestion },
            {
              SenderRole: 'assistant',
              Content: privateAnswer,
              GenerationStatus: 'completed',
              Citations: [
                { sourceKey: 'article:1', title: 'Synthetic reference' },
              ],
            },
          ],
        },
      },
    });
    const deleted = await tx.aiConversation.create({
      data: {
        UserId: owner.id,
        Title: `${runId}-deleted-secret-title`,
        DeletedAt: new Date(),
      },
    });
    const other = await tx.aiConversation.create({
      data: { UserId: foreign.id, Title: `${runId}-foreign-secret-title` },
    });
    const resort = await tx.skiResort.create({
      data: {
        Name: `${runId}-public-resort`,
        Price: 100,
        LegacyDistance: 0,
        Description: 'Synthetic public ski resort guidance',
        SnowCondition: 'powder',
        Status: 'published',
      },
    });
    return {
      databaseName,
      runId,
      adminAccount,
      auditorAccount: auditor.account,
      metadataAccount: metadata.account,
      customRagAccount: custom.account,
      registeredAccount: owner.account,
      conversationId: conversation.ConversationId,
      deletedConversationId: deleted.ConversationId,
      foreignConversationId: other.ConversationId,
      ragDocumentId: 0,
      resortId: resort.ResortId,
      sourceTitle: resort.Name,
      privateQuestion,
      privateAnswer,
      userIds,
      roleIds,
    } satisfies Manifest;
  });
  await mkdir(resolve('storage'), { recursive: true });
  // Persist identity before indexing so interrupted setup can still be cleaned.
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  const row = await prisma.skiResort.findUniqueOrThrow({
    where: { ResortId: manifest.resortId },
    include: { FitTags: { include: { Item: true } } },
  });
  const vector = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0));
  const indexing = new RagDocumentIndexingService(
    new ConfigService({ EMBEDDING_MODEL: 'browser-fixture-1024' }),
    { embed: async (texts) => texts.map(() => vector) },
    new PrismaRagDocumentWriter(prisma),
  );
  await indexing.index({
    sourceKey: `resort:${row.ResortId}`,
    sourceType: 'resort',
    sourceId: row.ResortId,
    title: row.Name,
    content: row.Description,
    accessScope: 'public',
    merchantId: null,
    sourceUpdatedAt: row.UpdateTime,
    sourceState: resortSourceState(row),
  });
  manifest.ragDocumentId = (
    await prisma.ragDocument.findUniqueOrThrow({
      where: { SourceKey: `resort:${row.ResortId}` },
    })
  ).RagDocumentId;
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  console.info(
    `Synthetic fixture created at ${manifestPath}; no password is stored in the manifest.`,
  );
}

async function readManifest(): Promise<Manifest> {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Manifest;
  if (
    manifest.databaseName !== databaseName ||
    !/^browser-[0-9a-f]{8}$/.test(manifest.runId)
  )
    throw new Error('Fixture identity does not match this isolated DB');
  return manifest;
}
async function verify(manifest: Manifest) {
  const audits = await prisma.operationLog.findMany({
    where: {
      TargetId: manifest.conversationId,
      ActionKey: 'ai:conversation:read-content',
    },
    select: { Reason: true, Metadata: true, Result: true },
  });
  const source = await prisma.ragDocument.findUnique({
    where: { SourceKey: `resort:${manifest.resortId}` },
    select: {
      ControlVersion: true,
      ManualDisabled: true,
      Status: true,
      _count: { select: { Chunks: true } },
    },
  });
  const outbox = await prisma.outboxEvent.count({
    where: {
      AggregateType: 'RagDocument',
      AggregateId: String(manifest.ragDocumentId),
    },
  });
  if (
    JSON.stringify(audits).includes(manifest.privateQuestion) ||
    JSON.stringify(audits).includes(manifest.privateAnswer)
  )
    throw new Error('Content leaked into audit metadata');
  for (const reason of [
    'Browser approved review',
    'Browser metadata refresh review',
    'Browser lifecycle review',
    'Browser navigation review',
    'Browser delayed-response review',
    'Browser review after cancelled response',
  ]) {
    assert.ok(
      audits.some(
        (audit) => audit.Reason === reason && audit.Result === 'success',
      ),
      `Missing committed content audit: ${reason}`,
    );
  }
  const controls = await prisma.operationLog.findMany({
    where: {
      TargetType: 'RagDocument',
      TargetId: String(manifest.ragDocumentId),
    },
    select: { Reason: true, Result: true },
  });
  for (const reason of [
    'Browser competing source update',
    'Browser disable source',
    'Browser enable source',
    'Browser force rebuild',
    'Browser lost-response review',
  ]) {
    assert.ok(
      controls.some(
        (audit) => audit.Reason === reason && audit.Result === 'success',
      ),
      `Missing committed source audit: ${reason}`,
    );
  }
  assert.ok(
    !controls.some((audit) => audit.Reason === 'Browser stale version review'),
    'Version conflict must not commit a successful control audit',
  );
  assert.equal(source?.ManualDisabled, true);
  assert.equal(source?.Status, 'disabled');
  assert.equal(source?._count.Chunks, 0);
  assert.ok(outbox >= 3, 'Expected rebuild events were not persisted');
  console.info(JSON.stringify({ audits, source, outbox }, null, 2));
}
async function cleanup(manifest: Manifest) {
  await prisma.$transaction(async (tx) => {
    const document = await tx.ragDocument.findUnique({
      where: { SourceKey: `resort:${manifest.resortId}` },
    });
    if (document) {
      const events = await tx.outboxEvent.findMany({
        where: {
          AggregateType: 'RagDocument',
          AggregateId: String(document.RagDocumentId),
        },
        select: { EventId: true },
      });
      await tx.consumedEvent.deleteMany({
        where: { EventId: { in: events.map((e) => e.EventId) } },
      });
      await tx.outboxEvent.deleteMany({
        where: { EventId: { in: events.map((e) => e.EventId) } },
      });
      await tx.ragDocument.delete({
        where: { RagDocumentId: document.RagDocumentId },
      });
    }
    await tx.operationLog.deleteMany({
      where: {
        OR: [
          { ActorUserId: { in: manifest.userIds } },
          {
            TargetType: 'RagDocument',
            TargetId: String(manifest.ragDocumentId),
          },
        ],
      },
    });
    await tx.aiConversation.deleteMany({
      where: {
        ConversationId: {
          in: [
            manifest.conversationId,
            manifest.deletedConversationId,
            manifest.foreignConversationId,
          ],
        },
      },
    });
    await tx.skiResort.delete({ where: { ResortId: manifest.resortId } });
    await tx.user.deleteMany({
      where: {
        UserId: { in: manifest.userIds },
        Account: { startsWith: manifest.runId },
      },
    });
    await tx.role.deleteMany({
      where: {
        RoleId: { in: manifest.roleIds },
        RoleKey: { startsWith: manifest.runId },
      },
    });
  });
  await unlink(manifestPath);
  console.info(
    'Synthetic fixture removed; seed administrator/roles preserved.',
  );
}
try {
  if (action === 'create') await create();
  else {
    const manifest = await readManifest();
    if (action === 'verify') await verify(manifest);
    else await cleanup(manifest);
  }
} finally {
  await prisma.$disconnect();
}
