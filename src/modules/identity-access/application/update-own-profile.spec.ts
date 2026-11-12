import { UpdateOwnProfile } from './update-own-profile.js';
import {
  InvalidAvatarAssetError,
  ProfileAccessDeniedError,
  ProfileConflictError,
} from './ports/user-profile-repository.js';

const audit = { traceId: 'profile-unit', clientIp: null, userAgent: null };
function setup() {
  const updateOwn = vi.fn().mockResolvedValue({
    userId: 7,
    account: 'snow',
    nickname: 'Snow',
    avatarAssetId: '9',
    legacyAvatar: null,
    avatarStorageKey: 'avatar/9',
  });
  const createReadUrl = vi
    .fn()
    .mockResolvedValue('https://signed.example/avatar/9');
  return {
    updateOwn,
    createReadUrl,
    service: new UpdateOwnProfile(
      { updateOwn },
      { put: vi.fn(), remove: vi.fn(), createReadUrl },
    ),
  };
}
describe('UpdateOwnProfile', () => {
  it('normalizes nicknames, retains omitted avatar and signs only the resulting asset for 900 seconds', async () => {
    const { service, updateOwn, createReadUrl } = setup();
    await expect(
      service.execute(7, { nickname: '  Snow  ' }, audit),
    ).resolves.toEqual({
      userId: 7,
      account: 'snow',
      nickname: 'Snow',
      avatarAssetId: '9',
      avatarUrl: 'https://signed.example/avatar/9',
    });
    expect(updateOwn).toHaveBeenCalledWith(7, { nickname: 'Snow' }, audit);
    expect(createReadUrl).toHaveBeenCalledWith('avatar/9', 900);
  });
  it.each([
    {},
    { nickname: '' },
    { nickname: '   ' },
    { nickname: null },
    { nickname: '雪'.repeat(51) },
    { avatarAssetId: '0' },
    { avatarAssetId: '01' },
    { avatarAssetId: '9223372036854775808' },
    { avatarAssetId: 9 },
  ])('rejects invalid input before persistence: %j', async (patch) => {
    const { service, updateOwn } = setup();
    await expect(
      service.execute(
        7,
        patch as Parameters<UpdateOwnProfile['execute']>[1],
        audit,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(updateOwn).not.toHaveBeenCalled();
  });
  it('counts Unicode code points and permits explicit avatar clearing', async () => {
    const { service, updateOwn } = setup();
    await service.execute(
      7,
      { nickname: '🏂'.repeat(50), avatarAssetId: null },
      audit,
    );
    expect(updateOwn).toHaveBeenCalledWith(
      7,
      { nickname: '🏂'.repeat(50), avatarAssetId: null },
      audit,
    );
  });
  it.each([
    [new InvalidAvatarAssetError(), 400],
    [new ProfileAccessDeniedError(), 403],
    [new ProfileConflictError(), 409],
  ] as const)(
    'maps persistence errors without retrying or signing',
    async (error, status) => {
      const { service, updateOwn, createReadUrl } = setup();
      updateOwn.mockRejectedValue(error);
      await expect(
        service.execute(7, { nickname: 'Snow' }, audit),
      ).rejects.toMatchObject({ status });
      expect(createReadUrl).not.toHaveBeenCalled();
      expect(updateOwn).toHaveBeenCalledOnce();
    },
  );
  it('reads a legacy URL only when no asset is bound', async () => {
    const { service, updateOwn, createReadUrl } = setup();
    updateOwn.mockResolvedValue({
      userId: 7,
      account: 'snow',
      nickname: 'Snow',
      avatarAssetId: null,
      legacyAvatar: 'https://legacy.example/a.png',
      avatarStorageKey: null,
    });
    expect(
      (await service.execute(7, { nickname: 'Snow' }, audit)).avatarUrl,
    ).toBe('https://legacy.example/a.png');
    updateOwn.mockResolvedValue({
      userId: 7,
      account: 'snow',
      nickname: 'Snow',
      avatarAssetId: '9',
      legacyAvatar: 'https://legacy.example/a.png',
      avatarStorageKey: null,
    });
    expect(
      (await service.execute(7, { nickname: 'Snow' }, audit)).avatarUrl,
    ).toBeNull();
    expect(createReadUrl).not.toHaveBeenCalled();
  });
});
