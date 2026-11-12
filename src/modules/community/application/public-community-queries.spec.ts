import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PublicCommunityQueries } from './public-community-queries.js';
import type {
  PublicCommunityReader,
  PublicDynamicCard,
} from './ports/public-community-reader.js';
function fixture() {
  const card: PublicDynamicCard = {
    dynamicId: 7,
    author: { userId: 2, nickname: 'Skier', avatarUrl: null },
    summary: 'Snow',
    coverUrl: null,
    imageCount: 0,
    resort: null,
    likeCount: 0,
    commentCount: 0,
    likedByMe: false,
    status: 'published',
    createdAt: '2026-10-29T00:00:00.000Z',
  };
  const reader = {
    dynamics: vi
      .fn<PublicCommunityReader['dynamics']>()
      .mockResolvedValue({ items: [card], hasNext: true }),
    dynamic: vi.fn<PublicCommunityReader['dynamic']>().mockResolvedValue(null),
    comments: vi
      .fn<PublicCommunityReader['comments']>()
      .mockResolvedValue(null),
  };
  return { reader, card, sut: new PublicCommunityQueries(reader) };
}
describe('PublicCommunityQueries application port', () => {
  it.each([
    '',
    'A===',
    'abc!',
    ...[
      { createdAt: null, dynamicId: 7 },
      { createdAt: '2026-10-29', dynamicId: 7 },
      { createdAt: '2026-02-30T00:00:00.000Z', dynamicId: 7 },
      { createdAt: '2026-10-29T00:00:00.000Z', dynamicId: '7' },
      { createdAt: '2026-10-29T00:00:00.000Z', dynamicId: 2147483648 },
      { createdAt: '2026-10-29T00:00:00.000Z', dynamicId: 7, extra: 1 },
    ].map((value) => Buffer.from(JSON.stringify(value)).toString('base64url')),
  ])('rejects noncanonical cursor %s before querying', async (cursor) => {
    const { sut, reader } = fixture();
    await expect(sut.dynamics({ cursor })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(reader.dynamics).not.toHaveBeenCalled();
  });
  it('round-trips the stable timestamp/ID cursor and forwards the optional principal', async () => {
    const { reader, sut, card } = fixture();
    const first = await sut.dynamics({ limit: 10, keyword: 'snow' }, 2);
    expect(reader.dynamics).toHaveBeenCalledWith(
      { limit: 10, keyword: 'snow', before: null },
      2,
    );
    expect(first.nextCursor).not.toBeNull();
    await sut.dynamics({ cursor: first.nextCursor ?? undefined });
    expect(reader.dynamics).toHaveBeenLastCalledWith(
      {
        limit: 20,
        keyword: undefined,
        before: { createdAt: new Date(card.createdAt), dynamicId: 7 },
      },
      undefined,
    );
  });
  it('rejects malformed cursors before calling the persistence port', async () => {
    const { reader, sut } = fixture();
    await expect(sut.dynamics({ cursor: 'invalid' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(reader.dynamics).not.toHaveBeenCalled();
  });
  it('returns no continuation for an exhausted or empty slice', async () => {
    const { reader, sut, card } = fixture();
    reader.dynamics.mockResolvedValueOnce({ items: [card], hasNext: false });
    expect((await sut.dynamics({})).nextCursor).toBeNull();
    reader.dynamics.mockResolvedValueOnce({ items: [], hasNext: false });
    expect((await sut.dynamics({})).nextCursor).toBeNull();
  });
  it('maps unavailable details and comment parents to the existing 404 response', async () => {
    const { sut } = fixture();
    await expect(sut.dynamic(7)).rejects.toBeInstanceOf(NotFoundException);
    await expect(sut.comments(7, {})).rejects.toBeInstanceOf(NotFoundException);
  });
});
