import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';
import { AdminCommunityService } from '../application/admin-community-service.js';
import { PrismaCommunityUnitOfWork } from './prisma-community-unit-of-work.js';
import { communityActorRow } from '../../../../test/support/community-fixture.js';

function createSut() {
  const tx = {
    dynamic: {
      findFirst: vi.fn().mockResolvedValue({
        AuthorId: 2,
        Content: 'Original',
        ResortId: null,
        Images: [],
        Status: 'pending',
        ModeratedAt: null,
        ModeratedByUserId: null,
        ModerationReason: null,
      }),
      update: vi.fn(),
    },
    comment: {
      findFirst: vi.fn().mockResolvedValue({
        AuthorId: 2,
        Status: 'visible',
        ModeratedAt: null,
        ModeratedByUserId: null,
        ModerationReason: null,
        DynamicId: 7,
      }),
      update: vi.fn(),
    },
    user: { findUnique: vi.fn().mockResolvedValue(communityActorRow(4)) },
    operationLog: { create: vi.fn() },
    outboxEvent: { create: vi.fn() },
  };
  const prisma = {
    $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };
  return {
    sut: new AdminCommunityService(
      { listDynamics: vi.fn(), getDynamic: vi.fn(), listComments: vi.fn() },
      new PrismaCommunityUnitOfWork(prisma as unknown as PrismaService),
    ),
    prisma,
    tx,
  };
}

const audit = {
  actorUserId: 4,
  traceId: 'trace-1',
  clientIp: '127.0.0.1',
  userAgent: 'test-agent',
};

describe('AdminCommunityService moderation', () => {
  it.each([
    ['pending', 'approve', 'published'],
    ['pending', 'hide', 'hidden'],
    ['published', 'hide', 'hidden'],
    ['hidden', 'restore', 'published'],
  ] as const)(
    'moves dynamic %s via %s to %s and writes audit atomically',
    async (from, action, to) => {
      const { sut, prisma, tx } = createSut();
      vi.mocked(tx.dynamic.findFirst).mockResolvedValue({
        AuthorId: 2,
        Content: 'Original',
        ResortId: null,
        Images: [],
        Status: from,
        ModeratedAt: null,
        ModeratedByUserId: null,
        ModerationReason: null,
      });

      const result = await sut.moderateDynamic(
        7,
        { action, reason: '  reviewed  ' },
        audit,
      );

      expect(result).toMatchObject({
        dynamicId: 7,
        status: to,
        moderatedByUserId: 4,
        moderationReason: 'reviewed',
      });
      expect(tx.dynamic.update).toHaveBeenCalledWith({
        where: { DynamicId: 7 },
        data: expect.objectContaining({
          Status: to,
          ModeratedByUserId: 4,
          ModerationReason: 'reviewed',
        }),
      });
      expect(tx.operationLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          ActorUserId: 4,
          ActorAccountSnapshot: 'moderator',
          ActionKey: `community.dynamic.${action}`,
          TargetType: 'Dynamic',
          TargetId: '7',
          Reason: 'reviewed',
          TraceId: 'trace-1',
        }),
      });
      expect(tx.outboxEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          EventType: 'dynamic.changed.v1',
          AggregateId: '7',
        }),
      });
      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: 'Serializable',
      });
    },
  );

  it('rejects invalid transitions without updating or auditing', async () => {
    const { sut, tx } = createSut();
    vi.mocked(tx.dynamic.findFirst).mockResolvedValue({
      AuthorId: 2,
      Content: 'Original',
      ResortId: null,
      Images: [],
      Status: 'published',
      ModeratedAt: null,
      ModeratedByUserId: null,
      ModerationReason: null,
    });
    await expect(
      sut.moderateDynamic(7, { action: 'approve' }, audit),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.dynamic.update).not.toHaveBeenCalled();
    expect(tx.operationLog.create).not.toHaveBeenCalled();
  });

  it('moderates comments and audits the state transition in the same transaction', async () => {
    const { sut, tx } = createSut();
    await expect(
      sut.moderateComment(8, { action: 'hide', reason: 'spam' }, audit),
    ).resolves.toMatchObject({ commentId: 8, status: 'hidden' });
    expect(tx.comment.update).toHaveBeenCalledWith({
      where: { CommentId: 8 },
      data: expect.objectContaining({
        Status: 'hidden',
        ModeratedByUserId: 4,
        ModerationReason: 'spam',
      }),
    });
    expect(tx.operationLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ActionKey: 'community.comment.hide',
        TargetType: 'Comment',
        TargetId: '8',
      }),
    });
  });

  it('soft deletes a dynamic and records the deletion in the same transaction', async () => {
    const { sut, tx } = createSut();
    await sut.removeDynamic(7, audit);
    expect(tx.dynamic.update).toHaveBeenCalledWith({
      where: { DynamicId: 7 },
      data: { DeletedAt: expect.any(Date) },
    });
    expect(tx.operationLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ActionKey: 'community.dynamic.delete',
        TargetId: '7',
      }),
    });
    expect(tx.outboxEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        EventType: 'dynamic.changed.v1',
        AggregateId: '7',
        Payload: { dynamicId: 7 },
      }),
    });
  });
});
