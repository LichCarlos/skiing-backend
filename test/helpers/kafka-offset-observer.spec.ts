import { observeCommittedOffset } from './kafka-offset-observer.js';

describe('Kafka integration offset observer', () => {
  it('returns the exact persisted offset without rewriting it', async () => {
    const fetchOffsets = vi.fn().mockResolvedValue([
      {
        topic: 'fixture',
        partitions: [{ partition: 0, offset: '9007199254740993' }],
      },
    ]);
    await expect(
      observeCommittedOffset({ fetchOffsets }, 'group', 'fixture'),
    ).resolves.toBe('9007199254740993');
    expect(fetchOffsets).toHaveBeenCalledWith({
      groupId: 'group',
      topics: ['fixture'],
    });
  });

  it('distinguishes a successful empty response from a coordinator failure', async () => {
    const fetchOffsets = vi.fn().mockResolvedValue([]);
    await expect(
      observeCommittedOffset({ fetchOffsets }, 'group', 'fixture'),
    ).resolves.toBe('-1');
  });

  it.each([14, 15, 16])(
    'reports unknown for temporary coordinator code %s',
    async (code) => {
      const fetchOffsets = vi
        .fn()
        .mockRejectedValue(
          Object.assign(new Error('coordinator moving'), { code }),
        );
      await expect(
        observeCommittedOffset({ fetchOffsets }, 'group', 'fixture'),
      ).resolves.toBeNull();
      expect(fetchOffsets).toHaveBeenCalledTimes(1);
    },
  );

  it.each([29, undefined])(
    'does not hide authorization or unclassified failure %s',
    async (code) => {
      const failure = Object.assign(new Error('not transient'), { code });
      const fetchOffsets = vi.fn().mockRejectedValue(failure);
      await expect(
        observeCommittedOffset({ fetchOffsets }, 'group', 'fixture'),
      ).rejects.toBe(failure);
    },
  );
});
