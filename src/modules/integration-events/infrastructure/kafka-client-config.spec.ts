import { ConfigService } from '@nestjs/config';
import { generateKeyPairSync } from 'node:crypto';
import {
  mkdtempSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { kafkaClientConfig } from './kafka-client-config.js';

const fixture = resolve('test/fixtures/kafka-tls');
const tlsFiles = {
  KAFKA_TLS_ENABLED: 'true',
  KAFKA_TLS_CA_FILE: join(fixture, 'ca.pem'),
  KAFKA_TLS_CERT_FILE: join(fixture, 'broker-cert.pem'),
  KAFKA_TLS_KEY_FILE: join(fixture, 'broker-key.pem'),
};
function parse(values: Record<string, string> = {}) {
  return kafkaClientConfig(new ConfigService(values));
}

describe('Kafka transport configuration', () => {
  it('preserves local unauthenticated defaults', () => {
    expect(parse()).toEqual({
      clientId: 'linji-api',
      brokers: ['localhost:9092'],
    });
  });
  it('shares trimmed broker addresses without adding a TLS downgrade option', () => {
    expect(
      parse({ KAFKA_BROKERS: ' a:9093, b:9093 ', KAFKA_TLS_ENABLED: 'true' }),
    ).toEqual({
      clientId: 'linji-api',
      brokers: ['a:9093', 'b:9093'],
      ssl: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
    });
  });
  it.each(['plain', 'scram-sha-256', 'scram-sha-512'])(
    'supports %s over TLS and preserves credential bytes',
    (mechanism) => {
      expect(
        parse({
          KAFKA_TLS_ENABLED: 'true',
          KAFKA_SASL_MECHANISM: mechanism,
          KAFKA_SASL_USERNAME: ' user ',
          KAFKA_SASL_PASSWORD: ' password ',
        }).sasl,
      ).toEqual({ mechanism, username: ' user ', password: ' password ' });
    },
  );
  it('loads a private CA and matched mutual TLS identity', () => {
    expect(parse(tlsFiles).ssl).toEqual({
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
      ca: readFileSync(tlsFiles.KAFKA_TLS_CA_FILE, 'utf8'),
      cert: readFileSync(tlsFiles.KAFKA_TLS_CERT_FILE, 'utf8'),
      key: readFileSync(tlsFiles.KAFKA_TLS_KEY_FILE, 'utf8'),
    });
  });
  it.each([
    [{ KAFKA_BROKERS: ' , ' }, 'KAFKA_BROKERS'],
    [{ KAFKA_TLS_ENABLED: 'yes' }, 'KAFKA_TLS_ENABLED'],
    [
      { KAFKA_TLS_CA_FILE: '/private/ca.pem' },
      'require KAFKA_TLS_ENABLED=true',
    ],
    [
      { KAFKA_TLS_ENABLED: 'true', KAFKA_TLS_CERT_FILE: '/private/cert.pem' },
      'configured together',
    ],
    [
      { KAFKA_TLS_ENABLED: 'true', KAFKA_TLS_KEY_FILE: '/private/key.pem' },
      'configured together',
    ],
    [{ KAFKA_SASL_USERNAME: 'sensitive-user' }, 'require KAFKA_SASL_MECHANISM'],
    [
      { KAFKA_SASL_PASSWORD: 'sensitive-password' },
      'require KAFKA_SASL_MECHANISM',
    ],
    [
      { KAFKA_TLS_ENABLED: 'true', KAFKA_SASL_MECHANISM: 'oauthbearer' },
      'unsupported',
    ],
    [
      {
        KAFKA_SASL_MECHANISM: 'plain',
        KAFKA_SASL_USERNAME: 'user',
        KAFKA_SASL_PASSWORD: 'pass',
      },
      'requires TLS',
    ],
    [
      {
        KAFKA_TLS_ENABLED: 'true',
        KAFKA_SASL_MECHANISM: 'plain',
        KAFKA_SASL_USERNAME: 'user',
      },
      'username and password',
    ],
    [
      {
        KAFKA_TLS_ENABLED: 'true',
        KAFKA_SASL_MECHANISM: 'plain',
        KAFKA_SASL_USERNAME: ' ',
        KAFKA_SASL_PASSWORD: 'pass',
      },
      'username and password',
    ],
  ] as Array<[Record<string, string>, string]>)(
    'rejects incomplete/unsafe configuration %#',
    (values, error) => {
      expect(() => parse(values)).toThrow(error);
    },
  );
  it('does not include paths or native errors in unreadable-file failures', () => {
    expect(() =>
      parse({
        KAFKA_TLS_ENABLED: 'true',
        KAFKA_TLS_CA_FILE: '/private/secret-path-not-present.pem',
      }),
    ).toThrow(/^Kafka TLS file for KAFKA_TLS_CA_FILE cannot be read$/);
  });
  it.each([
    '',
    'secret-not-a-certificate',
    '-----BEGIN CERTIFICATE-----\ninvalid-secret\n-----END CERTIFICATE-----',
  ])('rejects empty/malformed CA text without exposing it %#', (value) => {
    const directory = mkdtempSync(join(tmpdir(), 'linji-kafka-ca-'));
    const file = join(directory, 'ca.pem');
    try {
      writeFileSync(file, value);
      expect(() =>
        parse({ KAFKA_TLS_ENABLED: 'true', KAFKA_TLS_CA_FILE: file }),
      ).toThrow(
        /^Kafka TLS (file for KAFKA_TLS_CA_FILE cannot be read|CA bundle is invalid)$/,
      );
    } finally {
      unlinkSync(file);
      rmdirSync(directory);
    }
  });
  it('rejects a certificate/key mismatch before opening a connection', () => {
    const directory = mkdtempSync(join(tmpdir(), 'linji-kafka-key-'));
    const file = join(directory, 'key.pem');
    try {
      const { privateKey } = generateKeyPairSync('ec', {
        namedCurve: 'prime256v1',
      });
      writeFileSync(file, privateKey.export({ type: 'pkcs8', format: 'pem' }));
      expect(() => parse({ ...tlsFiles, KAFKA_TLS_KEY_FILE: file })).toThrow(
        /^Kafka TLS certificate configuration is invalid$/,
      );
    } finally {
      unlinkSync(file);
      rmdirSync(directory);
    }
  });
});
