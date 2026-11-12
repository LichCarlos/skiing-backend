import { RagSourceReindexEventHandler } from '../src/modules/ai-assistant/application/rag-source-reindex-event-handler.js';
import { RevenueImportEventHandler } from '../src/modules/resort-management/application/revenue-import-event-handler.js';
import { RevenueImportService } from '../src/modules/resort-management/application/revenue-import.service.js';
import { PrismaRevenueImportRepository } from '../src/modules/resort-management/infrastructure/prisma-revenue-import.repository.js';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { ConfigService } from '@nestjs/config';
import { Kafka, logLevel, type Admin } from 'kafkajs';
import { PrismaService } from '../src/shared/persistence/prisma.service.js';
import { ArticleRagEventHandler } from '../src/modules/ai-assistant/application/article-rag-event-handler.js';
import { DictionaryRagEventHandler } from '../src/modules/ai-assistant/application/dictionary-rag-event-handler.js';
import { DynamicRagEventHandler } from '../src/modules/ai-assistant/application/dynamic-rag-event-handler.js';
import { ProjectKnowledgeRagEventHandler } from '../src/modules/ai-assistant/application/project-knowledge-rag-event-handler.js';
import { ResortRagEventHandler } from '../src/modules/ai-assistant/application/resort-rag-event-handler.js';
import { RagDocumentIndexingService } from '../src/modules/ai-assistant/application/rag-document-indexing.service.js';
import { PrismaRagCandidateRetriever } from '../src/modules/ai-assistant/infrastructure/prisma-rag-candidate-retriever.js';
import { PrismaRagDocumentWriter } from '../src/modules/ai-assistant/infrastructure/prisma-rag-document-writer.js';
import { PrismaRagSourceReader } from '../src/modules/ai-assistant/infrastructure/prisma-rag-source.reader.js';
import { OutboxDeliveryService } from '../src/modules/integration-events/application/outbox-delivery.service.js';
import type { IntegrationEvent } from '../src/modules/integration-events/domain/integration-event.js';
import { appendOutboxEvent } from '../src/modules/integration-events/infrastructure/append-outbox-event.js';
import { KafkaEventConsumer } from '../src/modules/integration-events/infrastructure/kafka-event.consumer.js';
import { KafkaEventPublisher } from '../src/modules/integration-events/infrastructure/kafka-event.publisher.js';
import { PrismaInboxExecutor } from '../src/modules/integration-events/infrastructure/prisma-inbox.executor.js';
import { PrismaOutboxStore } from '../src/modules/integration-events/infrastructure/prisma-outbox.store.js';
import { recoveryBroker } from './helpers/kafka-recovery-broker.js';
import { waitForTopicLeaders } from './helpers/kafka-topic-readiness.js';
import { observeCommittedOffset } from './helpers/kafka-offset-observer.js';
import {
  integrationKafkaClientConfig,
  integrationKafkaSettings,
} from './helpers/kafka-integration-transport.js';

const CONSUMER_KEY = 'rag-project-knowledge-indexer.v1';
const vector = Array.from({ length: 1024 }, (_, index) =>
  index === 0 ? 1 : 0,
);

async function eventually(
  check: () => Promise<boolean>,
  description: string,
  timeout = 25_000,
) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

