import { ForbiddenException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { communityActorRow } from '../../../../test/support/community-fixture.js';
import { authorizeCommunityWrite } from './community-authorization.js';

describe('Community transaction authorization using the shared RBAC resolver', () => {
  function setup(
    row: ReturnType<typeof communityActorRow> | null = communityActorRow(2),
  ) {
    const tx = { user: { findUnique: vi.fn().mockResolvedValue(row) } };
    return { tx, client: tx as unknown as Prisma.TransactionClient };
  }
  it('reads current grants from the supplied transaction and accepts compatible multi-role scopes', async () => {
    const row = communityActorRow(2);
    row.UserRoles.push({
      Role: { ...row.UserRoles[0]!.Role, RoleKey: 'another-role' },
    });
    const { tx, client } = setup(row);
    await expect(
      authorizeCommunityWrite(client, 2, 'community:dynamic:create'),
    ).resolves.toBeUndefined();
    expect(tx.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { UserId: 2 } }),
    );
  });
  it.each([
    'missing-user',
    'disabled-user',
    'no-membership',
    'disabled-role',
    'removed-grant',
    'disabled-permission',
    'invalid-scope',
    'conflicting-scopes',
    'mixed-admin',
  ])(
    'denies %s instead of trusting a previous Guard principal',
    async (kind) => {
      const row = communityActorRow(2);
      const role = row.UserRoles[0]!.Role;
      if (kind === 'disabled-user') row.Status = 'disabled';
      if (kind === 'no-membership') row.UserRoles = [];
      if (kind === 'disabled-role') role.Status = 'disabled';
      if (kind === 'removed-grant') role.RolePermissions = [];
      if (kind === 'disabled-permission')
        role.RolePermissions.forEach((p) => {
          p.Permission.Status = 'disabled';
        });
      if (kind === 'invalid-scope') role.DataScope = 'unknown';
      if (kind === 'conflicting-scopes')
        row.UserRoles.push({
          Role: { ...role, RoleKey: 'conflict', DataScope: 'all' },
        });
      if (kind === 'mixed-admin')
        row.UserRoles.push({ Role: { ...role, RoleKey: 'system_admin' } });
      const { client } = setup(kind === 'missing-user' ? null : row);
      await expect(
        authorizeCommunityWrite(client, 2, 'community:dynamic:create'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    },
  );
  it('requires both portal and moderation grants without a role-name shortcut', async () => {
    for (const removed of [
      'content:dynamic:moderate',
      'management:portal:enter',
    ]) {
      const row = communityActorRow(2);
      row.UserRoles[0]!.Role.RoleKey = 'system_admin';
      row.UserRoles[0]!.Role.RolePermissions =
        row.UserRoles[0]!.Role.RolePermissions.filter(
          (p) => p.Permission.PermissionKey !== removed,
        );
      await expect(
        authorizeCommunityWrite(
          setup(row).client,
          2,
          'content:dynamic:moderate',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
    await expect(
      authorizeCommunityWrite(setup().client, 2, 'content:dynamic:moderate'),
    ).resolves.toBeUndefined();
  });
  it.each([0, -1, 1.1, 2147483648, Number.MAX_SAFE_INTEGER])(
    'rejects invalid actor %s before querying the database',
    async (id) => {
      const { tx, client } = setup();
      await expect(
        authorizeCommunityWrite(client, id, 'community:like:toggle'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(tx.user.findUnique).not.toHaveBeenCalled();
    },
  );
});
