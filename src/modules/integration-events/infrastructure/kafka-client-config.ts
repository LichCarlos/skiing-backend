import { readFileSync } from 'node:fs';
import { createPrivateKey, X509Certificate } from 'node:crypto';
import { createSecureContext, type ConnectionOptions } from 'node:tls';
import type { ConfigService } from '@nestjs/config';
import type { KafkaConfig } from 'kafkajs';

// Infrastructure only: both clients must use the same transport policy.
export function kafkaClientConfig(config: ConfigService): KafkaConfig {
  const brokers = (config.get<string>('KAFKA_BROKERS') ?? 'localhost:9092')
    .split(',')
    .map((broker) => broker.trim())
    .filter(Boolean);
  if (brokers.length === 0) throw new Error('KAFKA_BROKERS must not be empty');

  const result: KafkaConfig = { clientId: 'linji-api', brokers };
  const enabled = config.get<string>('KAFKA_TLS_ENABLED') ?? 'false';
  if (enabled !== 'true' && enabled !== 'false')
    throw new Error('KAFKA_TLS_ENABLED must be true or false');
  const caFile = config.get<string>('KAFKA_TLS_CA_FILE')?.trim();
  const certFile = config.get<string>('KAFKA_TLS_CERT_FILE')?.trim();
  const keyFile = config.get<string>('KAFKA_TLS_KEY_FILE')?.trim();
  if (enabled === 'false' && (caFile || certFile || keyFile))
    throw new Error('Kafka TLS files require KAFKA_TLS_ENABLED=true');
  if (Boolean(certFile) !== Boolean(keyFile))
    throw new Error(
      'Kafka client certificate and key must be configured together',
    );
  if (enabled === 'true') {
    const ssl: ConnectionOptions = {
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
    };
    if (caFile) {
      const ca = pemFile(config, 'KAFKA_TLS_CA_FILE');
      // OpenSSL may ignore malformed CA text rather than reject it.
      const certificates = ca.match(
        /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,
      );
      try {
        if (
          !certificates?.length ||
          ca
            .replace(
              /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,
              '',
            )
            .trim()
        )
          throw new Error('Invalid certificate bundle');
        for (const certificate of certificates)
          new X509Certificate(certificate);
      } catch {
        throw new Error('Kafka TLS CA bundle is invalid');
      }
      ssl.ca = ca;
    }
    const certificate = certFile
      ? pemFile(config, 'KAFKA_TLS_CERT_FILE')
      : undefined;
    const privateKey = keyFile
      ? pemFile(config, 'KAFKA_TLS_KEY_FILE')
      : undefined;
    try {
      if (certificate && privateKey) {
        if (
          !new X509Certificate(certificate).checkPrivateKey(
            createPrivateKey(privateKey),
          )
        )
          throw new Error('Client certificate does not match private key');
        ssl.cert = certificate;
        ssl.key = privateKey;
      }
      createSecureContext(ssl);
    } catch {
      // Never attach native errors, PEM contents, paths or credentials.
      throw new Error('Kafka TLS certificate configuration is invalid');
    }
    result.ssl = ssl;
  }

  const mechanism = config.get<string>('KAFKA_SASL_MECHANISM')?.trim();
  const username = config.get<string>('KAFKA_SASL_USERNAME');
  const password = config.get<string>('KAFKA_SASL_PASSWORD');
  if (!mechanism && (username || password))
    throw new Error('Kafka SASL credentials require KAFKA_SASL_MECHANISM');
  if (mechanism) {
    if (
      mechanism !== 'plain' &&
      mechanism !== 'scram-sha-256' &&
      mechanism !== 'scram-sha-512'
    )
      throw new Error('Kafka SASL mechanism is unsupported');
    if (enabled !== 'true')
      throw new Error('Kafka SASL authentication requires TLS');
    if (!username?.trim() || !password?.trim())
      throw new Error('Kafka SASL username and password are required');
    // Keep KafkaJS's discriminated union; credential bytes must not be trimmed.
    switch (mechanism) {
      case 'plain':
        result.sasl = { mechanism, username, password };
        break;
      case 'scram-sha-256':
        result.sasl = { mechanism, username, password };
        break;
      case 'scram-sha-512':
        result.sasl = { mechanism, username, password };
        break;
    }
  }
  return result;
}

function pemFile(config: ConfigService, key: string): string {
  try {
    const value = readFileSync(config.get<string>(key)!.trim(), 'utf8');
    if (!value.trim()) throw new Error('Empty file');
    return value;
  } catch {
    throw new Error(`Kafka TLS file for ${key} cannot be read`);
  }
}
