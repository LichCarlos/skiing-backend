import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  send: vi.fn(),
  producer: {} as {
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
  },
}));

mocks.producer = {
  connect: mocks.connect,
  disconnect: mocks.disconnect,
  send: mocks.send,
};

vi.mock('kafkajs', () => ({
  Kafka: vi.fn(function KafkaMock() {
    return { producer: () => mocks.producer };
  }),
}));

import { ConfigService } from '@nestjs/config';
import { Kafka } from 'kafkajs';
import type { IntegrationEvent } from '../domain/integration-event.js';
import { KafkaEventPublisher } from './kafka-event.publisher.js';

const event: IntegrationEvent = {
  eventId: 'c9a5b5d0-6ba3-4fe0-8f4e-7d8478b2bacc',
  eventType: 'resort.updated.v1',
  aggregateType: 'ski_resort',
  aggregateId: '42',
  occurredAt: new Date('2026-10-27T00:00:00.000Z'),
  payload: { resortId: 42 },
};

function createConfig(values: Record<string, string>): ConfigService {
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

describe('KafkaEventPublisher', () => {
  beforeEach(() => {
    mocks.connect.mockReset().mockResolvedValue(undefined);
    mocks.disconnect.mockReset().mockResolvedValue(undefined);
    mocks.send.mockReset().mockResolvedValue([]);
    vi.mocked(Kafka).mockClear();
  });

  it('publishes a versioned event and reuses its producer connection', async () => {
    const publisher = new KafkaEventPublisher(
      createConfig({
        KAFKA_BROKERS: 'broker-a:9092, broker-b:9092',
        KAFKA_EVENTS_TOPIC: 'project.events',
      }),
    );

    await publisher.publish(event);
    await publisher.publish(event);

    expect(Kafka).toHaveBeenCalledWith({
      clientId: 'linji-api',
      brokers: ['broker-a:9092', 'broker-b:9092'],
    });
    expect(mocks.connect).toHaveBeenCalledOnce();
    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(mocks.send).toHaveBeenNthCalledWith(1, {
      topic: 'project.events',
      messages: [
        {
          key: event.aggregateId,
          value: JSON.stringify({
            ...event,
            occurredAt: event.occurredAt.toISOString(),
          }),
          headers: {
            eventId: event.eventId,
            eventType: event.eventType,
          },
        },
      ],
    });

    await publisher.beforeApplicationShutdown();
    expect(mocks.disconnect).toHaveBeenCalledOnce();
  });

  it('retries connection after a broker connection failure', async () => {
    mocks.connect
      .mockRejectedValueOnce(new Error('broker unavailable'))
      .mockResolvedValueOnce(undefined);
    const publisher = new KafkaEventPublisher(createConfig({}));

    await expect(publisher.publish(event)).rejects.toThrow(
      'broker unavailable',
    );
    await expect(publisher.publish(event)).resolves.toBeUndefined();

    expect(mocks.connect).toHaveBeenCalledTimes(2);
    expect(mocks.send).toHaveBeenCalledOnce();
  });

  it('rejects an empty broker list', () => {
    expect(
      () => new KafkaEventPublisher(createConfig({ KAFKA_BROKERS: ' , ' })),
    ).toThrow('KAFKA_BROKERS must not be empty');
  });

  it('passes TLS and SASL policy to its actual Kafka client constructor', () => {
    new KafkaEventPublisher(
      createConfig({
        KAFKA_TLS_ENABLED: 'true',
        KAFKA_SASL_MECHANISM: 'scram-sha-512',
        KAFKA_SASL_USERNAME: 'publisher',
        KAFKA_SASL_PASSWORD: 'test-password',
      }),
    );
    expect(Kafka).toHaveBeenCalledWith({
      clientId: 'linji-api',
      brokers: ['localhost:9092'],
      ssl: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
      sasl: {
        mechanism: 'scram-sha-512',
        username: 'publisher',
        password: 'test-password',
      },
    });
  });
});
