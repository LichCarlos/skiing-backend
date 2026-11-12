export async function nativeKafkaRecovery(
  env: NodeJS.ProcessEnv = process.env,
  request: typeof fetch = fetch,
) {
  const url = new URL(env.KAFKA_RECOVERY_NATIVE_URL ?? '');
  const token = env.KAFKA_RECOVERY_NATIVE_TOKEN;
  const broker = env.KAFKA_INTEGRATION_BROKERS ?? '';
  if (
    env.LINJI_DATABASE_TEST_DISPOSABLE !== 'true' ||
    env.KAFKA_RECOVERY_CONTAINER_ID ||
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password ||
    !token ||
    !/^[a-f0-9]{64}$/u.test(token) ||
    !/^127\.0\.0\.1:[1-9]\d{0,4}$/u.test(broker) ||
    Number(broker.split(':')[1]) > 65535
  )
    throw new Error(
      'Explicit disposable native Kafka recovery capability required',
    );
  async function command(
    action: 'identity' | 'stop' | 'start',
    running: boolean,
  ) {
    const response = await request(new URL(action, url), {
      method: action === 'identity' ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error('Native Kafka recovery command refused');
    const value = (await response.json()) as Record<string, unknown>;
    if (
      value.kind !== 'linji-native-kafka-recovery' ||
      value.version !== '4.1.1' ||
      value.broker !== broker ||
      value.running !== running
    )
      throw new Error('Native Kafka recovery identity mismatch');
  }
  await command('identity', true);
  return {
    stop: () => command('stop', false),
    start: () => command('start', true),
  };
}
