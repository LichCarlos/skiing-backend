import { waitForTopicLeaders } from './kafka-topic-readiness.js';

const metadata = (leader = 1, isr = [1], errorCode = 0) => ({
  topics: [
    {
      name: 'fixture',
      partitions: [
        {
          partitionErrorCode: errorCode,
          partitionId: 0,
          leader,
          replicas: [1],
          isr,
        },
      ],
    },
  ],
});

describe('Kafka integration fixture metadata readiness', () => {
  afterEach(() => vi.useRealTimers());

  it('requires the expected partition count, assigned leaders and ISR before continuing', async () => {
    vi.useFakeTimers();
    const fetchTopicMetadata = vi
      .fn()
      .mockResolvedValueOnce({ topics: [] })
      .mockResolvedValueOnce(metadata(-1))
      .mockResolvedValueOnce(metadata(1, []))
      .mockResolvedValueOnce(metadata(1, [1], 5))
      .mockResolvedValue(metadata());
    const pending = waitForTopicLeaders({ fetchTopicMetadata }, 'fixture', 1);
    await vi.runAllTimersAsync();
    await pending;
    expect(fetchTopicMetadata).toHaveBeenCalledTimes(5);
    expect(fetchTopicMetadata).toHaveBeenLastCalledWith({
      topics: ['fixture'],
    });
  });

  it.each([3, 5, 6])(
    'retries only transient metadata protocol code %s',
    async (code) => {
      vi.useFakeTimers();
      const fetchTopicMetadata = vi
        .fn()
        .mockRejectedValueOnce(
          Object.assign(new Error('metadata propagating'), { code }),
        )
        .mockResolvedValue(metadata());
      const pending = waitForTopicLeaders({ fetchTopicMetadata }, 'fixture', 1);
      await vi.runAllTimersAsync();
      await pending;
      expect(fetchTopicMetadata).toHaveBeenCalledTimes(2);
    },
  );

  it.each([29, undefined])(
    'immediately propagates authorization or unclassified failure %s',
    async (code) => {
      const failure = Object.assign(new Error('do not hide this failure'), {
        code,
      });
      const fetchTopicMetadata = vi.fn().mockRejectedValue(failure);
      await expect(
        waitForTopicLeaders({ fetchTopicMetadata }, 'fixture', 1),
      ).rejects.toBe(failure);
      expect(fetchTopicMetadata).toHaveBeenCalledTimes(1);
    },
  );

  it('fails within the bounded wait when the requested partitions never become ready', async () => {
    vi.useFakeTimers();
    const fetchTopicMetadata = vi.fn().mockResolvedValue(metadata());
    const pending = expect(
      waitForTopicLeaders({ fetchTopicMetadata }, 'fixture', 3, 300),
    ).rejects.toThrow('Timed out waiting for 3 leaders');
    await vi.runAllTimersAsync();
    await pending;
    expect(fetchTopicMetadata).toHaveBeenCalledTimes(3);
  });
});
