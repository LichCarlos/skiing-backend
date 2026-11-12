import { Prisma } from '@prisma/client';
import { communityFixture } from '../../../../test/support/community-fixture.js';
import type { PrismaService } from '../../../shared/persistence/prisma.service.js';
import { CommunityRuleError } from '../domain/community-rules.js';
import { PrismaCommunityUnitOfWork } from './prisma-community-unit-of-work.js';

function serialConflict() {
  return new Prisma.PrismaClientKnownRequestError('retry transaction', {
    code: 'P2034',
    clientVersion: '6.19.0',
  });
}
describe('Prisma Community unit of work', () => {
  it.each(['40001', '40P01'])(
    'retries aborted raw row-lock failures %s only',
    async (code) => {
      const error = new Prisma.PrismaClientKnownRequestError(
        'raw lock failure',
        { code: 'P2010', clientVersion: '6.19.0', meta: { code } },
      );
      const transaction = vi
        .fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce('committed');
      const uow = new PrismaCommunityUnitOfWork({
        $transaction: transaction,
      } as unknown as PrismaService);
      await expect(uow.run(async () => 'value')).resolves.toBe('committed');
      expect(transaction).toHaveBeenCalledTimes(2);
    },
  );
  it('does not retry raw database constraints as if they were serialization failures', async () => {
    const error = new Prisma.PrismaClientKnownRequestError('constraint', {
      code: 'P2010',
      clientVersion: '6.19.0',
      meta: { code: '23503' },
    });
    const transaction = vi.fn().mockRejectedValue(error);
    const uow = new PrismaCommunityUnitOfWork({
      $transaction: transaction,
    } as unknown as PrismaService);
    await expect(uow.run(async () => 'value')).rejects.toBe(error);
    expect(transaction).toHaveBeenCalledOnce();
  });
  it('retries only aborted serialization conflicts and returns the later committed result', async () => {
    const transaction = vi
      .fn()
      .mockRejectedValueOnce(serialConflict())
      .mockResolvedValueOnce('committed');
    const uow = new PrismaCommunityUnitOfWork({
      $transaction: transaction,
    } as unknown as PrismaService);
    await expect(uow.run(async () => 'value')).resolves.toBe('committed');
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });
  it('bounds retries to three and exposes a domain conflict instead of a successful write', async () => {
    const transaction = vi.fn().mockRejectedValue(serialConflict());
    const uow = new PrismaCommunityUnitOfWork({
      $transaction: transaction,
    } as unknown as PrismaService);
    await expect(uow.run(async () => 'value')).rejects.toBeInstanceOf(
      CommunityRuleError,
    );
    expect(transaction).toHaveBeenCalledTimes(3);
  });
  it('does not retry other errors or application denials', async () => {
    const transaction = vi.fn().mockRejectedValue(new Error('audit failed'));
    const uow = new PrismaCommunityUnitOfWork({
      $transaction: transaction,
    } as unknown as PrismaService);
    await expect(uow.run(async () => 'value')).rejects.toThrow('audit failed');
    expect(transaction).toHaveBeenCalledOnce();
  });
  it('propagates callback failures through the database transaction promise', async () => {
    const { tx } = communityFixture();
    const transaction = vi.fn(
      async (callback: (client: unknown) => Promise<unknown>) => callback(tx),
    );
    const uow = new PrismaCommunityUnitOfWork({
      $transaction: transaction,
    } as unknown as PrismaService);
    await expect(
      uow.run(async () => {
        throw new Error('aborted');
      }),
    ).rejects.toThrow('aborted');
    expect(transaction).toHaveBeenCalledOnce();
  });
});
