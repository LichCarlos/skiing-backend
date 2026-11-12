import type { Admin } from 'kafkajs';

export async function observeCommittedOffset(
  admin: Pick<Admin, 'fetchOffsets'>,
  groupId: string,
  topic: string,
): Promise<string | null> {
  try {
    const offsets = await admin.fetchOffsets({ groupId, topics: [topic] });
    return offsets[0]?.partitions[0]?.offset ?? '-1';
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    // Coordinator loading/unavailable/changed after the real broker restart.
    // null is unknown, never an observed empty (-1) or successful commit.
    if (code === 14 || code === 15 || code === 16) return null;
    throw error;
  }
}
