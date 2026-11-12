import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../src/shared/persistence/prisma.service.js';
import { PrismaRagSourceManagementRepository } from '../src/modules/ai-assistant/infrastructure/prisma-rag-source-management.repository.js';
import { PrismaRagDocumentWriter } from '../src/modules/ai-assistant/infrastructure/prisma-rag-document-writer.js';
import { PrismaRagCandidateRetriever } from '../src/modules/ai-assistant/infrastructure/prisma-rag-candidate-retriever.js';
import { PrismaRagSourceReader } from '../src/modules/ai-assistant/infrastructure/prisma-rag-source.reader.js';
import { RagSourceReindexEventHandler } from '../src/modules/ai-assistant/application/rag-source-reindex-event-handler.js';
import { RagDocumentIndexingService } from '../src/modules/ai-assistant/application/rag-document-indexing.service.js';
import { RagSourceConflictError } from '../src/modules/ai-assistant/application/manage-rag-sources.js';
import { ManagementWriteAuthorizationError } from '../src/modules/identity-access/domain/management-write-authorization.js';
import { PrismaInboxExecutor } from '../src/modules/integration-events/infrastructure/prisma-inbox.executor.js';
import { resortSourceState } from '../src/modules/ai-assistant/domain/rag-source-state.js';
import type { EmbeddingProvider } from '../src/modules/ai-assistant/application/ports/embedding-provider.js';
import type { RagIndexDocument } from '../src/modules/ai-assistant/application/ports/rag-document-writer.js';
import type { IntegrationEvent } from '../src/modules/integration-events/domain/integration-event.js';

