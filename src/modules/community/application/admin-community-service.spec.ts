import { ConflictException, ForbiddenException } from '@nestjs/common';
import { communityFixture } from '../../../../test/support/community-fixture.js';
import { AdminCommunityService } from './admin-community-service.js';
const audit = {
  actorUserId: 4,
  traceId: 'trace-1',
  clientIp: '127.0.0.1',
  userAgent: 'test',
};
function fixture() {
  const { tx, uow, dynamic } = communityFixture();
  const reader = {
    listDynamics: vi.fn(),
    getDynamic: vi.fn(),
    listComments: vi.fn(),
  };
  return { tx, uow, dynamic, sut: new AdminCommunityService(reader, uow) };
}
describe('Community moderation application ports', () => {
  it.each(['dynamic', 'comment', 'delete-dynamic', 'delete-comment'] as const)(
    'denies %s before business reads and writes when transaction grants are gone',
    async (action) => {
      const { tx, sut } = fixture();
      tx.authorize.mockRejectedValue(new ForbiddenException());
      const operation =
        action === 'dynamic'
          ? sut.moderateDynamic(7, { action: 'hide' }, audit)
          : action === 'comment'
            ? sut.moderateComment(8, { action: 'hide' }, audit)
            : action === 'delete-dynamic'
              ? sut.removeDynamic(7, audit)
              : sut.removeComment(8, audit);
      await expect(operation).rejects.toBeInstanceOf(ForbiddenException);
      expect(tx.authorize).toHaveBeenCalledWith(
        audit.actorUserId,
        'content:dynamic:moderate',
      );
      for (const method of [
        'findDynamic',
        'findComment',
        'moderateDynamic',
        'moderateComment',
        'deleteDynamic',
        'deleteComment',
        'dynamicChanged',
        'audit',
      ] as const)
        expect(tx[method]).not.toHaveBeenCalled();
    },
  );
  it('groups moderation, RAG event and full actor/reason snapshots in the supplied transaction', async () => {
    const { tx, sut } = fixture();
    await expect(
      sut.moderateDynamic(7, { action: 'hide', reason: ' reviewed ' }, audit),
    ).resolves.toMatchObject({
      dynamicId: 7,
      status: 'hidden',
      moderationReason: 'reviewed',
      moderatedByUserId: 4,
    });
    expect(tx.moderateDynamic).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ status: 'hidden', moderatedByUserId: 4 }),
    );
    expect(tx.dynamicChanged).toHaveBeenCalledWith(7);
    expect(tx.audit).toHaveBeenCalledWith(
      audit,
      expect.objectContaining({
        actionKey: 'community.dynamic.hide',
        before: expect.objectContaining({ status: 'published' }),
        after: expect.objectContaining({ status: 'hidden' }),
      }),
    );
  });
  it('rejects an invalid transition before any write or audit', async () => {
    const { tx, sut } = fixture();
    await expect(
      sut.moderateDynamic(7, { action: 'approve' }, audit),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.moderateDynamic).not.toHaveBeenCalled();
    expect(tx.dynamicChanged).not.toHaveBeenCalled();
    expect(tx.audit).not.toHaveBeenCalled();
  });
  it('does not return success if audit persistence fails', async () => {
    const { tx, sut } = fixture();
    tx.audit.mockRejectedValue(new Error('audit unavailable'));
    await expect(
      sut.moderateComment(8, { action: 'hide' }, audit),
    ).rejects.toThrow('audit unavailable');
  });
  it('soft deletes a comment with its dynamic reference in the audit and does not generate an unrelated RAG event', async () => {
    const { tx, sut } = fixture();
    await sut.removeComment(8, audit);
    expect(tx.deleteComment).toHaveBeenCalledWith(8, expect.any(Date));
    expect(tx.audit).toHaveBeenCalledWith(
      audit,
      expect.objectContaining({
        targetType: 'Comment',
        before: { status: 'visible', dynamicId: 7, deletedAt: null },
      }),
    );
    expect(tx.dynamicChanged).not.toHaveBeenCalled();
  });
});
