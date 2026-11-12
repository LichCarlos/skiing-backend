import { ForbiddenException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  authorizeOwnedAsset,
  authorizeOwnedAssetUpload,
} from './owned-asset-authorization.js';

const role = () => ({
  RoleKey: 'custom-image-writer',
  Status: 'active',
  DataScope: 'self',
  DataScopes: [],
  RolePermissions: [
    { Permission: { PermissionKey: 'asset:upload', Status: 'active' } },
  ],
});
const user = () => ({
  UserId: 42,
  Status: 'active',
  MerchantProfile: null,
  UserRoles: [{ Role: role() }],
});
function transaction(record: unknown) {
  const findUnique = vi.fn().mockResolvedValue(record);
  return {
    tx: { user: { findUnique } } as unknown as Prisma.TransactionClient,
    findUnique,
  };
}
describe('owned upload current transactional authorization', () => {
  for (const permission of ['asset:read-own', 'asset:delete-own'] as const) {
    it(`accepts only the explicit ${permission} operation without requiring upload or management`, async () => {
      const record = user();
      record.UserRoles[0]!.Role.RolePermissions = [
        { Permission: { PermissionKey: permission, Status: 'active' } },
      ];
      await expect(
        authorizeOwnedAsset(transaction(record).tx, 42, permission),
      ).resolves.toBeUndefined();
    });
    it(`does not substitute upload permission for ${permission}`, async () => {
      await expect(
        authorizeOwnedAsset(transaction(user()).tx, 42, permission),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  }
  it('uses explicit grants for any active custom role without requiring management or merchant identity', async () => {
    const record = user();
    record.UserRoles.unshift({
      Role: { ...role(), RoleKey: 'other-role', RolePermissions: [] },
    });
    const s = transaction(record);
    await expect(authorizeOwnedAssetUpload(s.tx, 42)).resolves.toBeUndefined();
    expect(s.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { UserId: 42 } }),
    );
  });
  it.each([
    null,
    { ...user(), Status: 'disabled' },
    { ...user(), UserRoles: [] },
    { ...user(), UserRoles: [{ Role: { ...role(), Status: 'disabled' } }] },
    { ...user(), UserRoles: [{ Role: { ...role(), RolePermissions: [] } }] },
    {
      ...user(),
      UserRoles: [
        {
          Role: {
            ...role(),
            RolePermissions: [
              {
                Permission: {
                  PermissionKey: 'asset:upload',
                  Status: 'disabled',
                },
              },
            ],
          },
        },
      ],
    },
    { ...user(), UserRoles: [{ Role: { ...role(), DataScope: 'unknown' } }] },
    {
      ...user(),
      UserRoles: [
        { Role: role() },
        { Role: { ...role(), RoleKey: 'system_admin' } },
      ],
    },
  ])(
    'rejects inactive, missing, revoked or invalid current authorization %#',
    async (record) => {
      await expect(
        authorizeOwnedAssetUpload(transaction(record).tx, 42),
      ).rejects.toBeInstanceOf(ForbiddenException);
    },
  );
  it.each([0, -1, 1.5, Number.NaN, 2_147_483_648])(
    'rejects invalid actor %s before querying',
    async (id) => {
      const s = transaction(user());
      await expect(authorizeOwnedAssetUpload(s.tx, id)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(s.findUnique).not.toHaveBeenCalled();
    },
  );
});
