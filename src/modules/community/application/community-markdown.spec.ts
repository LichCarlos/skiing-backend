import { describe, expect, it } from 'vitest';
import { communityFixture } from '../../../../test/support/community-fixture.js';
import { parseArticleMarkdown } from '../../../shared/content/markdown.js';
import { CommunityWrites } from './community-writes.js';

describe('Community Markdown application integration', () => {
  const body = {
    content: '**雪道** [提及](resort:9) [知识](article:8) ![图片](asset:12)',
    contentFormat: 'markdown_v1' as const,
    imageAssetIds: ['12'],
    resortId: 3,
  };
  const parser = { parse: parseArticleMarkdown };
  it('keeps primary resort independent from mentions and reuses protected gallery assets', async () => {
    const { tx, uow } = communityFixture();
    await new CommunityWrites(uow, parser).createDynamic(2, body);
    expect(tx.isPublishedResort).toHaveBeenCalledWith(9);
    expect(tx.isPublishedResort).toHaveBeenCalledWith(3);
    expect(tx.isPublishedArticle).toHaveBeenCalledWith(8);
    expect(tx.createDynamic).toHaveBeenCalledWith(2, body);
    expect(tx.replaceDynamicImages).toHaveBeenCalledWith(7, ['12']);
    expect(tx.dynamicChanged).toHaveBeenCalledOnce();
  });
  it('rejects unbound body images before writes or events', async () => {
    const { tx, uow } = communityFixture();
    await expect(
      new CommunityWrites(uow, parser).createDynamic(2, {
        ...body,
        imageAssetIds: [],
      }),
    ).rejects.toThrow('Inline images');
    expect(tx.createDynamic).not.toHaveBeenCalled();
    expect(tx.dynamicChanged).not.toHaveBeenCalled();
  });
  it.each(['resort', 'article'] as const)(
    'rejects unavailable %s links without exposing details',
    async (kind) => {
      const { tx, uow } = communityFixture();
      (kind === 'resort'
        ? tx.isPublishedResort
        : tx.isPublishedArticle
      ).mockResolvedValue(false);
      await expect(
        new CommunityWrites(uow, parser).createDynamic(2, body),
      ).rejects.toThrow('not publicly available');
      expect(tx.createDynamic).not.toHaveBeenCalled();
    },
  );
  it('requires a version and explicit format when converting an existing post', async () => {
    const { tx, uow } = communityFixture();
    await expect(
      new CommunityWrites(uow, parser).updateDynamic(2, 7, body),
    ).rejects.toThrow('expectedVersion');
    expect(tx.updateDynamic).not.toHaveBeenCalled();
  });
});
