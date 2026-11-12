import { ConfigService } from '@nestjs/config';
import { kafkaClientConfig } from '../../src/modules/integration-events/infrastructure/kafka-client-config.js';

type Principal = 'application' | 'admin';
const securityKeys = [
  'KAFKA_INTEGRATION_CA_FILE',
  'KAFKA_INTEGRATION_SASL_MECHANISM',
  'KAFKA_INTEGRATION_USERNAME',
  'KAFKA_INTEGRATION_PASSWORD',
  'KAFKA_INTEGRATION_ADMIN_USERNAME',
  'KAFKA_INTEGRATION_ADMIN_PASSWORD',
] as const;

// Test-only namespace: never silently fall back from partial secure settings.
// Explicit blanks also prevent ConfigService from inheriting product credentials.
export function integrationKafkaSettings(
  principal: Principal = 'application',
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  if (!env.KAFKA_INTEGRATION_BROKERS?.trim())
    throw new Error('KAFKA_INTEGRATION_BROKERS is required');
  const enabled = env.KAFKA_INTEGRATION_SECURITY_ENABLED ?? 'false';
  if (enabled !== 'true' && enabled !== 'false')
    throw new Error('KAFKA_INTEGRATION_SECURITY_ENABLED must be true or false');
  const values: Record<string, string> = {
    KAFKA_BROKERS: env.KAFKA_INTEGRATION_BROKERS,
    KAFKA_TLS_ENABLED: enabled,
    KAFKA_TLS_CA_FILE: '',
    KAFKA_TLS_CERT_FILE: '',
    KAFKA_TLS_KEY_FILE: '',
    KAFKA_SASL_MECHANISM: '',
    KAFKA_SASL_USERNAME: '',
    KAFKA_SASL_PASSWORD: '',
  };
  if (enabled === 'false') {
    if (securityKeys.some((key) => Boolean(env[key])))
      throw new Error(
        'Kafka integration security settings require explicit enablement',
      );
    return values;
  }
  if (securityKeys.some((key) => !env[key]?.trim()))
    throw new Error('Kafka integration security settings are incomplete');
  const mechanism = env.KAFKA_INTEGRATION_SASL_MECHANISM!;
  if (mechanism !== 'scram-sha-256' && mechanism !== 'scram-sha-512')
    throw new Error('Kafka integration requires SCRAM over TLS');
  if (env.KAFKA_INTEGRATION_USERNAME === env.KAFKA_INTEGRATION_ADMIN_USERNAME)
    throw new Error(
      'Kafka integration application and admin principals must differ',
    );
  return {
    ...values,
    KAFKA_TLS_CA_FILE: env.KAFKA_INTEGRATION_CA_FILE!,
    KAFKA_SASL_MECHANISM: mechanism,
    KAFKA_SASL_USERNAME:
      principal === 'admin'
        ? env.KAFKA_INTEGRATION_ADMIN_USERNAME!
        : env.KAFKA_INTEGRATION_USERNAME!,
    KAFKA_SASL_PASSWORD:
      principal === 'admin'
        ? env.KAFKA_INTEGRATION_ADMIN_PASSWORD!
        : env.KAFKA_INTEGRATION_PASSWORD!,
  };
}

export function integrationKafkaClientConfig(
  principal: Principal = 'application',
) {
  return kafkaClientConfig(
    new ConfigService(integrationKafkaSettings(principal)),
  );
}
