import { resolveAvatarUrl } from './avatar-url.js';
describe('Avatar read policy', () => {
  const asset = {
    OwnerUserId: 7,
    Status: 'ready',
    StorageKey: 'avatar',
    MimeType: 'image/png',
  };
  it.each(['image/jpeg', 'image/png', 'image/webp'])(
    'signs owned ready %s',
    async (MimeType) => {
      const createReadUrl = vi.fn().mockResolvedValue('signed');
      expect(
        await resolveAvatarUrl(
          { createReadUrl },
          { UserId: 7, Avatar: 'legacy', AvatarAsset: { ...asset, MimeType } },
        ),
      ).toBe('signed');
      expect(createReadUrl).toHaveBeenCalledWith('avatar', 900);
    },
  );
  it.each([
    { OwnerUserId: 8 },
    { Status: 'deleted' },
    { Status: 'pending_scan' },
    { Status: 'rejected' },
    { MimeType: 'text/plain' },
  ])('fails closed for invalid asset %j', async (change) => {
    const createReadUrl = vi.fn();
    expect(
      await resolveAvatarUrl(
        { createReadUrl },
        { UserId: 7, Avatar: 'legacy', AvatarAsset: { ...asset, ...change } },
      ),
    ).toBeNull();
    expect(createReadUrl).not.toHaveBeenCalled();
  });
  it('keeps legacy fallback when no asset relationship exists', async () => {
    expect(
      await resolveAvatarUrl(
        { createReadUrl: vi.fn() },
        { UserId: 7, Avatar: 'legacy', AvatarAsset: null },
      ),
    ).toBe('legacy');
  });
});
