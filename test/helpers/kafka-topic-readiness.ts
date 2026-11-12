import type { Admin } from 'kafkajs';

// CreateTopics acknowledges controller metadata before every broker can serve it.
// KafkaJS waitForLeaders does not retry UNKNOWN_TOPIC_OR_PARTITION here.
export async function waitForTopicLeaders(
  admin: Pick<Admin, 'fetchTopicMetadata'>,
  topic: string,
  partitions: number,
  timeoutMs = 25_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const metadata = await admin.fetchTopicMetadata({ topics: [topic] });
      const found = metadata.topics.find((entry) => entry.name === topic);
      if (
        found?.partitions.length === partitions &&
        found.partitions.every(
          (entry) =>
            entry.partitionErrorCode === 0 &&
            entry.leader >= 0 &&
            entry.isr.includes(entry.leader),
        )
      )
        return;
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      // Unknown topic / leader unavailable / not leader during metadata propagation.
      if (code !== 3 && code !== 5 && code !== 6) throw error;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${partitions} leaders for ${topic}`);
}
