import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { nativeKafkaRecovery } from './native-kafka-recovery.js';

const exec = promisify(execFile);

/** Only an explicit owned-process capability or a verified dedicated container may stop. */
export async function recoveryBroker() {
  if (process.env.KAFKA_RECOVERY_NATIVE_URL) return nativeKafkaRecovery();
  const id = process.env.KAFKA_RECOVERY_CONTAINER_ID;
  if (!id || !/^[a-f0-9]{64}$/.test(id))
    throw new Error('Recovery requires the full dedicated Kafka container ID');
  const { stdout } = await exec('docker', ['inspect', id], { timeout: 10_000 });
  const [container] = JSON.parse(stdout) as {
    Id: string;
    Config: { Image: string; Labels: Record<string, string> };
    HostConfig: { AutoRemove: boolean };
    State: { Running: boolean };
    NetworkSettings: {
      Ports: Record<string, { HostIp: string; HostPort: string }[] | null>;
    };
  }[];
  const bindings = container?.NetworkSettings.Ports['9092/tcp'] ?? [];
  const brokers = process.env.KAFKA_INTEGRATION_BROKERS?.split(',') ?? [];
  const matchesEndpoint =
    brokers.length === 1 &&
    bindings.some((binding) =>
      ['127.0.0.1', 'localhost'].some(
        (host) => brokers[0] === `${host}:${binding.HostPort}`,
      ),
    );
  if (
    container?.Id !== id ||
    container.Config.Image !== 'apache/kafka:4.1.1' ||
    container.Config.Labels['linji.validation'] !== 'kafka-recovery' ||
    container.HostConfig.AutoRemove ||
    !container.State.Running ||
    !matchesEndpoint ||
    process.env.LINJI_DATABASE_TEST_DISPOSABLE !== 'true'
  )
    throw new Error(
      'Refusing to stop a broker outside the dedicated recovery fixture',
    );

  return {
    async stop() {
      await exec('docker', ['stop', '--time', '2', id], { timeout: 20_000 });
    },
    async start() {
      await exec('docker', ['start', id], { timeout: 20_000 });
    },
  };
}
