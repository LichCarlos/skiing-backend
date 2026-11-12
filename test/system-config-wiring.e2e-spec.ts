import { Test, type TestingModule } from '@nestjs/testing';
import { PlatformAdministrationModule } from '../src/modules/platform-administration/platform-administration.module.js';
import { ManageSystemConfig } from '../src/modules/platform-administration/application/manage-system-config.js';
import { CONTACT_EMAIL_VALIDATOR } from '../src/modules/platform-administration/application/ports/contact-email-validator.js';
import { SYSTEM_CONFIG_REPOSITORY } from '../src/modules/platform-administration/application/ports/system-config-repository.js';
import { ContactEmailValidatorAdapter } from '../src/modules/platform-administration/infrastructure/contact-email-validator.adapter.js';
import { PrismaSystemConfigRepository } from '../src/modules/platform-administration/infrastructure/prisma-system-config.repository.js';
import { PrismaService } from '../src/shared/persistence/prisma.service.js';

describe('System configuration production module email wiring', () => {
  let module: TestingModule;
  const persistence = { $transaction: vi.fn() };
  const repository = { read: vi.fn(), update: vi.fn() };
  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [PlatformAdministrationModule],
    })
      .overrideProvider(PrismaService)
      .useValue(persistence)
      .overrideProvider(SYSTEM_CONFIG_REPOSITORY)
      .useValue(repository)
      .compile();
  });
  beforeEach(() => {
    vi.resetAllMocks();
  });
  afterAll(async () => {
    await module?.close();
  });

  it('binds the unchanged syntax adapter to the Domain/Application contract', () => {
    expect(module.get(CONTACT_EMAIL_VALIDATOR)).toBe(
      module.get(ContactEmailValidatorAdapter),
    );
  });
  it('rejects malformed email in both the application and direct repository paths before any database write', async () => {
    const audit = {
      actorUserId: 1,
      traceId: 'module-validation',
      clientIp: null,
      userAgent: null,
    };
    await expect(
      module
        .get(ManageSystemConfig)
        .update('site.contactEmail', 'a..b@example.com', 0, audit),
    ).rejects.toThrow('email');
    await expect(
      module
        .get(PrismaSystemConfigRepository)
        .update('site.contactEmail', 'a..b@example.com', 0, audit),
    ).rejects.toThrow('email');
    expect(repository.update).not.toHaveBeenCalled();
    expect(persistence.$transaction).not.toHaveBeenCalled();
  });
  it('preserves default projection for invalid legacy email and keeps its repair version', async () => {
    repository.read.mockResolvedValue([
      {
        configKey: 'site.contactEmail',
        value: 'a..b@example.com',
        version: 7,
        status: 'active',
        updatedAt: new Date('2026-11-02T00:00:00Z'),
        updatedByUserId: 1,
      },
    ]);
    const config = module.get(ManageSystemConfig);
    expect((await config.publicConfig()).contactEmail).toBeNull();
    const result = await config.list(1, {
      page: 1,
      pageSize: 20,
      keyword: 'site.contactEmail',
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ value: null, version: 7 });
  });
});
