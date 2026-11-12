import { ManageMerchantProfiles } from './manage-merchant-profiles.js';
import type {
  MerchantProfileCommand,
  MerchantProfileRepository,
} from './ports/merchant-profile-repository.js';
const base: MerchantProfileCommand = {
  userId: 2,
  kind: 'create',
  patch: { businessName: ' 北山 ', contact: ' 联系 ' },
  reason: ' 建档 ',
  audit: { actorUserId: 1, traceId: 'trace', clientIp: null, userAgent: null },
};
describe('merchant profile commands', () => {
  const write = vi.fn().mockResolvedValue({ merchantId: 3 });
  const service = new ManageMerchantProfiles({
    write,
  } as unknown as MerchantProfileRepository);
  beforeEach(() => write.mockClear());
  it('normalizes names, contact and reason without changing business identity', async () => {
    await service.write(base);
    expect(write).toHaveBeenCalledWith({
      ...base,
      reason: '建档',
      patch: { businessName: '北山', contact: '联系' },
    });
  });
  it('supports explicit nullable contact and partial fields', async () => {
    await service.write({
      ...base,
      kind: 'update',
      expectedVersion: 1,
      patch: { contact: null },
    });
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({ patch: { contact: null } }),
    );
  });
  it.each([
    { ...base, userId: 0 },
    { ...base, reason: ' ' },
    { ...base, patch: { businessName: ' ' } },
    { ...base, kind: 'update', expectedVersion: 0 },
    { ...base, kind: 'update', expectedVersion: 2147483647 },
    {
      ...base,
      kind: 'update',
      expectedVersion: 1,
      patch: { customFields: {} },
    },
    { ...base, kind: 'status', expectedVersion: 1, status: 'deleted' },
  ])('rejects invalid command %j', async (input) => {
    expect(() => service.write(input as MerchantProfileCommand)).toThrow();
    expect(write).not.toHaveBeenCalled();
  });
});
