import { nativeKafkaRecovery } from './native-kafka-recovery.js';

const env: NodeJS.ProcessEnv = {
  LINJI_DATABASE_TEST_DISPOSABLE: 'true',
  KAFKA_RECOVERY_NATIVE_URL: 'http://127.0.0.1:12345/',
  KAFKA_RECOVERY_NATIVE_TOKEN: 'a'.repeat(64),
  KAFKA_INTEGRATION_BROKERS: '127.0.0.1:12346',
};
const identity = (running = true) => ({
  kind: 'linji-native-kafka-recovery',
  version: '4.1.1',
  broker: env.KAFKA_INTEGRATION_BROKERS,
  running,
});
const requestUrl = (value: string | URL | Request) =>
  value instanceof Request
    ? value.url
    : value instanceof URL
      ? value.href
      : value;
describe('native recovery capability isolation', () => {
  it.each([
    { LINJI_DATABASE_TEST_DISPOSABLE: 'false' },
    { KAFKA_RECOVERY_NATIVE_TOKEN: undefined },
    { KAFKA_RECOVERY_NATIVE_TOKEN: 'invalid' },
    { KAFKA_RECOVERY_CONTAINER_ID: 'a'.repeat(64) },
    { KAFKA_RECOVERY_NATIVE_URL: 'http://example.com:12345/' },
    { KAFKA_RECOVERY_NATIVE_URL: 'https://127.0.0.1:12345/' },
    { KAFKA_RECOVERY_NATIVE_URL: 'http://127.0.0.1:12345/other' },
    { KAFKA_RECOVERY_NATIVE_URL: 'http://127.0.0.1:12345/?x=1' },
    { KAFKA_RECOVERY_NATIVE_URL: 'http://127.0.0.1:12345/#x' },
    { KAFKA_RECOVERY_NATIVE_URL: 'http://user:pass@127.0.0.1:12345/' },
    { KAFKA_RECOVERY_NATIVE_URL: 'http://127.0.0.1/' },
    { KAFKA_INTEGRATION_BROKERS: '127.0.0.1:12346,127.0.0.1:12347' },
    { KAFKA_INTEGRATION_BROKERS: '127.0.0.1:65536' },
    { KAFKA_INTEGRATION_BROKERS: 'example.com:12346' },
  ])(
    'rejects unsafe or ambiguous configuration before any command %j',
    async (change) => {
      const request = vi.fn();
      await expect(
        nativeKafkaRecovery({ ...env, ...change }, request),
      ).rejects.toThrow();
      expect(request).not.toHaveBeenCalled();
    },
  );
  it.each([
    { ...identity(), kind: 'other' },
    { ...identity(), version: '3.9.0' },
    { ...identity(), broker: '127.0.0.1:9999' },
    { ...identity(), running: false },
  ])('rejects a different capability identity %j', async (value) => {
    const request = vi.fn(async () => new Response(JSON.stringify(value)));
    await expect(nativeKafkaRecovery(env, request)).rejects.toThrow(
      'identity mismatch',
    );
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('uses only authenticated fixed routes and verifies the resulting running state', async () => {
    const request = vi.fn(
      async (url: string | URL | Request) =>
        new Response(
          JSON.stringify(
            identity(new URL(requestUrl(url)).pathname !== '/stop'),
          ),
        ),
    );
    const broker = await nativeKafkaRecovery(env, request);
    await broker.stop();
    await broker.start();
    expect(
      request.mock.calls.map(([url]) => new URL(requestUrl(url)).pathname),
    ).toEqual(['/identity', '/stop', '/start']);
    for (const call of request.mock.calls as unknown as [URL, RequestInit][]) {
      const [, options] = call;
      expect(options.redirect).toBe('error');
      expect(options.signal).toBeInstanceOf(AbortSignal);
      expect(options.headers).toEqual({
        Authorization: `Bearer ${env.KAFKA_RECOVERY_NATIVE_TOKEN}`,
      });
      expect(options.body).toBeUndefined();
    }
  });
  it('does not expose refusal bodies or continue with a recovery command', async () => {
    const request = vi.fn(
      async () => new Response('private diagnostics', { status: 403 }),
    );
    await expect(nativeKafkaRecovery(env, request)).rejects.toThrow(
      'command refused',
    );
    expect(request).toHaveBeenCalledTimes(1);
  });
});