describe('real Kafka / PostgreSQL Outbox / Inbox / pgvector integration', () => {
  const prisma = new PrismaService();
  const store = new PrismaOutboxStore(prisma);
  let admin: Admin;
  let config: ConfigService;
  let publisher: KafkaEventPublisher;
  let consumer: KafkaEventConsumer | undefined;
  const otherConsumers: KafkaEventConsumer[] = [];
  let projectHandler: ProjectKnowledgeRagEventHandler;
  let handlers: ConstructorParameters<typeof KafkaEventConsumer>;
  let topic: string;
  let group: string;
  const projects: number[] = [];
  const events: string[] = [];
  const extraSourceKeys: string[] = [];
  const fixtureCleanup: (() => Promise<unknown>)[] = [];
  const embed = vi.fn(async (texts: readonly string[]) =>
    texts.map(() => vector),
  );
  const cleanupReleases: (() => void)[] = [];

  beforeAll(async () => {
    if (!process.env.DATABASE_URL || !process.env.KAFKA_INTEGRATION_BROKERS)
      throw new Error(
        'Dedicated DATABASE_URL and KAFKA_INTEGRATION_BROKERS are required',
      );
    await prisma.$connect();
    admin = new Kafka({
      ...integrationKafkaClientConfig('admin'),
      clientId: 'linji-integration-tests',
      logLevel: logLevel.ERROR,
    }).admin();
    await admin.connect();
  });

  beforeEach(async () => {
    // A dedicated database is required: the production dispatcher claims all due rows.
    expect(
      await prisma.outboxEvent.count({
        where: { Status: { in: ['pending', 'processing'] } },
      }),
    ).toBe(0);
    const key = randomUUID();
    topic = `linji-it-${key}`;
    group = `linji-it-${key}`;
    await admin.createTopics({
      topics: [{ topic, numPartitions: 1, replicationFactor: 1 }],
      waitForLeaders: false,
    });
    await waitForTopicLeaders(admin, topic, 1);
    config = new ConfigService({
      ...integrationKafkaSettings(),
      KAFKA_EVENTS_TOPIC: topic,
      KAFKA_CONSUMER_GROUP: group,
      KAFKA_CONSUMER_ENABLED: 'true',
      EMBEDDING_MODEL: 'BAAI/bge-m3',
    });
    embed
      .mockReset()
      .mockImplementation(async (texts) => texts.map(() => vector));
    const writer = new PrismaRagDocumentWriter(prisma);
    const sources = new PrismaRagSourceReader(prisma);
    const inbox = new PrismaInboxExecutor(prisma);
    const indexing = new RagDocumentIndexingService(config, { embed }, writer);
    const dependencies = [sources, inbox, indexing, writer] as const;
    projectHandler = new ProjectKnowledgeRagEventHandler(...dependencies);
    handlers = [
      config,
      new ResortRagEventHandler(...dependencies),
      new ArticleRagEventHandler(...dependencies),
      projectHandler,
      new DynamicRagEventHandler(...dependencies),
      new DictionaryRagEventHandler(...dependencies),
      new RevenueImportEventHandler(
        inbox,
        new RevenueImportService(new PrismaRevenueImportRepository(prisma)),
      ),
      new RagSourceReindexEventHandler(sources, inbox, writer, indexing),
    ];
    publisher = new KafkaEventPublisher(config);
  });

  afterEach(async () => {
    for (const release of cleanupReleases.splice(0)) release();
    try {
      await consumer?.onModuleDestroy();
      consumer = undefined;
      for (const other of otherConsumers.splice(0))
        await other.onModuleDestroy();
      await publisher?.beforeApplicationShutdown();
      if (topic) await admin.deleteTopics({ topics: [topic] });
      if (group) await admin.deleteGroups([group]);
    } finally {
      await prisma.consumedEvent.deleteMany({
        where: { EventId: { in: events } },
      });
      await prisma.outboxEvent.deleteMany({
        where: { EventId: { in: events } },
      });
      await prisma.ragDocument.deleteMany({
        where: {
          SourceKey: {
            in: [...projects.map((id) => `project:${id}`), ...extraSourceKeys],
          },
        },
      });
      for (const cleanup of fixtureCleanup.splice(0).reverse()) await cleanup();
      await prisma.projectKnowledge.deleteMany({
        where: { ProjectKnowledgeId: { in: projects } },
      });
      projects.length = 0;
      events.length = 0;
      extraSourceKeys.length = 0;
    }
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    await admin?.disconnect();
    await prisma.$disconnect();
  });

  async function startConsumerInstance() {
    const instance = new KafkaEventConsumer(...handlers);
    // Exercise the public production lifecycle, without enabling unrelated test workers.
    const previous = process.env.NODE_ENV;
    vi.stubEnv('NODE_ENV', 'integration');
    instance.onApplicationBootstrap();
    vi.stubEnv('NODE_ENV', previous);
    return instance;
  }

  async function startConsumer() {
    consumer = await startConsumerInstance();
    await eventually(async () => {
      const result = await admin.describeGroups([group]);
      return result.groups[0]?.state === 'Stable';
    }, 'consumer group assignment');
  }

  async function committedOffset() {
    return observeCommittedOffset(admin, group, topic);
  }

  async function waitForOffset(offset: string) {
    await eventually(
      async () => (await committedOffset()) === offset,
      `committed offset ${offset}`,
    );
  }

  async function appendProject(): Promise<IntegrationEvent> {
    return prisma.$transaction(async (tx) => {
      const row = await tx.projectKnowledge.create({
        data: {
          Title: 'Kafka project knowledge',
          Content: 'Ski service opening information.',
          Category: 'guide',
          Status: 'published',
          PublishTime: new Date(),
        },
      });
      projects.push(row.ProjectKnowledgeId);
      await appendOutboxEvent(tx, {
        eventType: 'project_doc.changed.v1',
        aggregateType: 'project_doc',
        aggregateId: String(row.ProjectKnowledgeId),
        payload: { projectKnowledgeId: row.ProjectKnowledgeId },
      });
      const event = await tx.outboxEvent.findFirstOrThrow({
        where: {
          AggregateId: String(row.ProjectKnowledgeId),
          AggregateType: 'project_doc',
        },
      });
      events.push(event.EventId);
      return {
        eventId: event.EventId,
        eventType: event.EventType,
        aggregateType: event.AggregateType,
        aggregateId: event.AggregateId,
        occurredAt: event.OccurredAt,
        payload: { projectKnowledgeId: row.ProjectKnowledgeId },
      };
    });
  }

  async function dispatch() {
    return new OutboxDeliveryService(store, publisher).dispatchBatch();
  }

  async function queue(
    event: Omit<IntegrationEvent, 'eventId' | 'occurredAt'>,
  ) {
    const eventId = randomUUID();
    events.push(eventId);
    await prisma.outboxEvent.create({
      data: {
        EventId: eventId,
        EventType: event.eventType,
        AggregateType: event.aggregateType,
        AggregateId: event.aggregateId,
        Payload: event.payload,
      },
    });
  }

  async function expectIndexed(event: IntegrationEvent) {
    const document = await prisma.ragDocument.findUniqueOrThrow({
      where: { SourceKey: `project:${event.aggregateId}` },
      include: { Chunks: true },
    });
    expect(document.Status).toBe('indexed');
    expect(document.Chunks).toHaveLength(1);
    expect(
      await prisma.consumedEvent.findUniqueOrThrow({
        where: {
          ConsumerKey_EventId: {
            ConsumerKey: CONSUMER_KEY,
            EventId: event.eventId,
          },
        },
      }),
    ).toMatchObject({ Status: 'completed', LockToken: null });
    const matches = await new PrismaRagCandidateRetriever(prisma).search(
      { embedding: vector, embeddingModel: 'BAAI/bge-m3', limit: 10 },
      { public: true, merchant: { kind: 'none' }, admin: false },
    );
    expect(
      matches.some((candidate) => candidate.sourceKey === document.SourceKey),
    ).toBe(true);
    return document;
  }

  it('consumes an acknowledged Outbox backlog when a new group starts later', async () => {
    const event = await appendProject();
    expect(await dispatch()).toEqual({
      claimed: 1,
      published: 1,
      scheduled: 0,
      failed: 0,
    });
    expect(
      await prisma.outboxEvent.findUniqueOrThrow({
        where: { EventId: event.eventId },
      }),
    ).toMatchObject({ Status: 'published', Attempts: 1 });
    // No consumer has joined: this event must survive first deployment/startup order.
    await startConsumer();
    await waitForOffset('1');
    await expectIndexed(event);
    expect(embed).toHaveBeenCalledTimes(1);
  });

  it('acknowledges duplicate Kafka records without repeating the completed Inbox effect', async () => {
    await startConsumer();
    const event = await appendProject();
    await dispatch();
    await waitForOffset('1');
    const first = await expectIndexed(event);
    await publisher.publish(event);
    await waitForOffset('2');
    const second = await expectIndexed(event);
    expect(second.IndexedAt).toEqual(first.IndexedAt);
    expect(second.Chunks.map((chunk) => chunk.RagChunkId)).toEqual(
      first.Chunks.map((chunk) => chunk.RagChunkId),
    );
    expect(embed).toHaveBeenCalledTimes(1);
    expect(
      await prisma.consumedEvent.count({ where: { EventId: event.eventId } }),
    ).toBe(1);
  });

  it('keeps group membership while indexing exceeds the default session timeout and commits only the completed effect', async () => {
    await startConsumer();
    const before = (await admin.describeGroups([group])).groups[0]!;
    expect(before.state).toBe('Stable');
    expect(before.members).toHaveLength(1);
    const memberId = before.members[0]!.memberId;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    cleanupReleases.push(release);
    let entered = false;
    embed.mockImplementationOnce(async (texts) => {
      entered = true;
      await gate;
      return texts.map(() => vector);
    });
    const event = await appendProject();
    await dispatch();
    await eventually(async () => entered, 'long embedding started');
    try {
      // KafkaJS 2.2.4 defaults to a 30-second session timeout. Poll past it
      // while the real handler remains blocked, without changing that timeout.
      const until = Date.now() + 35_000;
      while (Date.now() < until) {
        await delay(1_000);
        const current = (await admin.describeGroups([group])).groups[0]!;
        expect(current.state).toBe('Stable');
        expect(current.members.map((member) => member.memberId)).toEqual([
          memberId,
        ]);
        expect(['-1', '0']).toContain(await committedOffset());
        expect(
          await prisma.consumedEvent.count({
            where: { EventId: event.eventId, Status: 'completed' },
          }),
        ).toBe(0);
      }
    } finally {
      release();
    }
    await waitForOffset('1');
    await expectIndexed(event);
    expect(embed).toHaveBeenCalledOnce();
    expect(
      (await admin.describeGroups([group])).groups[0]!.members.map(
        (member) => member.memberId,
      ),
    ).toEqual([memberId]);
  }, 90_000);

  it('rebalances three partitions across live consumers and resumes all partitions after one leaves', async () => {
    await admin.createPartitions({ topicPartitions: [{ topic, count: 3 }] });
    await waitForTopicLeaders(admin, topic, 3);
    await startConsumer();
    const first = await appendProject();
    await dispatch();
    await eventually(
      async () =>
        (await prisma.consumedEvent.count({
          where: { EventId: first.eventId, Status: 'completed' },
        })) === 1,
      'initial partition effect',
    );
    const document = await expectIndexed(first);
    const peer = await startConsumerInstance();
    otherConsumers.push(peer);
    await eventually(async () => {
      const description = (await admin.describeGroups([group])).groups[0];
      return (
        description?.state === 'Stable' && description.members.length === 2
      );
    }, 'two-member rebalance');

    // Explicit test-producer partitions ensure every assigned partition is exercised.
    const producer = new Kafka({
      ...integrationKafkaClientConfig(),
      clientId: 'linji-rebalance-fixture',
      logLevel: logLevel.ERROR,
    }).producer();
    const expectedOffsets = new Map<number, bigint>();
    await producer.connect();
    try {
      const before = await admin.fetchTopicOffsets(topic);
      for (const partition of before)
        expectedOffsets.set(partition.partition, BigInt(partition.offset));
      const batch = await Promise.all([
        appendProject(),
        appendProject(),
        appendProject(),
      ]);
      // Keep production Outbox publishing as well; the repeated IDs must not re-embed.
      await dispatch();
      for (const [partition, event] of batch.entries()) {
        await producer.send({
          topic,
          messages: [
            { partition, key: event.aggregateId, value: JSON.stringify(event) },
          ],
        });
      }
      const offsets = await admin.fetchTopicOffsets(topic);
      expect(
        offsets.every(
          (item) => BigInt(item.offset) > expectedOffsets.get(item.partition)!,
        ),
      ).toBe(true);
      await eventually(async () => {
        const current =
          (await admin.fetchOffsets({ groupId: group, topics: [topic] }))[0]
            ?.partitions ?? [];
        return offsets.every((expected) =>
          current.some(
            (actual) =>
              actual.partition === expected.partition &&
              actual.offset === expected.offset,
          ),
        );
      }, 'all partitions committed after joining');
      for (const event of batch) await expectIndexed(event);
      expect(embed).toHaveBeenCalledTimes(4);

      await peer.onModuleDestroy();
      otherConsumers.splice(otherConsumers.indexOf(peer), 1);
      await eventually(async () => {
        const description = (await admin.describeGroups([group])).groups[0];
        return (
          description?.state === 'Stable' && description.members.length === 1
        );
      }, 'single-member reassignment');
      // Replay every original ID across all partitions after ownership changes.
      for (const partition of [0, 1, 2]) {
        await producer.send({
          topic,
          messages: [
            { partition, key: first.aggregateId, value: JSON.stringify(first) },
          ],
        });
      }
      const final = await admin.fetchTopicOffsets(topic);
      await eventually(async () => {
        const current =
          (await admin.fetchOffsets({ groupId: group, topics: [topic] }))[0]
            ?.partitions ?? [];
        return final.every((expected) =>
          current.some(
            (actual) =>
              actual.partition === expected.partition &&
              actual.offset === expected.offset,
          ),
        );
      }, 'all partitions committed after leaving');
      const unchanged = await expectIndexed(first);
      expect(unchanged.Chunks.map((chunk) => chunk.RagChunkId)).toEqual(
        document.Chunks.map((chunk) => chunk.RagChunkId),
      );
      expect(unchanged.IndexedAt).toEqual(document.IndexedAt);
      expect(embed).toHaveBeenCalledTimes(4);
      expect(
        await prisma.consumedEvent.count({
          where: { EventId: { in: events }, Status: 'completed' },
        }),
      ).toBe(4);
    } finally {
      await producer.disconnect();
    }
  }, 120_000);

  it.skipIf(
    !process.env.KAFKA_RECOVERY_CONTAINER_ID &&
      !process.env.KAFKA_RECOVERY_NATIVE_URL,
  )(
    'recovers the same publisher and consumer after a real broker outage without losing pending Outbox events',
    async () => {
      const broker = await recoveryBroker();
      await startConsumer();
      const first = await appendProject();
      await dispatch();
      await waitForOffset('1');
      const indexed = await expectIndexed(first);
      const liveConsumer = consumer;
      const livePublisher = publisher;
      let queued!: IntegrationEvent;
      try {
        await broker.stop();
        queued = await appendProject();
        expect(await dispatch()).toEqual({
          claimed: 1,
          published: 0,
          scheduled: 1,
          failed: 0,
        });
        const failureReturnedAt = Date.now();
        const pending = await prisma.outboxEvent.findUniqueOrThrow({
          where: { EventId: queued.eventId },
        });
        expect(pending).toMatchObject({
          Status: 'pending',
          Attempts: 1,
          LockToken: null,
          PublishedAt: null,
        });
        expect(pending.AvailableAt.getTime()).toBeGreaterThan(
          failureReturnedAt + 500,
        );
        expect(
          await prisma.consumedEvent.count({
            where: { EventId: queued.eventId },
          }),
        ).toBe(0);
        expect(
          await prisma.ragDocument.count({
            where: { SourceKey: `project:${queued.aggregateId}` },
          }),
        ).toBe(0);
      } finally {
        // Restart even on assertion failure so cleanup cannot strand the dedicated broker.
        await broker.start();
      }
      await eventually(
        async () => {
          try {
            return (
              (await admin.fetchTopicMetadata({ topics: [topic] })).topics[0]
                ?.partitions.length === 1
            );
          } catch {
            return false;
          }
        },
        'broker metadata after restarting the same dedicated broker',
        90_000,
      );
      const pending = await prisma.outboxEvent.findUniqueOrThrow({
        where: { EventId: queued.eventId },
      });
      await delay(Math.max(0, pending.AvailableAt.getTime() - Date.now()) + 20);
      expect(await dispatch()).toEqual({
        claimed: 1,
        published: 1,
        scheduled: 0,
        failed: 0,
      });
      await eventually(
        async () => (await committedOffset()) === '2',
        'recovered consumer commit',
        90_000,
      );
      expect(consumer).toBe(liveConsumer);
      expect(publisher).toBe(livePublisher);
      await expectIndexed(queued);
      expect(
        await prisma.outboxEvent.findUniqueOrThrow({
          where: { EventId: queued.eventId },
        }),
      ).toMatchObject({ Status: 'published', Attempts: 2, LockToken: null });
      const unchanged = await expectIndexed(first);
      expect(unchanged.Chunks.map((chunk) => chunk.RagChunkId)).toEqual(
        indexed.Chunks.map((chunk) => chunk.RagChunkId),
      );
      expect(embed).toHaveBeenCalledTimes(2);
    },
    240_000,
  );

  it('keeps a failed effect uncommitted and recovers through the real consumer crash/reconnect cycle', async () => {
    let release!: () => void;
    const retryGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    cleanupReleases.push(release);
    embed.mockRejectedValueOnce(
      new Error('injected transient embedding failure'),
    );
    embed.mockImplementationOnce(async (texts) => {
      await retryGate;
      return texts.map(() => vector);
    });
    await startConsumer();
    const event = await appendProject();
    await dispatch();
    await eventually(
      async () => embed.mock.calls.length === 2,
      'uncommitted event redelivery',
    );
    expect(await committedOffset()).toBe('-1');
    expect(
      await prisma.consumedEvent.findUniqueOrThrow({
        where: {
          ConsumerKey_EventId: {
            ConsumerKey: CONSUMER_KEY,
            EventId: event.eventId,
          },
        },
      }),
    ).toMatchObject({ Status: 'processing', ProcessedAt: null });
    release();
    await waitForOffset('1');
    await expectIndexed(event);
    expect(embed).toHaveBeenCalledTimes(2);
  });

  it('reclaims a producer lease after send-before-mark and fences the stale acknowledgement', async () => {
    await startConsumer();
    const event = await appendProject();
    const [abandoned] = await store.claimBatch(1, 60_000);
    expect(abandoned).toBeDefined();
    await publisher.publish(abandoned!);
    await waitForOffset('1');
    // Model a process exiting after broker ACK and before the DB acknowledgement.
    await prisma.outboxEvent.update({
      where: { EventId: event.eventId },
      data: { LockedAt: new Date(Date.now() - 120_000) },
    });
    expect(await dispatch()).toEqual({
      claimed: 1,
      published: 1,
      scheduled: 0,
      failed: 0,
    });
    await waitForOffset('2');
    expect(await store.markPublished(abandoned!, new Date())).toBe(false);
    expect(
      await prisma.outboxEvent.findUniqueOrThrow({
        where: { EventId: event.eventId },
      }),
    ).toMatchObject({ Status: 'published', Attempts: 2, LockToken: null });
    await expectIndexed(event);
    expect(embed).toHaveBeenCalledTimes(1);
  });

  it('resumes committed offsets after downtime and disables a withdrawn source', async () => {
    await startConsumer();
    const first = await appendProject();
    await dispatch();
    await waitForOffset('1');
    await expectIndexed(first);
    await consumer!.onModuleDestroy();
    consumer = undefined;
    const secondId = randomUUID();
    events.push(secondId);
    await prisma.$transaction(async (tx) => {
      await tx.projectKnowledge.update({
        where: { ProjectKnowledgeId: Number(first.aggregateId) },
        data: { Status: 'withdrawn', Version: { increment: 1 } },
      });
      await tx.outboxEvent.create({
        data: {
          EventId: secondId,
          EventType: first.eventType,
          AggregateType: first.aggregateType,
          AggregateId: first.aggregateId,
          Payload: { projectKnowledgeId: Number(first.aggregateId) },
        },
      });
    });
    await dispatch();
    const observed = vi.spyOn(projectHandler, 'handle');
    await startConsumer();
    await waitForOffset('2');
    expect(observed).toHaveBeenCalledTimes(1);
    expect(observed.mock.calls[0]![0].eventId).toBe(secondId);
    expect(
      await prisma.ragDocument.findUniqueOrThrow({
        where: { SourceKey: `project:${first.aggregateId}` },
      }),
    ).toMatchObject({ Status: 'disabled' });
    expect(
      await prisma.consumedEvent.count({
        where: {
          EventId: { in: [first.eventId, secondId] },
          Status: 'completed',
        },
      }),
    ).toBe(2);
    expect(embed).toHaveBeenCalledTimes(1);
    observed.mockRestore();
  });

  it('indexes all five source kinds through Kafka and removes their vectors after visibility changes', async () => {
    const categoryType = 'knowledge.article_category';
    const existingType = await prisma.dictionaryType.findUnique({
      where: { DictType: categoryType },
    });
    if (existingType)
      expect(existingType).toMatchObject({
        Status: 'active',
        PubliclyReadable: true,
      });
    else {
      await prisma.dictionaryType.create({
        data: {
          DictType: categoryType,
          DictName: 'Integration categories',
          GroupKey: 'knowledge',
          PubliclyReadable: true,
        },
      });
      fixtureCleanup.push(() =>
        prisma.dictionaryType.delete({ where: { DictType: categoryType } }),
      );
    }
    const item = await prisma.dictionaryItem.create({
      data: {
        DictType: categoryType,
        Value: `kafka-${randomUUID()}`,
        Label: 'Ski skills',
      },
    });
    fixtureCleanup.push(() =>
      prisma.dictionaryItem.delete({ where: { ItemId: item.ItemId } }),
    );
    const user = await prisma.user.create({
      data: {
        Account: `kafka-${randomUUID()}`,
        Nickname: 'Ski tester',
        PasswordHash: 'test-only',
        Status: 'active',
      },
    });
    fixtureCleanup.push(() =>
      prisma.user.delete({ where: { UserId: user.UserId } }),
    );
    const article = await prisma.article.create({
      data: {
        Title: 'Ski knowledge',
        Summary: 'Ski safety',
        Body: 'Follow resort signs.',
        CategoryValue: item.Value,
        AuthorId: user.UserId,
        Status: 'published',
        PublishTime: new Date(),
      },
    });
    fixtureCleanup.push(() =>
      prisma.article.delete({ where: { ArticleId: article.ArticleId } }),
    );
    const resort = await prisma.skiResort.create({
      data: {
        Name: 'Integration resort',
        LegacyDistance: 0,
        Price: 100,
        SnowCondition: 'powder',
        Description: 'Open ski trails',
        Status: 'published',
      },
    });
    fixtureCleanup.push(() =>
      prisma.skiResort.delete({ where: { ResortId: resort.ResortId } }),
    );
    const dynamic = await prisma.dynamic.create({
      data: {
        AuthorId: user.UserId,
        ResortId: resort.ResortId,
        Content: 'Ski trail report',
        Status: 'published',
      },
    });
    fixtureCleanup.push(() =>
      prisma.dynamic.delete({ where: { DynamicId: dynamic.DynamicId } }),
    );
    const project = await appendProject();
    const sourceEvents: Omit<IntegrationEvent, 'eventId' | 'occurredAt'>[] = [
      {
        eventType: 'resort.changed.v1',
        aggregateType: 'resort',
        aggregateId: String(resort.ResortId),
        payload: { resortId: resort.ResortId },
      },
      {
        eventType: 'article.changed.v1',
        aggregateType: 'article',
        aggregateId: String(article.ArticleId),
        payload: { articleId: article.ArticleId },
      },
      {
        eventType: 'dynamic.changed.v1',
        aggregateType: 'dynamic',
        aggregateId: String(dynamic.DynamicId),
        payload: { dynamicId: dynamic.DynamicId },
      },
      {
        eventType: 'dictionary.changed.v1',
        aggregateType: 'dictionary',
        aggregateId: String(item.ItemId),
        payload: { dictType: categoryType, itemId: item.ItemId },
      },
    ];
    extraSourceKeys.push(
      `resort:${resort.ResortId}`,
      `article:${article.ArticleId}`,
      `dynamic:${dynamic.DynamicId}`,
      `dictionary:${categoryType}:${item.Value}`,
    );
    for (const event of sourceEvents) await queue(event);
    await startConsumer();
    expect(await dispatch()).toEqual({
      claimed: 5,
      published: 5,
      scheduled: 0,
      failed: 0,
    });
    await waitForOffset('5');
    const keys = [`project:${project.aggregateId}`, ...extraSourceKeys];
    const documents = await prisma.ragDocument.findMany({
      where: { SourceKey: { in: keys } },
      include: { Chunks: true },
    });
    expect(documents).toHaveLength(5);
    expect(new Set(documents.map((document) => document.SourceType))).toEqual(
      new Set(['resort', 'article', 'dynamic', 'dictionary', 'project_doc']),
    );
    for (const document of documents) {
      expect(document.Status).toBe('indexed');
      expect(document.Chunks).toHaveLength(1);
    }
    const retriever = new PrismaRagCandidateRetriever(prisma);
    const query = {
      embedding: vector,
      embeddingModel: 'BAAI/bge-m3',
      limit: 50,
    };
    const access = {
      public: true,
      merchant: { kind: 'none' as const },
      admin: false,
    };
    const visible = await retriever.search(query, access);
    expect(new Set(visible.map((row) => row.sourceKey))).toEqual(new Set(keys));
    await prisma.$transaction([
      prisma.projectKnowledge.update({
        where: { ProjectKnowledgeId: Number(project.aggregateId) },
        data: { Status: 'withdrawn' },
      }),
      prisma.skiResort.update({
        where: { ResortId: resort.ResortId },
        data: { Status: 'offline' },
      }),
      prisma.article.update({
        where: { ArticleId: article.ArticleId },
        data: { Status: 'withdrawn' },
      }),
      prisma.dynamic.update({
        where: { DynamicId: dynamic.DynamicId },
        data: { Status: 'hidden' },
      }),
      prisma.dictionaryItem.update({
        where: { ItemId: item.ItemId },
        data: { Status: 'disabled' },
      }),
    ]);
    // Query-time source checks hide stale vectors even before asynchronous cleanup.
    expect(await retriever.search(query, access)).toEqual([]);
    for (const event of [...sourceEvents, project]) await queue(event);
    await dispatch();
    await waitForOffset('10');
    expect(
      await prisma.ragDocument.count({
        where: { SourceKey: { in: keys }, Status: 'disabled' },
      }),
    ).toBe(5);
    expect(
      await prisma.ragChunk.count({
        where: { Document: { SourceKey: { in: keys } } },
      }),
    ).toBe(0);
    expect(
      await prisma.consumedEvent.count({
        where: { EventId: { in: events }, Status: 'completed' },
      }),
    ).toBe(10);
    expect(embed).toHaveBeenCalledTimes(5);
  });
});
