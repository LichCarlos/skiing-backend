import { Controller, Get, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Kafka, logLevel } from 'kafkajs';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/shared/persistence/prisma.service.js';
import { Public } from '../src/modules/identity-access/presentation/http/authorization.decorators.js';
import { KafkaEventPublisher } from '../src/modules/integration-events/infrastructure/kafka-event.publisher.js';
import { PrismaRevenueRepository } from '../src/modules/resort-management/infrastructure/prisma-revenue.repository.js';
import { EMBEDDING_PROVIDER } from '../src/modules/ai-assistant/application/ports/embedding-provider.js';
import { configureHttp } from '../src/shared/http/configure-http.js';
import { appendOutboxEvent } from '../src/modules/integration-events/infrastructure/append-outbox-event.js';
import { waitForTopicLeaders } from './helpers/kafka-topic-readiness.js';
import {
  integrationKafkaClientConfig,
  integrationKafkaSettings,
} from './helpers/kafka-integration-transport.js';

function gate() {
  let complete!: () => void;
  let released = false;
  const promise = new Promise<void>((resolve) => {
    complete = resolve;
  });
  return {
    promise,
    release() {
      released = true;
      complete();
    },
    get released() {
      return released;
    },
  };
}
async function eventually(check: () => Promise<boolean>, description: string) {
  const until = Date.now() + 30_000;
  while (Date.now() < until) {
    if (await check()) return;
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

// This route exists only inside this isolated test module, never in product OpenAPI.
let httpEntered = gate();
let httpGate = gate();
@Controller('__validation/shutdown')
@Public()
class ShutdownValidationController {
  constructor(private readonly prisma: PrismaService) {}
  @Get()
  async read() {
    httpEntered.release();
    await httpGate.promise;
    const [row] = await this.prisma.$queryRaw<
      { value: number }[]
    >`SELECT 1::int AS value`;
    return row;
  }
}

describe('real Nest worker and HTTP shutdown with Kafka/PostgreSQL', () => {
  it('drains delivery/retention, keeps persistence for an active HTTP request and indexes the acknowledged backlog on restart', async () => {
    if (
      process.env.LINJI_DATABASE_TEST_DISPOSABLE !== 'true' ||
      !process.env.KAFKA_INTEGRATION_BROKERS
    )
      throw new Error('Disposable database and dedicated Kafka are required');
    const url = new URL(process.env.DATABASE_URL ?? '');
    if (
      !['127.0.0.1', 'localhost'].includes(url.hostname) ||
      !['/linji_shutdown_validation', '/linji_kafka_validation'].includes(
        url.pathname,
      )
    )
      throw new Error(
        'Only the dedicated shutdown/Kafka validation database is permitted',
      );
    const key = randomUUID();
    const topic = `linji-shutdown-${key}`,
      group = `linji-shutdown-${key}`;
    const config = new ConfigService({
      ...integrationKafkaSettings(),
      KAFKA_EVENTS_TOPIC: topic,
      KAFKA_CONSUMER_GROUP: group,
      KAFKA_CONSUMER_ENABLED: 'false',
      OUTBOX_DISPATCH_ENABLED: 'true',
      OUTBOX_POLL_INTERVAL_MS: '100',
      EMBEDDING_MODEL: 'BAAI/bge-m3',
    });
    const observer = new PrismaService();
    const admin = new Kafka({
      ...integrationKafkaClientConfig('admin'),
      clientId: 'linji-shutdown-validation',
      logLevel: logLevel.ERROR,
    }).admin();
    const sendGate = gate(),
      purgeGate = gate(),
      embeddingGate = gate(),
      embeddingEntered = gate();
    httpEntered = gate();
    httpGate = gate();
    const order: string[] = [];
    const embed = vi.fn(async (texts: readonly string[]) =>
      texts.map(() =>
        Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0)),
      ),
    );
    let app: INestApplication | undefined, closing: Promise<void> | undefined;
    let response: Promise<Response> | undefined;
    let projectId: number | undefined, eventId: string | undefined;
    async function createApp() {
      const module = await Test.createTestingModule({
        imports: [AppModule],
        controllers: [ShutdownValidationController],
      })
        .overrideProvider(ConfigService)
        .useValue(config)
        .overrideProvider(EMBEDDING_PROVIDER)
        .useValue({ embed })
        .compile();
      const instance = module.createNestApplication();
      configureHttp(instance);
      return instance;
    }
    vi.stubEnv('NODE_ENV', 'integration');
    vi.stubEnv('OPENAPI_EXPORT', 'false');
    vi.stubEnv(
      'JWT_ACCESS_SECRET',
      'shutdown-real-integration-secret-at-least-32-bytes',
    );
    try {
      await observer.$connect();
      expect(
        await observer.outboxEvent.count({
          where: { Status: { in: ['pending', 'processing'] } },
        }),
      ).toBe(0);
      await admin.connect();
      await admin.createTopics({
        topics: [{ topic, numPartitions: 1, replicationFactor: 1 }],
        waitForLeaders: false,
      });
      await waitForTopicLeaders(admin, topic, 1);
      const event = await observer.$transaction(async (tx) => {
        const project = await tx.projectKnowledge.create({
          data: {
            Title: 'Shutdown recovery fixture',
            Content: 'Ski knowledge remains available after restart.',
            Category: 'guide',
            Status: 'published',
            PublishTime: new Date(),
          },
        });
        projectId = project.ProjectKnowledgeId;
        await appendOutboxEvent(tx, {
          eventType: 'project_doc.changed.v1',
          aggregateType: 'project_doc',
          aggregateId: String(projectId),
          payload: { projectKnowledgeId: projectId },
        });
        return tx.outboxEvent.findFirstOrThrow({
          where: {
            AggregateType: 'project_doc',
            AggregateId: String(projectId),
          },
        });
      });
      eventId = event.EventId;
      app = await createApp();
      const publisher = app.get(KafkaEventPublisher);
      const publish = publisher.publish.bind(publisher);
      vi.spyOn(publisher, 'publish').mockImplementation(async (value) => {
        order.push('publish-start');
        await sendGate.promise;
        await publish(value);
        order.push('broker-ack');
      });
      const closePublisher =
        publisher.beforeApplicationShutdown.bind(publisher);
      vi.spyOn(publisher, 'beforeApplicationShutdown').mockImplementation(
        async () => {
          await closePublisher();
          order.push('producer-closed');
        },
      );
      const prisma = app.get(PrismaService);
      const disconnect = prisma.$disconnect.bind(prisma);
      vi.spyOn(prisma, '$disconnect').mockImplementation(async () => {
        await disconnect();
        order.push('database-closed');
      });
      const revenue = app.get(PrismaRevenueRepository);
      const purge = revenue.purgeExpiredResults.bind(revenue);
      vi.spyOn(revenue, 'purgeExpiredResults').mockImplementation(
        async (...args) => {
          order.push('purge-start');
          await purgeGate.promise;
          const result = await purge(...args);
          order.push('purge-completed');
          return result;
        },
      );
      await app.listen(0, '127.0.0.1');
      await eventually(
        async () =>
          order.includes('publish-start') && order.includes('purge-start'),
        'background workers at their real side effects',
      );
      response = fetch(`${await app.getUrl()}/api/v1/__validation/shutdown`);
      await eventually(
        async () => httpEntered.released,
        'active validation HTTP request',
      );
      let closed = false;
      closing = app.close().then(() => {
        closed = true;
      });
      await delay(30);
      expect(closed).toBe(false);
      expect(order).not.toContain('producer-closed');
      expect(order).not.toContain('database-closed');
      sendGate.release();
      purgeGate.release();
      await eventually(
        async () => order.includes('producer-closed'),
        'producer closing after worker drain',
      );
      expect(closed).toBe(false);
      expect(order).not.toContain('database-closed');
      expect(order.indexOf('producer-closed')).toBeGreaterThan(
        order.indexOf('broker-ack'),
      );
      expect(order.indexOf('producer-closed')).toBeGreaterThan(
        order.indexOf('purge-completed'),
      );
      httpGate.release();
      const http = await response;
      expect(http.status).toBe(200);
      expect(await http.json()).toMatchObject({ data: { value: 1 } });
      await closing;
      app = undefined;
      expect(order.at(-1)).toBe('database-closed');
      expect(
        await observer.outboxEvent.findUniqueOrThrow({
          where: { EventId: eventId },
        }),
      ).toMatchObject({ Status: 'published', Attempts: 1, LockToken: null });

      // Start the consumer in a fresh app after a publisher-only deployment closes.
      // No test dispatch or direct handler call may replace the actual bootstrap.
      config.set('KAFKA_CONSUMER_ENABLED', 'true');
      embed.mockImplementationOnce(async (texts) => {
        embeddingEntered.release();
        await embeddingGate.promise;
        return texts.map(() =>
          Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0)),
        );
      });
      app = await createApp();
      const consumerPrisma = app.get(PrismaService);
      const disconnectConsumerDatabase =
        consumerPrisma.$disconnect.bind(consumerPrisma);
      let consumerDatabaseClosed = false;
      vi.spyOn(consumerPrisma, '$disconnect').mockImplementation(async () => {
        await disconnectConsumerDatabase();
        consumerDatabaseClosed = true;
      });
      await app.init();
      await eventually(
        async () => embeddingEntered.released,
        'active RAG indexing after restarted app bootstrap',
      );
      expect(
        await observer.consumedEvent.count({
          where: { EventId: eventId, Status: 'processing' },
        }),
      ).toBe(1);
      let consumerClosed = false;
      closing = app.close().then(() => {
        consumerClosed = true;
      });
      await delay(30);
      expect(consumerClosed).toBe(false);
      expect(consumerDatabaseClosed).toBe(false);
      embeddingGate.release();
      await closing;
      app = undefined;
      expect(consumerDatabaseClosed).toBe(true);
      await eventually(
        async () =>
          (await observer.consumedEvent.count({
            where: { EventId: eventId, Status: 'completed' },
          })) === 1,
        'restarted app Inbox completion',
      );
      expect(
        await observer.ragDocument.findUniqueOrThrow({
          where: { SourceKey: `project:${projectId}` },
          include: { Chunks: true },
        }),
      ).toMatchObject({ Status: 'indexed', Chunks: [expect.anything()] });
      expect(embed).toHaveBeenCalledOnce();
      // KafkaJS stops its runner before awaiting eachMessage; commitOffsets can
      // therefore be skipped during stop. The durable Inbox must make replay safe.
      const indexed = await observer.ragDocument.findUniqueOrThrow({
        where: { SourceKey: `project:${projectId}` },
        include: { Chunks: true },
      });
      app = await createApp();
      await app.init();
      await eventually(
        async () =>
          (await admin.fetchOffsets({ groupId: group, topics: [topic] }))[0]
            ?.partitions[0]?.offset === '1',
        'offset after another restart replays any uncommitted record',
      );
      expect(
        await observer.consumedEvent.count({ where: { EventId: eventId } }),
      ).toBe(1);
      const replayed = await observer.ragDocument.findUniqueOrThrow({
        where: { SourceKey: `project:${projectId}` },
        include: { Chunks: true },
      });
      expect(replayed.Chunks.map((chunk) => chunk.RagChunkId)).toEqual(
        indexed.Chunks.map((chunk) => chunk.RagChunkId),
      );
      expect(replayed.IndexedAt).toEqual(indexed.IndexedAt);
      expect(embed).toHaveBeenCalledOnce();
    } finally {
      sendGate.release();
      purgeGate.release();
      embeddingGate.release();
      httpGate.release();
      await response?.catch(() => undefined);
      await closing?.catch(() => undefined);
      await app?.close();
      if (eventId) {
        await observer.consumedEvent.deleteMany({
          where: { EventId: eventId },
        });
        await observer.outboxEvent.deleteMany({ where: { EventId: eventId } });
      }
      if (projectId) {
        await observer.ragDocument.deleteMany({
          where: { SourceKey: `project:${projectId}` },
        });
        await observer.projectKnowledge.delete({
          where: { ProjectKnowledgeId: projectId },
        });
      }
      await admin.deleteTopics({ topics: [topic] });
      await admin.deleteGroups([group]);
      await admin.disconnect();
      await observer.$disconnect();
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
    }
  }, 90_000);
});
