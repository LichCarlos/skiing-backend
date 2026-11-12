import { ConfigService } from '@nestjs/config';
import type { ConsumerRunConfig, EachMessagePayload } from 'kafkajs';
import { RagInboxBusyError } from '../../ai-assistant/application/claim-rag-event.js';
import type { ResortRagEventHandler } from '../../ai-assistant/application/resort-rag-event-handler.js';
import type { ArticleRagEventHandler } from '../../ai-assistant/application/article-rag-event-handler.js';
import type { ProjectKnowledgeRagEventHandler } from '../../ai-assistant/application/project-knowledge-rag-event-handler.js';
import type { DynamicRagEventHandler } from '../../ai-assistant/application/dynamic-rag-event-handler.js';
import type { DictionaryRagEventHandler } from '../../ai-assistant/application/dictionary-rag-event-handler.js';
import type { RevenueImportEventHandler } from '../../resort-management/application/revenue-import-event-handler.js';
import type { RagSourceReindexEventHandler } from '../../ai-assistant/application/rag-source-reindex-event-handler.js';

const kafka = vi.hoisted(() => {
  const listeners = new Set<(event: { payload: { error: Error } }) => void>();
  return {
    listeners,
    options: vi.fn(),
    consumer: {
      connect: vi.fn(),
      subscribe: vi.fn(),
      run: vi.fn(),
      commitOffsets: vi.fn(),
      stop: vi.fn(),
      disconnect: vi.fn(),
      events: { CRASH: 'consumer.crash' },
      on: vi.fn(
        (
          _: string,
          listener: (event: { payload: { error: Error } }) => void,
        ) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      ),
    },
  };
});
vi.mock('kafkajs', () => ({
  Kafka: class {
    constructor(options: unknown) {
      kafka.options(options);
    }
    consumer() {
      return kafka.consumer;
    }
  },
}));
import { KafkaEventConsumer } from './kafka-event.consumer.js';

function setup(values: Record<string, string> = {}) {
  const handlers = Array.from({ length: 7 }, () => ({
    handle: vi.fn().mockResolvedValue(false),
  }));
  const consumer = new KafkaEventConsumer(
    new ConfigService({ KAFKA_CONSUMER_ENABLED: 'true', ...values }),
    handlers[0] as unknown as ResortRagEventHandler,
    handlers[1] as unknown as ArticleRagEventHandler,
    handlers[2] as unknown as ProjectKnowledgeRagEventHandler,
    handlers[3] as unknown as DynamicRagEventHandler,
    handlers[4] as unknown as DictionaryRagEventHandler,
    handlers[5] as unknown as RevenueImportEventHandler,
    handlers[6] as unknown as RagSourceReindexEventHandler,
  );
  return { consumer, handlers };
}

