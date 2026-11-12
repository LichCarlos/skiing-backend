import { integrationKafkaSettings } from './kafka-integration-transport.js';

const plain = { KAFKA_INTEGRATION_BROKERS: '127.0.0.1:19092' };
const secure = {
  ...plain,
  KAFKA_INTEGRATION_SECURITY_ENABLED: 'true',
  KAFKA_INTEGRATION_CA_FILE: '/test/ca.pem',
  KAFKA_INTEGRATION_SASL_MECHANISM: 'scram-sha-512',
  KAFKA_INTEGRATION_USERNAME: 'limited-test-user',
  KAFKA_INTEGRATION_PASSWORD: ' application test password ',
  KAFKA_INTEGRATION_ADMIN_USERNAME: 'test-admin',
  KAFKA_INTEGRATION_ADMIN_PASSWORD: ' admin test password ',
};

describe('integration Kafka transport isolation', () => {
  it('preserves the plaintext suite while clearing ambient production settings', () => {
    expect(
      integrationKafkaSettings('application', {
        ...plain,
        KAFKA_TLS_ENABLED: 'true',
        KAFKA_SASL_PASSWORD: 'ambient-secret',
      }),
    ).toMatchObject({
      KAFKA_TLS_ENABLED: 'false',
      KAFKA_TLS_CA_FILE: '',
      KAFKA_SASL_MECHANISM: '',
      KAFKA_SASL_USERNAME: '',
      KAFKA_SASL_PASSWORD: '',
    });
  });
  it('keeps the application and setup credentials separate without trimming passwords', () => {
    expect(integrationKafkaSettings('application', secure)).toMatchObject({
      KAFKA_TLS_ENABLED: 'true',
      KAFKA_SASL_USERNAME: secure.KAFKA_INTEGRATION_USERNAME,
      KAFKA_SASL_PASSWORD: secure.KAFKA_INTEGRATION_PASSWORD,
    });
    expect(integrationKafkaSettings('admin', secure)).toMatchObject({
      KAFKA_SASL_USERNAME: secure.KAFKA_INTEGRATION_ADMIN_USERNAME,
      KAFKA_SASL_PASSWORD: secure.KAFKA_INTEGRATION_ADMIN_PASSWORD,
    });
  });
  it.each([
    'KAFKA_INTEGRATION_CA_FILE',
    'KAFKA_INTEGRATION_SASL_MECHANISM',
    'KAFKA_INTEGRATION_USERNAME',
    'KAFKA_INTEGRATION_PASSWORD',
    'KAFKA_INTEGRATION_ADMIN_USERNAME',
    'KAFKA_INTEGRATION_ADMIN_PASSWORD',
  ])('rejects a partial secure configuration: %s', (key) => {
    expect(() =>
      integrationKafkaSettings('application', { ...secure, [key]: ' ' }),
    ).toThrow('incomplete');
  });
  it('rejects implicit security downgrade', () => {
    expect(() =>
      integrationKafkaSettings('application', {
        ...secure,
        KAFKA_INTEGRATION_SECURITY_ENABLED: 'false',
      }),
    ).toThrow('explicit enablement');
  });
  it('rejects unsupported transport authentication', () => {
    expect(() =>
      integrationKafkaSettings('application', {
        ...secure,
        KAFKA_INTEGRATION_SASL_MECHANISM: 'plain',
      }),
    ).toThrow('SCRAM');
  });
  it('rejects a shared superuser/application identity', () => {
    expect(() =>
      integrationKafkaSettings('application', {
        ...secure,
        KAFKA_INTEGRATION_ADMIN_USERNAME: secure.KAFKA_INTEGRATION_USERNAME,
      }),
    ).toThrow('must differ');
  });
  it('rejects a missing broker and malformed flag without including credentials', () => {
    expect(() => integrationKafkaSettings('application', {})).toThrow(
      'BROKERS',
    );
    expect(() =>
      integrationKafkaSettings('application', {
        ...secure,
        KAFKA_INTEGRATION_SECURITY_ENABLED: 'TRUE',
      }),
    ).toThrow('must be true or false');
  });
});
