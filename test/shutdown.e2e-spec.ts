import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { setTimeout as delay } from 'node:timers/promises';
import { PrismaService } from '../src/shared/persistence/prisma.service.js';
import { OutboxPollingWorker } from '../src/modules/integration-events/infrastructure/outbox-polling.worker.js';
import { PrismaOutboxStore } from '../src/modules/integration-events/infrastructure/prisma-outbox.store.js';
import { RevenueRetentionWorker } from '../src/modules/resort-management/infrastructure/revenue-retention.worker.js';
import { PrismaRevenueRepository } from '../src/modules/resort-management/infrastructure/prisma-revenue.repository.js';

const transport = vi.hoisted(() => ({
  connect: vi.fn(),
  send: vi.fn(),
  disconnect: vi.fn(),
  stopConsumer: vi.fn(),
  disconnectConsumer: vi.fn(),
}));
vi.mock('kafkajs', () => ({
  Kafka: class {
    producer() {
      return {
        connect: transport.connect,
        send: transport.send,
        disconnect: transport.disconnect,
      };
    }
    consumer() {
      return {
        stop: transport.stopConsumer,
        disconnect: transport.disconnectConsumer,
      };
    }
  },
}));
import { AppModule } from '../src/app.module.js';

describe('actual Nest application shutdown phases', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('finishes active delivery and retention before closing shared Kafka/database resources', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv(
      'JWT_ACCESS_SECRET',
      'shutdown-lifecycle-validation-secret-at-least-32-bytes',
    );
    vi.stubEnv('OPENAPI_EXPORT', 'false');
    const order: string[] = [];
    let databaseOpen = true;
    let releaseSend!: () => void;
    let releasePurge!: () => void;
    const sendGate = new Promise<void>((resolve) => {
      releaseSend = resolve;
    });
    const purgeGate = new Promise<void>((resolve) => {
      releasePurge = resolve;
    });
    transport.connect.mockResolvedValue(undefined);
    transport.stopConsumer.mockResolvedValue(undefined);
    transport.disconnectConsumer.mockResolvedValue(undefined);
    transport.disconnect.mockImplementation(async () => {
      order.push('kafka-disconnect');
    });
    transport.send.mockImplementation(async () => {
      order.push('send-start');
      await sendGate;
      order.push('broker-ack');
      return [];
    });
    const prisma = new PrismaService();
    vi.spyOn(prisma, '$disconnect').mockImplementation(async () => {
      databaseOpen = false;
      order.push('database-disconnect');
    });
    const store = {
      claimBatch: vi.fn(async () => [
        {
          eventId: 'd8c369d7-22ab-4483-90d0-911fe38df932',
          eventType: 'project_doc.changed.v1',
          aggregateType: 'project_doc',
          aggregateId: '1',
          occurredAt: new Date(),
          payload: { projectKnowledgeId: 1 },
          attempts: 1,
          maxAttempts: 8,
          lockToken: 'ed38d69c-67c0-4c7f-9dc5-2a36fb6acc55',
        },
      ]),
      markPublished: vi.fn(async () => {
        expect(databaseOpen).toBe(true);
        order.push('outbox-published');
        return true;
      }),
      scheduleRetry: vi.fn(async () => true),
      markFailed: vi.fn(async () => true),
    };
    const revenue = {
      purgeExpiredResults: vi.fn(async () => {
        order.push('purge-start');
        await purgeGate;
        expect(databaseOpen).toBe(true);
        order.push('purge-complete');
        return 0;
      }),
    };
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(PrismaOutboxStore)
      .useValue(store)
      .overrideProvider(PrismaRevenueRepository)
      .useValue(revenue)
      .compile();
    const app = module.createNestApplication();
    await app.init();
    const config = app.get(ConfigService);
    config.set('OUTBOX_DISPATCH_ENABLED', 'true');
    const worker = app.get(OutboxPollingWorker);
    vi.stubEnv('NODE_ENV', 'development');
    worker.onApplicationBootstrap();
    vi.stubEnv('NODE_ENV', 'test');
    const purge = app.get(RevenueRetentionWorker).sweep();
    await vi.waitFor(() => expect(transport.send).toHaveBeenCalledOnce());
    let closed = false;
    const closing = app.close().then(() => {
      closed = true;
    });
    try {
      await delay(30);
      expect(closed).toBe(false);
      expect(order).not.toContain('kafka-disconnect');
      expect(order).not.toContain('database-disconnect');
    } finally {
      releaseSend();
      releasePurge();
      await Promise.all([purge, closing]);
    }
    expect(store.markPublished).toHaveBeenCalledOnce();
    expect(store.scheduleRetry).not.toHaveBeenCalled();
    expect(order.indexOf('kafka-disconnect')).toBeGreaterThan(
      order.indexOf('outbox-published'),
    );
    expect(order.indexOf('database-disconnect')).toBeGreaterThan(
      order.indexOf('purge-complete'),
    );
    expect(order.indexOf('database-disconnect')).toBeGreaterThan(
      order.indexOf('outbox-published'),
    );
    await app.get(RevenueRetentionWorker).sweep();
    expect(revenue.purgeExpiredResults).toHaveBeenCalledTimes(1);
  });
});
