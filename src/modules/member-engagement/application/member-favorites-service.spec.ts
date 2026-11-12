import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MemberFavoritesService } from './member-favorites-service.js';
import type {
  FavoriteRepository,
  FavoriteRecord,
} from './ports/favorite-repository.js';
import type { FavoriteTargetType } from '../domain/favorite-rules.js';

function setup() {
  const repository = {
    hasPublicTarget: vi
      .fn<FavoriteRepository['hasPublicTarget']>()
      .mockResolvedValue(false),
    addPublicTarget: vi
      .fn<FavoriteRepository['addPublicTarget']>()
      .mockResolvedValue(true),
    remove: vi.fn<FavoriteRepository['remove']>().mockResolvedValue(undefined),
    findPage: vi
      .fn<FavoriteRepository['findPage']>()
      .mockResolvedValue({ items: [], total: 0 }),
  };
  return { repository, service: new MemberFavoritesService(repository) };
}
describe('MemberFavoritesService business port', () => {
  it('keeps actor and target intact and maps unavailable targets to 404', async () => {
    const { repository, service } = setup();
    await service.add(12, 'resort', 8);
    expect(repository.addPublicTarget).toHaveBeenCalledWith(12, 'resort', 8);
    repository.addPublicTarget.mockResolvedValue(false);
    await expect(service.add(12, 'article', 9)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
  it('allows idempotent removal of unavailable targets, scoped to the caller', async () => {
    const { repository, service } = setup();
    await service.remove(12, 'article', 9);
    await service.remove(12, 'article', 9);
    expect(repository.remove.mock.calls).toEqual([
      [12, 'article', 9],
      [12, 'article', 9],
    ]);
    expect(repository.addPublicTarget).not.toHaveBeenCalled();
  });
  it('projects plain records without losing BigInt identity, dates or price precision', async () => {
    const { repository, service } = setup();
    const time = new Date('2026-10-29T00:00:00Z');
    const items: FavoriteRecord[] = [
      {
        favoriteId: '9007199254740993',
        favoritedAt: time,
        target: {
          targetType: 'resort',
          id: 8,
          name: 'Snow',
          province: null,
          city: null,
          district: null,
          rating: null,
          startingPrice: '120',
        },
      },
      {
        favoriteId: '2',
        favoritedAt: time,
        target: {
          targetType: 'article',
          id: 9,
          title: 'Ski',
          summary: 'Learn',
          category: 'skills',
          publishedAt: time,
        },
      },
    ];
    repository.findPage.mockResolvedValue({ items, total: 21 });
    const result = await service.list(12, 2, 10);
    expect(repository.findPage).toHaveBeenCalledWith({
      userId: 12,
      skip: 10,
      take: 10,
      targetType: undefined,
    });
    expect(result).toMatchObject({ page: 2, pageSize: 10, total: 21 });
    expect(result.items[0]).toMatchObject({
      favoriteId: '9007199254740993',
      favoritedAt: time.toISOString(),
      target: { startingPrice: '120', rating: null },
    });
    expect(result.items[1]).toMatchObject({
      targetType: 'article',
      target: { publishedAt: time.toISOString() },
    });
  });
  it.each([
    () => setup().service.add(0, 'resort', 8),
    () => setup().service.add(12, 'resort', 2_147_483_648),
    () => setup().service.add(12, 'article', Number.MAX_SAFE_INTEGER + 1),
    () => setup().service.remove(12, 'resort', -1),
    () => setup().service.list(12, 1.5, 20),
    () => setup().service.list(12, 1, 101),
    () => setup().service.list(12, Number.MAX_SAFE_INTEGER, 100),
    () => setup().service.list(12, 1, 20, 'invalid' as FavoriteTargetType),
  ])(
    'rejects invalid identities, target types and unsafe paging',
    async (call) => {
      await expect(call()).rejects.toBeInstanceOf(BadRequestException);
    },
  );
  it('does not touch persistence on invalid input', async () => {
    const { repository, service } = setup();
    await expect(
      service.add(12, 'invalid' as FavoriteTargetType, 8),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.list(12, 0, 20)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repository.addPublicTarget).not.toHaveBeenCalled();
    expect(repository.findPage).not.toHaveBeenCalled();
  });
  it('propagates persistence conflicts and failures without claiming success', async () => {
    const { repository, service } = setup();
    const failure = new Error('database failed');
    repository.addPublicTarget.mockRejectedValue(failure);
    await expect(service.add(12, 'resort', 8)).rejects.toBe(failure);
  });
});
