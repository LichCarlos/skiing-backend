import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';
import { CommunityWrites } from '../application/community-writes.js';
import { PrismaCommunityUnitOfWork } from './prisma-community-unit-of-work.js';
import { communityActorRow } from '../../../../test/support/community-fixture.js';

function createSut() {
  const tx = {
    customFieldGroup: { findMany: vi.fn().mockResolvedValue([]) },
    roleFieldPermission: { findMany: vi.fn().mockResolvedValue([]) },
    userRole: { findFirst: vi.fn().mockResolvedValue(null) },

    $queryRaw: vi.fn().mockResolvedValue([]),
    user: { findUnique: vi.fn().mockResolvedValue(communityActorRow(2)) },
    dynamic: {
      findUniqueOrThrow: vi
        .fn()
        .mockResolvedValue({ AuthorId: 2, CustomFields: {} }),
      create: vi.fn().mockResolvedValue({
        DynamicId: 7,
        Status: 'pending',
        CreateTime: new Date('2026-01-01T00:00:00Z'),
      }),
      findFirst: vi.fn().mockResolvedValue({
        DynamicId: 7,
        AuthorId: 2,
        Content: 'Original',
        ResortId: null,
        Status: 'published',
        Images: [],
        ModeratedAt: null,
        ModeratedByUserId: null,
        ModerationReason: null,
      }),
      update: vi.fn(),
    },
    dynamicImage: {
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
      deleteMany: vi.fn(),
    },
    comment: {
      create: vi.fn().mockResolvedValue({
        CommentId: 8,
        CreateTime: new Date('2026-01-01T00:00:00Z'),
      }),
    },
    likeRecord: {
      upsert: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn().mockResolvedValue(3),
      findUnique: vi.fn().mockResolvedValue({ UserId: 2 }),
    },
    outboxEvent: { create: vi.fn() },
    asset: { findMany: vi.fn().mockResolvedValue([{ AssetId: 11n }]) },
    skiResort: { findFirst: vi.fn().mockResolvedValue({ ResortId: 12 }) },
  };
  const prisma = {
    $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };
  return {
    sut: new CommunityWrites(
      new PrismaCommunityUnitOfWork(prisma as unknown as PrismaService),
    ),
    prisma,
    tx,
  };
}

describe('CommunityWrites', () => {
  it('creates a pending dynamic and associates only validated owned assets', async () => {
    const { sut, prisma, tx } = createSut();
    const result = await sut.createDynamic(2, {
      content: '  Snow day  ',
      imageAssetIds: ['11'],
      resortId: 12,
    });

    expect(tx.asset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AssetId: { in: [11n] },
          OwnerUserId: 2,
          Status: 'ready',
          MimeType: { in: ['image/jpeg', 'image/png', 'image/webp'] },
        },
      }),
    );
    expect(tx.dynamic.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          AuthorId: 2,
          Content: 'Snow day',
          Status: 'pending',
        }),
      }),
    );
    expect(tx.dynamicImage.createMany).toHaveBeenCalledWith({
      data: [{ DynamicId: 7, AssetId: 11n, SortOrder: 0 }],
    });
    expect(result.status).toBe('pending');
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
    expect(tx.outboxEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        EventType: 'dynamic.changed.v1',
        AggregateType: 'Dynamic',
        AggregateId: '7',
        Payload: { dynamicId: 7 },
      }),
    });
  });

  it('rejects assets that are not owned and ready', async () => {
    const { sut, tx } = createSut();
    vi.mocked(tx.asset.findMany).mockResolvedValue([]);
    await expect(
      sut.createDynamic(2, { content: 'Snow day', imageAssetIds: ['11'] }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('writes a RAG outbox event with the owner soft delete', async () => {
    const { sut, tx } = createSut();
    await sut.removeDynamic(2, 7);
    expect(tx.dynamic.update).toHaveBeenCalledWith({
      where: { DynamicId: 7 },
      data: { DeletedAt: expect.any(Date) },
    });
    expect(tx.outboxEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        EventType: 'dynamic.changed.v1',
        AggregateId: '7',
        Payload: { dynamicId: 7 },
      }),
    });
  });

  it('creates comments only through the validated dynamic lookup and trims content', async () => {
    const { sut, tx } = createSut();
    const result = await sut.createComment(2, 7, { content: '  Nice run!  ' });
    expect(tx.comment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          AuthorId: 2,
          DynamicId: 7,
          Content: 'Nice run!',
          Status: 'visible',
        }),
      }),
    );
    expect(result.commentId).toBe(8);
  });

  it('uses the like composite key for idempotent upsert and returns the derived count', async () => {
    const { sut, tx } = createSut();
    await expect(sut.setLiked(2, 7, true)).resolves.toEqual({
      liked: true,
      likeCount: 3,
    });
    expect(tx.likeRecord.upsert).toHaveBeenCalledWith({
      where: { UserId_DynamicId: { UserId: 2, DynamicId: 7 } },
      create: { UserId: 2, DynamicId: 7 },
      update: {},
    });
  });

  it('returns edited published dynamics to pending moderation', async () => {
    const { sut, tx } = createSut();
    vi.mocked(tx.dynamic.findFirst).mockResolvedValue({
      AuthorId: 2,
      Content: 'Original',
      ResortId: null,
      Status: 'published',
      Images: [],
    } as never);
    await expect(
      sut.updateDynamic(2, 7, { content: 'Edited' }),
    ).resolves.toEqual({ dynamicId: 7, status: 'pending' });
    expect(tx.dynamic.update).toHaveBeenCalledWith({
      where: { DynamicId: 7 },
      data: {
        Content: 'Edited',
        ContentFormat: 'plain_text',
        Version: {increment:1},
        ResortId: null,
        Status: 'pending',
        CustomFields: {},
        SchemaVersion: 1,
      },
    });
    expect(tx.outboxEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        EventType: 'dynamic.changed.v1',
        Payload: { dynamicId: 7 },
      }),
    });
  });
});
