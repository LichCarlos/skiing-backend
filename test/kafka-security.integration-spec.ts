import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { Kafka, logLevel, type Admin, type KafkaConfig } from 'kafkajs';
import { kafkaClientConfig } from '../src/modules/integration-events/infrastructure/kafka-client-config.js';
import {
  integrationKafkaClientConfig,
  integrationKafkaSettings,
} from './helpers/kafka-integration-transport.js';
import { waitForTopicLeaders } from './helpers/kafka-topic-readiness.js';

// These are real broker tests. No protocol fixture and no silent environment skip.
describe('real Kafka TLS / SCRAM / restricted application ACL', () => {
  let admin: Admin;
  const key = randomUUID();
  const allowed = `linji-security-${key}`;
  const denied = `linji-denied-${key}`;
  const creation = `linji-create-denied-${key}`;
  const forbiddenGroup = `linji-denied-group-${key}`;
  function client(overrides: Partial<KafkaConfig> = {}) {
    return new Kafka({
      ...integrationKafkaClientConfig(),
      clientId: 'linji-security-application',
      logLevel: logLevel.NOTHING,
      connectionTimeout: 5_000,
      authenticationTimeout: 5_000,
      requestTimeout: 10_000,
      retry: { retries: 0 },
      ...overrides,
    });
  }

  beforeAll(async () => {
    if (process.env.KAFKA_INTEGRATION_SECURITY_ENABLED !== 'true')
      throw new Error(
        'Dedicated TLS/SCRAM/ACL broker must be explicitly enabled',
      );
    admin = new Kafka({
      ...integrationKafkaClientConfig('admin'),
      logLevel: logLevel.NOTHING,
    }).admin();
    await admin.connect();
    await admin.createTopics({
      topics: [allowed, denied].map((topic) => ({
        topic,
        numPartitions: 1,
        replicationFactor: 1,
      })),
      waitForLeaders: false,
    });
    for (const topic of [allowed, denied])
      await waitForTopicLeaders(admin, topic, 1);
  });
  afterAll(async () => {
    if (!admin) return;
    try {
      const topics = await admin.listTopics();
      const owned = [allowed, denied, creation].filter((topic) =>
        topics.includes(topic),
      );
      if (owned.length) await admin.deleteTopics({ topics: owned });
      const groups = (await admin.listGroups()).groups.map(
        (group) => group.groupId,
      );
      if (groups.includes(forbiddenGroup))
        await admin.deleteGroups([forbiddenGroup]);
    } finally {
      await admin.disconnect();
    }
  });

  it.each(['scram-sha-512', 'scram-sha-256'] as const)(
    'authenticates %s and receives an acknowledged permitted write',
    async (mechanism) => {
      const settings = integrationKafkaSettings();
      const producer = client(
        kafkaClientConfig(
          new ConfigService({
            ...settings,
            KAFKA_SASL_MECHANISM: mechanism,
          }),
        ),
      ).producer();
      try {
        await producer.connect();
        const result = await producer.send({
          topic: allowed,
          messages: [{ value: mechanism }],
        });
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({ topicName: allowed, errorCode: 0 });
      } finally {
        await producer.disconnect();
      }
    },
  );
  it.each(['wrong-password', 'unknown-user'] as const)(
    'rejects %s with a SASL authentication failure',
    async (mode) => {
      const settings = integrationKafkaSettings();
      const producer = client(
        kafkaClientConfig(
          new ConfigService({
            ...settings,
            ...(mode === 'wrong-password'
              ? { KAFKA_SASL_PASSWORD: randomUUID() }
              : { KAFKA_SASL_USERNAME: `absent-${key}` }),
          }),
        ),
      ).producer();
      try {
        await expect(producer.connect()).rejects.toMatchObject({
          name: 'KafkaJSSASLAuthenticationError',
        });
      } finally {
        await producer.disconnect();
      }
    },
  );
  it('rejects the real broker without its private test trust root', async () => {
    const configured = kafkaClientConfig(
      new ConfigService({
        ...integrationKafkaSettings(),
        KAFKA_TLS_CA_FILE: '',
      }),
    );
    const producer = client(configured).producer();
    try {
      await expect(producer.connect()).rejects.toSatisfy((error: unknown) =>
        errorChain(error).some((entry) =>
          [
            'SELF_SIGNED_CERT_IN_CHAIN',
            'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
            'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
          ].includes(String(entry.code)),
        ),
      );
    } finally {
      await producer.disconnect();
    }
  });
  it('rejects a broker hostname outside the certificate SAN', async () => {
    const config = integrationKafkaClientConfig();
    if (!config.ssl || typeof config.ssl !== 'object')
      throw new Error('TLS required');
    const producer = client({
      ssl: { ...config.ssl, servername: 'wrong-host.invalid' },
    }).producer();
    try {
      await expect(producer.connect()).rejects.toSatisfy((error: unknown) =>
        errorChain(error).some(
          (entry) => entry.code === 'ERR_TLS_CERT_ALTNAME_INVALID',
        ),
      );
    } finally {
      await producer.disconnect();
    }
  });
  it('does not accept an anonymous TLS client on the SASL listener', async () => {
    const observer = client({ sasl: undefined }).admin();
    try {
      await expect(
        (async () => {
          await observer.connect();
          return observer.describeCluster();
        })(),
      ).rejects.toThrow();
      // A refusal must not be explained by an unavailable broker.
      expect((await admin.describeCluster()).brokers).toHaveLength(1);
    } finally {
      await observer.disconnect();
    }
  });
  it('denies writes to an existing topic outside the application prefix', async () => {
    const producer = client().producer();
    try {
      await producer.connect();
      await expect(
        producer.send({ topic: denied, messages: [{ value: 'forbidden' }] }),
      ).rejects.toSatisfy((error: unknown) =>
        errorChain(error).some((entry) => entry.code === 29),
      );
      expect((await admin.fetchTopicOffsets(denied))[0]?.offset).toBe('0');
    } finally {
      await producer.disconnect();
    }
  });
  it('denies access to a consumer group outside the application prefix', async () => {
    const coordinatorCodes: unknown[] = [];
    const observer = client({
      logLevel: logLevel.DEBUG,
      // KafkaJS 2.2.4 withBroker discards the coordinator protocol error.
      // Observe only this request's code before it becomes CoordinatorNotFound;
      // do not persist debug text, credentials or a fabricated success value.
      logCreator:
        () =>
        ({ log }) => {
          if (
            log.message === 'Tried to find group coordinator' &&
            log.groupId === forbiddenGroup
          )
            coordinatorCodes.push(
              ...errorChain(log.error).map((entry) => entry.code),
            );
        },
    }).admin();
    try {
      await observer.connect();
      // With retry=0, FindCoordinator cannot itself retry the initial empty pool.
      // Populate it through a permitted metadata request before testing group ACL.
      await observer.fetchTopicMetadata({ topics: [allowed] });
      await expect(
        observer.fetchOffsets({ groupId: forbiddenGroup, topics: [allowed] }),
      ).rejects.toMatchObject({ name: 'KafkaJSGroupCoordinatorNotFound' });
      expect(coordinatorCodes).toContain(30);
      expect(
        (await admin.listGroups()).groups.map((group) => group.groupId),
      ).not.toContain(forbiddenGroup);
    } finally {
      await observer.disconnect();
    }
  });
  it('denies topic creation to the application principal', async () => {
    const observer = client().admin();
    try {
      await observer.connect();
      await expect(
        observer.createTopics({
          topics: [{ topic: creation }],
          waitForLeaders: false,
        }),
      ).rejects.toMatchObject({
        errors: [expect.objectContaining({ code: 29 })],
      });
      expect(await admin.listTopics()).not.toContain(creation);
    } finally {
      await observer.disconnect();
    }
  });
  it('denies deletion even for an application-readable topic', async () => {
    const observer = client().admin();
    try {
      await observer.connect();
      await expect(
        observer.deleteTopics({ topics: [allowed] }),
      ).rejects.toMatchObject({ code: 29 });
      await waitForTopicLeaders(admin, allowed, 1);
    } finally {
      await observer.disconnect();
    }
  });
  it('denies application access to the ACL administration API', async () => {
    const observer = client().admin();
    try {
      await observer.connect();
      await expect(
        observer.describeAcls({
          resourceType: 1,
          resourcePatternType: 1,
          operation: 1,
          permissionType: 1,
        }),
      ).rejects.toMatchObject({ code: 31 });
    } finally {
      await observer.disconnect();
    }
  });
});

function errorChain(error: unknown): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  while (error && typeof error === 'object' && result.length < 8) {
    const entry = error as Record<string, unknown>;
    result.push(entry);
    error = entry.cause;
  }
  return result;
}
