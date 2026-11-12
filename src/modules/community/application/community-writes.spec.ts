import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { communityFixture } from '../../../../test/support/community-fixture.js';
import { CommunityWrites } from './community-writes.js';
import { parseArticleMarkdown } from '../../../shared/content/markdown.js';

describe('CommunityWrites application ports', () => {
  it('preserves all 150 owned image associations in one write', async () => {
    const { tx, uow } = communityFixture();
    const ids = Array.from({ length: 150 }, (_, i) => String(i + 1));
    tx.ownedReadyAssetIds.mockResolvedValue(ids);
    await new CommunityWrites(uow, {
      parse: parseArticleMarkdown,
    }).createDynamic(2, {
      contentFormat: 'markdown_v1',
      content: ids.map((id) => `![雪](asset:${id})`).join('\n'),
      imageAssetIds: ids,
    });
    expect(tx.ownedReadyAssetIds).toHaveBeenCalledWith(2, ids);
    expect(tx.replaceDynamicImages).toHaveBeenCalledWith(7, ids);
  });
  it.each([
    'create',
    'update',
    'delete',
    'comment',
    'delete-comment',
    'like',
    'unlike',
  ] as const)(
    'denies %s before reading or mutating business data when transaction authorization fails',
    async (action) => {
      const { tx, uow } = communityFixture();
      tx.authorize.mockRejectedValue(new ForbiddenException());
      const sut = new CommunityWrites(uow);
      const operation =
        action === 'create'
          ? sut.createDynamic(2, { content: 'new', imageAssetIds: [] })
          : action === 'update'
            ? sut.updateDynamic(2, 7, { content: 'edit' })
            : action === 'delete'
              ? sut.removeDynamic(2, 7)
              : action === 'comment'
                ? sut.createComment(2, 7, { content: 'reply' })
                : action === 'delete-comment'
                  ? sut.removeComment(2, 8)
                  : sut.setLiked(2, 7, action === 'like');
      await expect(operation).rejects.toBeInstanceOf(ForbiddenException);
      const permission =
        action === 'create'
          ? 'community:dynamic:create'
          : ['update', 'delete'].includes(action)
            ? 'community:dynamic:update-own'
            : ['comment', 'delete-comment'].includes(action)
              ? 'community:comment:create'
              : 'community:like:toggle';
      expect(tx.authorize).toHaveBeenCalledWith(2, permission);
      for (const method of [
        'findDynamic',
        'findComment',
        'createDynamic',
        'updateDynamic',
        'deleteDynamic',
        'createComment',
        'deleteComment',
        'setLike',
        'dynamicChanged',
        'audit',
      ] as const)
        expect(tx[method]).not.toHaveBeenCalled();
    },
  );
  it('creates pending content with owned references and the same transaction outbox', async () => {
    const { tx, uow } = communityFixture();
    const result = await new CommunityWrites(uow).createDynamic(2, {
      content: '  Snow day  ',
      imageAssetIds: ['12', '11'],
      resortId: 9,
    });
    expect(result).toEqual({
      dynamicId: 7,
      status: 'pending',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(tx.ownedReadyAssetIds).toHaveBeenCalledWith(2, ['12', '11']);
    expect(tx.isPublishedResort).toHaveBeenCalledWith(9);
    expect(tx.createDynamic).toHaveBeenCalledWith(2, {
      content: 'Snow day',
      imageAssetIds: ['12', '11'],
      resortId: 9,
    });
    expect(tx.replaceDynamicImages).toHaveBeenCalledWith(7, ['12', '11']);
    expect(tx.dynamicChanged).toHaveBeenCalledExactlyOnceWith(7);
  });
  it('rejects blank content without attempting persistence', async () => {
    const { tx, uow } = communityFixture();
    await expect(
      new CommunityWrites(uow).createDynamic(2, {
        content: '  ',
        imageAssetIds: [],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.createDynamic).not.toHaveBeenCalled();
  });
  it.each(['update', 'delete'] as const)(
    'rejects another author before %s and Outbox',
    async (action) => {
      const { tx, uow } = communityFixture();
      const sut = new CommunityWrites(uow);
      await expect(
        action === 'update'
          ? sut.updateDynamic(3, 7, { content: 'bad' })
          : sut.removeDynamic(3, 7),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(tx.updateDynamic).not.toHaveBeenCalled();
      expect(tx.deleteDynamic).not.toHaveBeenCalled();
      expect(tx.dynamicChanged).not.toHaveBeenCalled();
    },
  );
  it('preserves omitted references, revalidates them and returns published content to pending', async () => {
    const { tx, uow } = communityFixture();
    await expect(
      new CommunityWrites(uow).updateDynamic(2, 7, { content: ' edited ' }),
    ).resolves.toEqual({ dynamicId: 7, status: 'pending' });
    expect(tx.updateDynamic).toHaveBeenCalledWith(
      7,
      { content: 'edited', imageAssetIds: ['11'], resortId: 12 },
      'pending',
    );
    expect(tx.ownedReadyAssetIds).toHaveBeenCalledWith(2, ['11']);
  });
  it('rejects unavailable assets and resorts before content or images are mutated', async () => {
    const { tx, uow } = communityFixture();
    const sut = new CommunityWrites(uow);
    tx.ownedReadyAssetIds.mockResolvedValue([]);
    await expect(
      sut.updateDynamic(2, 7, { content: 'edit' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    tx.ownedReadyAssetIds.mockResolvedValue(['11']);
    tx.isPublishedResort.mockResolvedValue(false);
    await expect(
      sut.updateDynamic(2, 7, { content: 'edit' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.updateDynamic).not.toHaveBeenCalled();
    expect(tx.replaceDynamicImages).not.toHaveBeenCalled();
  });
  it('unlinks a resort with null, replaces images in exact order and rechecks every retained/new image', async () => {
    const { tx, uow } = communityFixture();
    await new CommunityWrites(uow).updateDynamic(2, 7, {
      resortId: null,
      imageAssetIds: ['12', '11'],
    });
    expect(tx.isPublishedResort).not.toHaveBeenCalled();
    expect(tx.ownedReadyAssetIds).toHaveBeenCalledWith(2, ['12', '11']);
    expect(tx.updateDynamic).toHaveBeenCalledWith(
      7,
      { content: 'Original', imageAssetIds: ['12', '11'] },
      'pending',
    );
    expect(tx.replaceDynamicImages).toHaveBeenCalledWith(7, ['12', '11']);
    expect(tx.dynamicChanged).toHaveBeenCalledExactlyOnceWith(7);
  });
  it('accepts an explicit empty image replacement and validates a new resort association', async () => {
    const { tx, uow } = communityFixture();
    await new CommunityWrites(uow).updateDynamic(2, 7, {
      resortId: 21,
      imageAssetIds: [],
    });
    expect(tx.isPublishedResort).toHaveBeenCalledWith(21);
    expect(tx.replaceDynamicImages).toHaveBeenCalledWith(7, []);
    expect(tx.ownedReadyAssetIds).not.toHaveBeenCalled();
  });
  it.each(['pending', 'hidden'] as const)(
    'rejects likes/comments on %s content',
    async (status) => {
      const { tx, uow, dynamic } = communityFixture();
      tx.findDynamic.mockResolvedValue({ ...dynamic, status });
      const sut = new CommunityWrites(uow);
      await expect(sut.setLiked(2, 7, true)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(
        sut.createComment(2, 7, { content: 'hello' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(tx.setLike).not.toHaveBeenCalled();
      expect(tx.createComment).not.toHaveBeenCalled();
    },
  );
  it('requires comment ownership and leaves missing content indistinguishable from deleted content', async () => {
    const { tx, uow } = communityFixture();
    const sut = new CommunityWrites(uow);
    await expect(sut.removeComment(3, 8)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    tx.findComment.mockResolvedValue(null);
    await expect(sut.removeComment(2, 8)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(tx.deleteComment).not.toHaveBeenCalled();
  });
});
