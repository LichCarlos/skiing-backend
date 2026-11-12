import { ManageSystemConfig } from './manage-system-config.js';
import type { SystemConfigRepository } from './ports/system-config-repository.js';
describe('System configuration projections', () => {
  const repository = {
    read: vi.fn<SystemConfigRepository['read']>(),
    update: vi.fn<SystemConfigRepository['update']>(),
  };
  const emailValidator = { isValid: vi.fn<(value: string) => boolean>() };
  const service = new ManageSystemConfig(repository, emailValidator);
  beforeEach(() => {
    vi.resetAllMocks();
    repository.read.mockResolvedValue([]);
    emailValidator.isValid.mockImplementation(
      (value) => value === 'ski@example.com',
    );
  });
  it('projects defaults and only the fixed public keys', async () => {
    const value = await service.publicConfig();
    expect(value).toEqual({
      siteName: '凛迹雪客',
      tagline: '滑雪社群综合服务平台',
      about: null,
      contactEmail: null,
      privacyPolicy: null,
      termsOfService: null,
      revision: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(await service.publicConfig()).toEqual(value);
  });
  it('ignores invalid/inactive legacy values, retains version and exposes no adapter extras', async () => {
    repository.read.mockResolvedValue([
      {
        configKey: 'site.name',
        value: { secret: 'hidden' },
        version: 7,
        status: 'active',
        updatedAt: new Date(),
        updatedByUserId: 1,
      },
      {
        configKey: 'site.contactEmail',
        value: 'not-email',
        version: 1,
        status: 'active',
        updatedAt: new Date(),
        updatedByUserId: 1,
      },
      {
        configKey: 'site.about',
        value: 'disabled text',
        version: 1,
        status: 'disabled',
        updatedAt: new Date(),
        updatedByUserId: 1,
      },
      {
        configKey: 'JWT_SECRET',
        value: 'not-exposed',
        version: 1,
        status: 'active',
        updatedAt: new Date(),
        updatedByUserId: 1,
      },
    ]);
    const result = await service.publicConfig();
    expect(result).toMatchObject({
      siteName: '凛迹雪客',
      about: null,
      contactEmail: null,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /hidden|not-exposed|disabled text/,
    );
    expect(
      (await service.list(1, { page: 1, pageSize: 10, keyword: 'SITE.NAME' }))
        .items[0]!.version,
    ).toBe(7);
  });
  it('rejects unsafe pagination without persistence and filters only key/label', async () => {
    await expect(
      service.list(undefined as unknown as number, { page: 1, pageSize: 20 }),
    ).rejects.toThrow('actor');
    await expect(
      service.list(1, { page: 2147483647, pageSize: 100 }),
    ).rejects.toThrow('query');
    expect(repository.read).not.toHaveBeenCalled();
    expect(
      await service.list(1, { page: 1, pageSize: 1, keyword: '平台' }),
    ).toMatchObject({ total: 3, hasNext: true });
  });
  it('refuses a rejected email before invoking persistence', async () => {
    emailValidator.isValid.mockReturnValue(false);
    await expect(
      service.update('site.contactEmail', 'ski@example.com', 0, {
        actorUserId: 1,
        traceId: 'validation',
        clientIp: null,
        userAgent: null,
      }),
    ).rejects.toThrow('email');
    expect(repository.update).not.toHaveBeenCalled();
  });
  it('persists normalized email and preserves the supplied expected version and audit context', async () => {
    const audit = {
      actorUserId: 1,
      traceId: 'validation',
      clientIp: null,
      userAgent: null,
    };
    repository.update.mockResolvedValue({
      configKey: 'site.contactEmail',
      value: 'ski@example.com',
      status: 'active',
      version: 4,
      updatedAt: new Date('2026-11-02T00:00:00Z'),
      updatedByUserId: 1,
    });
    expect(
      await service.update('site.contactEmail', ' ski@example.com ', 3, audit),
    ).toMatchObject({
      configKey: 'site.contactEmail',
      value: 'ski@example.com',
      version: 4,
    });
    expect(repository.update).toHaveBeenCalledExactlyOnceWith(
      'site.contactEmail',
      'ski@example.com',
      3,
      audit,
    );
  });
});