// Persistence, authorization, pgvector and Inbox are real. Only Embedding is
// deterministic; this suite does not connect to a model provider or Kafka.
describe('D-46 RAG controls / PostgreSQL atomicity and generation fencing', () => {
  const prisma = new PrismaService();
  const prefix = `rag-control-${randomUUID().slice(0, 8)}`;
  const model = `${prefix}-embedding`;
  const vector = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0));
  const embed = vi
    .fn<EmbeddingProvider['embed']>()
    .mockImplementation(async (texts) => texts.map(() => vector));
  const writer = new PrismaRagDocumentWriter(prisma);
  const repository = new PrismaRagSourceManagementRepository(prisma);
  const retriever = new PrismaRagCandidateRetriever(prisma);
  const indexing = new RagDocumentIndexingService(
    new ConfigService({ EMBEDDING_MODEL: model }),
    { embed },
    writer,
  );
  const handler = new RagSourceReindexEventHandler(
    new PrismaRagSourceReader(prisma),
    new PrismaInboxExecutor(prisma),
    writer,
    indexing,
  );
  const resortIds: number[] = [],
    documentIds: number[] = [],
    userIds: number[] = [],
    roleIds: number[] = [];
  let adminId: number, customUserId: number;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL)
      throw new Error('Dedicated migrated database required');
    await prisma.$connect();
    const adminRole = await prisma.role.findUniqueOrThrow({
      where: { RoleKey: 'system_admin' },
    });
    expect(adminRole.SystemRoleCode).toBe('system_admin');
    const permissions = await prisma.permission.findMany({
      where: {
        PermissionKey: {
          in: [
            'management:portal:enter',
            'ai:knowledge:list',
            'ai:knowledge:reindex',
            'ai:knowledge:disable',
          ],
        },
      },
    });
    expect(permissions).toHaveLength(4);
    const role = await prisma.role.create({
      data: {
        RoleKey: prefix,
        RoleName: prefix,
        DataScope: 'all',
        RolePermissions: {
          create: permissions.map(({ PermissionId }) => ({ PermissionId })),
        },
      },
    });
    roleIds.push(role.RoleId);
    adminId = await user(adminRole.RoleId);
    customUserId = await user(role.RoleId);
  });

  afterAll(async () => {
    try {
      const events = await prisma.outboxEvent.findMany({
        where: {
          AggregateType: 'RagDocument',
          AggregateId: { in: documentIds.map(String) },
        },
        select: { EventId: true },
      });
      await prisma.consumedEvent.deleteMany({
        where: { EventId: { in: events.map(({ EventId }) => EventId) } },
      });
      await prisma.outboxEvent.deleteMany({
        where: { EventId: { in: events.map(({ EventId }) => EventId) } },
      });
      await prisma.operationLog.deleteMany({
        where: { ActorUserId: { in: userIds } },
      });
      await prisma.ragDocument.deleteMany({
        where: { RagDocumentId: { in: documentIds } },
      });
      await prisma.skiResort.deleteMany({
        where: { ResortId: { in: resortIds } },
      });
      await prisma.user.deleteMany({ where: { UserId: { in: userIds } } });
      await prisma.role.deleteMany({ where: { RoleId: { in: roleIds } } });
    } finally {
      await prisma.$disconnect();
    }
  });

  async function user(roleId: number) {
    const row = await prisma.user.create({
      data: {
        Account: `${prefix}-${userIds.length}`,
        PasswordHash: 'test-only-not-a-login',
        Nickname: prefix,
        UserRoles: { create: { RoleId: roleId } },
      },
    });
    userIds.push(row.UserId);
    return row.UserId;
  }
  async function fixture() {
    const row = await prisma.skiResort.create({
      data: {
        Name: prefix,
        LegacyDistance: 0,
        Price: 100,
        SnowCondition: 'powder',
        Description: 'Public ski resort guidance',
        Status: 'published',
      },
      include: { FitTags: { include: { Item: true } } },
    });
    resortIds.push(row.ResortId);
    const document: RagIndexDocument = {
      sourceKey: `resort:${row.ResortId}`,
      sourceType: 'resort',
      sourceId: row.ResortId,
      title: row.Name,
      content: 'Public ski resort guidance',
      accessScope: 'public',
      merchantId: null,
      sourceUpdatedAt: row.UpdateTime,
      sourceState: resortSourceState(row),
    };
    await indexing.index(document);
    const persisted = await prisma.ragDocument.findUniqueOrThrow({
      where: { SourceKey: document.sourceKey },
    });
    documentIds.push(persisted.RagDocumentId);
    return {
      row,
      document,
      persisted,
      id: persisted.RagDocumentId,
      key: document.sourceKey,
    };
  }
  function command(expectedVersion = 1) {
    return {
      expectedVersion,
      reason: 'Validate RAG control behavior',
      traceId: randomUUID(),
    };
  }
  function load(id: number) {
    return prisma.ragDocument.findUniqueOrThrow({
      where: { RagDocumentId: id },
    });
  }
  function logs(id: number) {
    return prisma.operationLog.findMany({
      where: {
        TargetType: 'RagDocument',
        TargetId: String(id),
        ActorUserId: { in: userIds },
      },
    });
  }
  function events(id: number) {
    return prisma.outboxEvent.findMany({
      where: { AggregateType: 'RagDocument', AggregateId: String(id) },
    });
  }
  async function visible(key: string) {
    const rows = await retriever.search(
      { embedding: vector, embeddingModel: model, limit: 100 },
      { public: true, merchant: { kind: 'none' }, admin: false },
    );
    return rows.some((row) => row.sourceKey === key);
  }
  async function eventFor(id: number): Promise<IntegrationEvent> {
    const [row] = await events(id);
    expect(row).toBeDefined();
    return {
      eventId: row!.EventId,
      eventType: row!.EventType,
      aggregateType: row!.AggregateType,
      aggregateId: row!.AggregateId,
      occurredAt: row!.CreatedAt,
      payload: row!.Payload as IntegrationEvent['payload'],
    };
  }

  it('projects only metadata and computes eligibility/chunk-model aggregates in SQL', async () => {
    const f = await fixture();
    const result = await repository.list(adminId, {
      page: 1,
      pageSize: 100,
      keyword: prefix.toUpperCase(),
      sourceType: 'resort',
      status: 'indexed',
      manualDisabled: false,
    });
    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      ragDocumentId: f.id,
      sourceEligible: true,
      chunkCount: 1,
      embeddingModels: [model],
      embeddingDimension: 1024,
      controlVersion: 1,
    });
    expect(result.items[0]).toEqual(await repository.find(adminId, f.id));
    for (const key of ['content', 'metadata', 'chunks', 'embedding']) {
      expect(result.items[0]).not.toHaveProperty(key);
    }
    await prisma.skiResort.update({
      where: { ResortId: f.row.ResortId },
      data: { Status: 'pending_review' },
    });
    expect(await repository.find(adminId, f.id)).toMatchObject({
      sourceEligible: false,
    });
    expect(await visible(f.key)).toBe(false);
  });

  it('rejects custom roles even with every RAG grant and rejects a disabled protected actor', async () => {
    const f = await fixture();
    await expect(
      repository.list(customUserId, { page: 1, pageSize: 10 }),
    ).rejects.toBeInstanceOf(ManagementWriteAuthorizationError);
    await expect(repository.find(customUserId, f.id)).rejects.toBeInstanceOf(
      ManagementWriteAuthorizationError,
    );
    await expect(
      repository.reindex(customUserId, f.id, command()),
    ).rejects.toBeInstanceOf(ManagementWriteAuthorizationError);
    await expect(
      repository.setEnabled(customUserId, f.id, {
        ...command(),
        enabled: false,
      }),
    ).rejects.toBeInstanceOf(ManagementWriteAuthorizationError);
    await prisma.user.update({
      where: { UserId: adminId },
      data: { Status: 'disabled' },
    });
    try {
      await expect(
        repository.reindex(adminId, f.id, command()),
      ).rejects.toBeInstanceOf(ManagementWriteAuthorizationError);
    } finally {
      await prisma.user.update({
        where: { UserId: adminId },
        data: { Status: 'active' },
      });
    }
    expect(await load(f.id)).toEqual(f.persisted);
    expect(await logs(f.id)).toHaveLength(0);
    expect(await events(f.id)).toHaveLength(0);
  });

  it('atomically advances version/generation, queues a metadata-only Outbox event and audits reindex', async () => {
    const f = await fixture();
    const result = await repository.reindex(adminId, f.id, command());
    expect(result.source).toMatchObject({
      controlVersion: 2,
      status: 'pending',
      indexedAt: null,
    });
    const row = await load(f.id);
    expect(row.IndexGeneration).toBe(f.persisted.IndexGeneration + 1n);
    const [event] = await events(f.id);
    expect(event).toMatchObject({
      EventId: result.eventId,
      Status: 'pending',
      EventType: 'rag.source.reindex-requested.v1',
      Payload: {
        ragDocumentId: f.id,
        sourceKey: f.key,
        sourceType: 'resort',
        sourceId: f.row.ResortId,
        controlVersion: 2,
      },
    });
    expect(Object.keys(event!.Payload as object).sort()).toEqual([
      'controlVersion',
      'ragDocumentId',
      'sourceId',
      'sourceKey',
      'sourceType',
    ]);
    expect(await logs(f.id)).toEqual([
      expect.objectContaining({
        ActionKey: 'ai:knowledge:reindex',
        Result: 'success',
      }),
    ]);
    expect(await visible(f.key)).toBe(false);
  });

  it('disables and clears chunks without embedding and rejects old in-flight success/failure', async () => {
    const f = await fixture();
    const hash = 'a'.repeat(64);
    const claim = await writer.beginIndexing(f.document, hash, model, 1, {
      force: true,
    });
    if (claim.kind !== 'claimed') throw new Error('Expected indexing claim');
    const calls = embed.mock.calls.length;
    const result = await repository.setEnabled(adminId, f.id, {
      ...command(),
      enabled: false,
    });
    expect(result).toMatchObject({
      eventId: null,
      source: {
        manualDisabled: true,
        controlVersion: 2,
        status: 'disabled',
        chunkCount: 0,
      },
    });
    expect(embed.mock.calls).toHaveLength(calls);
    expect(
      await writer.replaceChunksAndMarkIndexed(f.key, hash, model, claim, [
        { index: 0, content: 'old', embedding: vector },
      ]),
    ).toBe(false);
    expect(await writer.markFailed(f.key, hash, claim)).toBe(false);
    expect(await writer.beginIndexing(f.document, hash, model, 1)).toEqual({
      kind: 'manual-disabled',
    });
    expect(await writer.isCurrentCommand(f.key, 1)).toBe(false);
    await expect(
      repository.reindex(adminId, f.id, command(2)),
    ).rejects.toBeInstanceOf(RagSourceConflictError);
    expect(await events(f.id)).toHaveLength(0);
    expect(await logs(f.id)).toHaveLength(1);
    expect(await visible(f.key)).toBe(false);
  });

  it('keeps same-state current-version requests side-effect free and rejects stale no-ops', async () => {
    const f = await fixture();
    expect(
      await repository.setEnabled(adminId, f.id, {
        ...command(),
        enabled: true,
      }),
    ).toMatchObject({ eventId: null });
    expect(await load(f.id)).toEqual(f.persisted);
    await repository.setEnabled(adminId, f.id, {
      ...command(),
      enabled: false,
    });
    const disabled = await load(f.id);
    expect(
      await repository.setEnabled(adminId, f.id, {
        ...command(2),
        enabled: false,
      }),
    ).toMatchObject({ eventId: null });
    await expect(
      repository.setEnabled(adminId, f.id, { ...command(), enabled: false }),
    ).rejects.toBeInstanceOf(RagSourceConflictError);
    expect(await load(f.id)).toEqual(disabled);
    expect(await logs(f.id)).toHaveLength(1);
    expect(await events(f.id)).toHaveLength(0);
  });

  it('enables indexing without publishing an ineligible business source', async () => {
    const f = await fixture();
    await repository.setEnabled(adminId, f.id, {
      ...command(),
      enabled: false,
    });
    await prisma.skiResort.update({
      where: { ResortId: f.row.ResortId },
      data: { Status: 'pending_review' },
    });
    const result = await repository.setEnabled(adminId, f.id, {
      ...command(2),
      enabled: true,
    });
    expect(result.source).toMatchObject({
      controlVersion: 3,
      manualDisabled: false,
      sourceEligible: false,
      status: 'pending',
    });
    const calls = embed.mock.calls.length;
    expect(await handler.handle(await eventFor(f.id))).toBe(true);
    expect(embed.mock.calls).toHaveLength(calls);
    expect(await load(f.id)).toMatchObject({
      Status: 'disabled',
      ManualDisabled: false,
      ControlVersion: 3,
    });
    expect(
      await prisma.skiResort.findUnique({
        where: { ResortId: f.row.ResortId },
      }),
    ).toMatchObject({ Status: 'pending_review' });
    expect(await visible(f.key)).toBe(false);
  });

  it('allows one of two same-version commands and persists exactly one event and audit', async () => {
    const f = await fixture();
    const results = await Promise.allSettled([
      repository.reindex(adminId, f.id, command()),
      repository.reindex(adminId, f.id, command()),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected');
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: expect.any(RagSourceConflictError),
    });
    expect(await load(f.id)).toMatchObject({
      ControlVersion: 2,
      IndexGeneration: f.persisted.IndexGeneration + 1n,
    });
    expect(await events(f.id)).toHaveLength(1);
    expect(await logs(f.id)).toHaveLength(1);
  });

  it.each(['reindex', 'disable', 'enable'] as const)(
    'rolls back source, chunks and Outbox when the %s audit INSERT fails',
    async (action) => {
      const f = await fixture();
      if (action === 'enable')
        await repository.setEnabled(adminId, f.id, {
          ...command(),
          enabled: false,
        });
      const before = await load(f.id);
      const chunks = await prisma.ragChunk.count({
        where: { RagDocumentId: f.id },
      });
      const logCount = (await logs(f.id)).length;
      const eventCount = (await events(f.id)).length;
      const input = {
        ...command(before.ControlVersion),
        traceId: 'x'.repeat(101),
      };
      const operation =
        action === 'reindex'
          ? repository.reindex(adminId, f.id, input)
          : repository.setEnabled(adminId, f.id, {
              ...input,
              enabled: action === 'enable',
            });
      await expect(operation).rejects.toMatchObject({ code: 'P2000' });
      expect(await load(f.id)).toEqual(before);
      expect(
        await prisma.ragChunk.count({ where: { RagDocumentId: f.id } }),
      ).toBe(chunks);
      expect(await logs(f.id)).toHaveLength(logCount);
      expect(await events(f.id)).toHaveLength(eventCount);
    },
  );

  it('fences identical-hash claims by generation and rejects a stale control version before claim', async () => {
    const f = await fixture();
    const hash = 'b'.repeat(64);
    const old = await writer.beginIndexing(f.document, hash, model, 1, {
      force: true,
    });
    const current = await writer.beginIndexing(f.document, hash, model, 1, {
      force: true,
    });
    if (old.kind !== 'claimed' || current.kind !== 'claimed')
      throw new Error('Expected two claims');
    expect(current.indexGeneration).toBe(old.indexGeneration + 1n);
    expect(
      await writer.replaceChunksAndMarkIndexed(f.key, hash, model, old, [
        { index: 0, content: 'old', embedding: vector },
      ]),
    ).toBe(false);
    expect(await writer.markFailed(f.key, hash, old)).toBe(false);
    expect(
      await writer.replaceChunksAndMarkIndexed(f.key, hash, model, current, [
        { index: 0, content: 'current', embedding: vector },
      ]),
    ).toBe(true);
    await repository.reindex(adminId, f.id, command());
    const before = await load(f.id);
    expect(
      await writer.beginIndexing(f.document, hash, model, 1, {
        force: true,
        expectedControlVersion: 1,
      }),
    ).toEqual({ kind: 'stale' });
    expect(await load(f.id)).toEqual(before);
  });

  it('excludes manually disabled sources at retrieval even if indexed chunks remain', async () => {
    const f = await fixture();
    expect(await visible(f.key)).toBe(true);
    // Simulate an inconsistent legacy row without relying on chunk deletion.
    await prisma.ragDocument.update({
      where: { RagDocumentId: f.id },
      data: { ManualDisabled: true },
    });
    expect(
      await prisma.ragChunk.count({ where: { RagDocumentId: f.id } }),
    ).toBe(1);
    expect(await visible(f.key)).toBe(false);
  });

  it('processes the durable rebuild event with real Inbox deduplication', async () => {
    const f = await fixture();
    await repository.reindex(adminId, f.id, command());
    const event = await eventFor(f.id);
    const calls = embed.mock.calls.length;
    expect(await handler.handle(event)).toBe(true);
    expect(embed.mock.calls.length).toBeGreaterThan(calls);
    expect(await visible(f.key)).toBe(true);
    const indexed = await load(f.id);
    const afterCalls = embed.mock.calls.length;
    expect(await handler.handle(event)).toBe(false);
    expect(embed.mock.calls).toHaveLength(afterCalls);
    expect(await load(f.id)).toEqual(indexed);
    expect(
      await prisma.consumedEvent.count({
        where: {
          EventId: event.eventId,
          ConsumerKey: 'rag-source-reindexer.v1',
          Status: 'completed',
        },
      }),
    ).toBe(1);
  });

  it('acknowledges obsolete events without embedding or overwriting a later disable', async () => {
    const f = await fixture();
    await repository.reindex(adminId, f.id, command());
    const event = await eventFor(f.id);
    await repository.setEnabled(adminId, f.id, {
      ...command(2),
      enabled: false,
    });
    const disabled = await load(f.id);
    const calls = embed.mock.calls.length;
    expect(await handler.handle(event)).toBe(true);
    expect(await load(f.id)).toEqual(disabled);
    expect(embed.mock.calls).toHaveLength(calls);
    expect(await visible(f.key)).toBe(false);
  });
});