describe('Kafka consumer lifecycle and acknowledgements', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv('NODE_ENV', 'development');
    vi.clearAllMocks();
    kafka.listeners.clear();
    for (const method of [
      'connect',
      'subscribe',
      'run',
      'commitOffsets',
      'stop',
      'disconnect',
    ] as const)
      kafka.consumer[method].mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('applies the same TLS and SASL policy before any consumer connection', () => {
    setup({
      KAFKA_TLS_ENABLED: 'true',
      KAFKA_SASL_MECHANISM: 'scram-sha-256',
      KAFKA_SASL_USERNAME: 'consumer',
      KAFKA_SASL_PASSWORD: 'test-password',
    });
    expect(kafka.options).toHaveBeenCalledWith({
      clientId: 'linji-api',
      brokers: ['localhost:9092'],
      ssl: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
      sasl: {
        mechanism: 'scram-sha-256',
        username: 'consumer',
        password: 'test-password',
      },
    });
    expect(kafka.consumer.connect).not.toHaveBeenCalled();
  });

  it('stays connected after run startup and commits only completed handler work', async () => {
    const { consumer, handlers } = setup();
    consumer.onApplicationBootstrap();
    await vi.waitFor(() => expect(kafka.consumer.run).toHaveBeenCalledOnce());
    expect(kafka.consumer.disconnect).not.toHaveBeenCalled();
    expect(kafka.consumer.subscribe).toHaveBeenCalledWith({
      topic: 'linji.integration-events',
      fromBeginning: true,
    });
    const config = kafka.consumer.run.mock.calls[0]![0] as ConsumerRunConfig;
    expect(config.autoCommit).toBe(false);
    const event = {
      eventId: 'c9a5b5d0-6ba3-4fe0-8f4e-7d8478b2bacc',
      eventType: 'article.changed.v1',
      aggregateType: 'article',
      aggregateId: '7',
      occurredAt: new Date().toISOString(),
      payload: { articleId: 7 },
    };
    const delivery: EachMessagePayload = {
      heartbeat: vi.fn().mockResolvedValue(undefined),
      pause: () => () => {},
      topic: 'events',
      partition: 2,
      message: {
        key: null,
        timestamp: '0',
        attributes: 0,
        headers: {},
        offset: '9007199254740993',
        value: Buffer.from(JSON.stringify(event)),
      },
    };
    handlers[1]!.handle.mockRejectedValueOnce(new RagInboxBusyError());
    await expect(config.eachMessage!(delivery)).rejects.toBeInstanceOf(
      RagInboxBusyError,
    );
    expect(kafka.consumer.commitOffsets).not.toHaveBeenCalled();
    await config.eachMessage!(delivery);
    expect(kafka.consumer.commitOffsets).toHaveBeenCalledWith([
      { topic: 'events', partition: 2, offset: '9007199254740994' },
    ]);
    await consumer.onModuleDestroy();
    expect(kafka.listeners.size).toBe(0);
  });

  it('reconnects after crash with a delay and cancels that wait during shutdown', async () => {
    const { consumer } = setup();
    consumer.onApplicationBootstrap();
    await vi.waitFor(() => expect(kafka.consumer.run).toHaveBeenCalledOnce());
    for (const listener of kafka.listeners)
      listener({ payload: { error: new Error('broker unavailable') } });
    await vi.waitFor(() =>
      expect(kafka.consumer.disconnect).toHaveBeenCalledOnce(),
    );
    expect(kafka.consumer.connect).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(kafka.consumer.connect).toHaveBeenCalledTimes(2);
    expect(kafka.consumer.run).toHaveBeenCalledTimes(2);
    for (const listener of kafka.listeners)
      listener({ payload: { error: new Error('again') } });
    await vi.waitFor(() =>
      expect(kafka.consumer.disconnect).toHaveBeenCalledTimes(2),
    );
    await consumer.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(kafka.consumer.connect).toHaveBeenCalledTimes(2);
    expect(kafka.listeners.size).toBe(0);
  });

  it('does not start when disabled or in the test environment', () => {
    vi.stubEnv('NODE_ENV', 'test');
    setup().consumer.onApplicationBootstrap();
    expect(kafka.consumer.connect).not.toHaveBeenCalled();
  });

  it('does not connect while exporting the contract even if consumption is enabled', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('OPENAPI_EXPORT', 'true');
    setup().consumer.onApplicationBootstrap();
    expect(kafka.consumer.connect).not.toHaveBeenCalled();
  });

  async function messageRun() {
    const fixture = setup();
    fixture.consumer.onApplicationBootstrap();
    await vi.waitFor(() => expect(kafka.consumer.run).toHaveBeenCalledOnce());
    const options = kafka.consumer.run.mock.calls[0]![0] as ConsumerRunConfig;
    const heartbeat = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const delivery: EachMessagePayload = {
      topic: 'events',
      partition: 0,
      heartbeat,
      pause: () => () => {},
      message: {
        key: null,
        timestamp: '0',
        attributes: 0,
        headers: {},
        offset: '8',
        value: Buffer.from(
          JSON.stringify({
            eventId: 'c9a5b5d0-6ba3-4fe0-8f4e-7d8478b2bacc',
            eventType: 'article.changed.v1',
            aggregateType: 'article',
            aggregateId: '7',
            occurredAt: new Date().toISOString(),
            payload: { articleId: 7 },
          }),
        ),
      },
    };
    return {
      ...fixture,
      heartbeat,
      delivery,
      dispatch: () => options.eachMessage!(delivery),
    };
  }
  function deferred() {
    let resolve!: () => void, reject!: (error: unknown) => void;
    const promise = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    return { promise, resolve, reject };
  }
  it('heartbeats during work longer than the session timeout and acknowledges only after all work', async () => {
    const f = await messageRun(),
      work = deferred();
    f.handlers[1]!.handle.mockReturnValueOnce(work.promise);
    const task = f.dispatch();
    await vi.advanceTimersByTimeAsync(35_000);
    expect(f.heartbeat.mock.calls.length).toBeGreaterThanOrEqual(10);
    expect(kafka.consumer.commitOffsets).not.toHaveBeenCalled();
    work.resolve();
    await task;
    expect(kafka.consumer.commitOffsets).toHaveBeenCalledExactlyOnceWith([
      { topic: 'events', partition: 0, offset: '9' },
    ]);
    const calls = f.heartbeat.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(f.heartbeat).toHaveBeenCalledTimes(calls);
    await f.consumer.onModuleDestroy();
  });
  it('serializes heartbeats while a heartbeat is slow and drains it before committing', async () => {
    const f = await messageRun(),
      work = deferred(),
      heartbeat = deferred();
    f.handlers[1]!.handle.mockReturnValueOnce(work.promise);
    f.heartbeat.mockReturnValueOnce(heartbeat.promise);
    const task = f.dispatch();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.heartbeat).toHaveBeenCalledOnce();
    work.resolve();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(kafka.consumer.commitOffsets).not.toHaveBeenCalled();
    heartbeat.resolve();
    await task;
    expect(kafka.consumer.commitOffsets).toHaveBeenCalledOnce();
    await f.consumer.onModuleDestroy();
  });
  it('does not abandon sibling work after handler rejection and continues heartbeat while draining', async () => {
    const f = await messageRun(),
      sibling = deferred(),
      failure = new Error('handler failed');
    f.handlers[0]!.handle.mockRejectedValueOnce(failure);
    f.handlers[1]!.handle.mockReturnValueOnce(sibling.promise);
    let settled = false;
    const task = f.dispatch();
    const assertion = expect(task).rejects.toBe(failure);
    void task.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await vi.advanceTimersByTimeAsync(5000);
    expect(settled).toBe(false);
    expect(f.heartbeat.mock.calls.length).toBeGreaterThan(0);
    expect(kafka.consumer.commitOffsets).not.toHaveBeenCalled();
    sibling.resolve();
    await assertion;
    expect(kafka.consumer.commitOffsets).not.toHaveBeenCalled();
    await f.consumer.onModuleDestroy();
  });
  it('drains all started work after heartbeat failure and does not acknowledge the event', async () => {
    const f = await messageRun(),
      work = deferred(),
      failure = new Error('group ownership lost');
    f.handlers[1]!.handle.mockReturnValueOnce(work.promise);
    f.heartbeat.mockRejectedValueOnce(failure);
    let settled = false;
    const task = f.dispatch(),
      assertion = expect(task).rejects.toBe(failure);
    void task.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await vi.advanceTimersByTimeAsync(10_000);
    expect(settled).toBe(false);
    expect(f.heartbeat).toHaveBeenCalledOnce();
    work.resolve();
    await assertion;
    expect(kafka.consumer.commitOffsets).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.heartbeat).toHaveBeenCalledOnce();
    await f.consumer.onModuleDestroy();
  });
  it('checks the final heartbeat before commit even when handlers finish quickly', async () => {
    const f = await messageRun(),
      failure = new Error('rebalance');
    f.heartbeat.mockRejectedValueOnce(failure);
    await expect(f.dispatch()).rejects.toBe(failure);
    expect(kafka.consumer.commitOffsets).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    await f.consumer.onModuleDestroy();
  });
  it('waits for every handler when one throws synchronously', async () => {
    const f = await messageRun(),
      work = deferred(),
      failure = new Error('sync handler');
    f.handlers[0]!.handle.mockImplementationOnce(() => {
      throw failure;
    });
    f.handlers[6]!.handle.mockReturnValueOnce(work.promise);
    const task = f.dispatch(),
      assertion = expect(task).rejects.toBe(failure);
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.handlers[6]!.handle).toHaveBeenCalledOnce();
    work.resolve();
    await assertion;
    expect(kafka.consumer.commitOffsets).not.toHaveBeenCalled();
    await f.consumer.onModuleDestroy();
  });
  it('removes its wait timer after a quick success', async () => {
    const f = await messageRun();
    await f.dispatch();
    expect(f.heartbeat).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    await f.consumer.onModuleDestroy();
  });
  it('rejects malformed messages without starting work or heartbeat', async () => {
    const f = await messageRun();
    f.delivery.message.value = Buffer.from('{"eventId":"bad"}');
    await expect(f.dispatch()).rejects.toThrow(
      'Kafka event envelope is invalid',
    );
    expect(f.heartbeat).not.toHaveBeenCalled();
    expect(
      f.handlers.every((handler) => handler.handle.mock.calls.length === 0),
    ).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await f.consumer.onModuleDestroy();
  });
});
