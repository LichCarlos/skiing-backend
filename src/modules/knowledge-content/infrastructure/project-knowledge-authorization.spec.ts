import type { Prisma } from '@prisma/client';
import { authorizeProjectKnowledgeWrite } from './project-knowledge-authorization.js';

const actions = ['create', 'update', 'publish', 'withdraw', 'delete'].map(
  (action) => `content:project-knowledge:${action}`,
);
function setup() {
  const role = {
    RoleKey: 'system_admin',
    Status: 'active',
    DataScope: 'all',
    DataScopes: [],
    RolePermissions: ['management:portal:enter', ...actions].map(
      (PermissionKey) => ({ Permission: { PermissionKey, Status: 'active' } }),
    ),
  };
  const row = {
    UserId: 8,
    Status: 'active',
    MerchantProfile: null,
    UserRoles: [{ Role: role }],
  };
  const findUnique = vi.fn().mockResolvedValue(row);
  return {
    role,
    row,
    findUnique,
    tx: { user: { findUnique } } as unknown as Prisma.TransactionClient,
  };
}
describe('Project knowledge transaction authorization', () => {
  it.each(actions)(
    'requires the current exact %s grant even for built-in administrator',
    async (permission) => {
      const { role, tx } = setup();
      role.RolePermissions = role.RolePermissions.filter(
        (p) => p.Permission.PermissionKey !== permission,
      );
      await expect(
        authorizeProjectKnowledgeWrite(tx, 8, permission),
      ).rejects.toMatchObject({ status: 403 });
    },
  );
  it.each([
    'account',
    'role',
    'portal',
    'permission status',
    'identity',
    'binding',
    'mixed identity',
  ] as const)('fails closed for invalid %s', async (kind) => {
    const { tx, row, role } = setup();
    if (kind === 'account') row.Status = 'disabled';
    if (kind === 'role') role.Status = 'disabled';
    if (kind === 'portal')
      role.RolePermissions = role.RolePermissions.filter(
        (p) => p.Permission.PermissionKey !== 'management:portal:enter',
      );
    if (kind === 'permission status')
      role.RolePermissions.find(
        (p) => p.Permission.PermissionKey === actions[0],
      )!.Permission.Status = 'disabled';
    if (kind === 'identity') role.RoleKey = 'configured_global_role';
    if (kind === 'binding') row.UserRoles = [];
    if (kind === 'mixed identity')
      row.UserRoles.push({ Role: { ...role, RoleKey: 'extra_role' } });
    await expect(
      authorizeProjectKnowledgeWrite(tx, 8, actions[0]!),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('checks the protected role marker rather than accepting a renamed role', async () => {
    const { tx, findUnique, row } = setup();
    findUnique
      .mockResolvedValueOnce(row)
      .mockResolvedValueOnce({ UserRoles: [] });
    await expect(
      authorizeProjectKnowledgeWrite(tx, 8, actions[0]!),
    ).rejects.toMatchObject({ status: 403 });
    expect(findUnique).toHaveBeenLastCalledWith(
      expect.objectContaining({
        select: {
          UserRoles: {
            where: {
              Role: {
                RoleKey: 'system_admin',
                SystemRoleCode: 'system_admin',
                Status: 'active',
              },
            },
            select: { RoleId: true },
          },
        },
      }),
    );
  });
  it('does not infer an administrator grant for an unknown write action', async () => {
    const { tx } = setup();
    await expect(
      authorizeProjectKnowledgeWrite(tx, 8, 'content:project-knowledge:export'),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('allows the protected administrator with current grants and ignores inactive extra roles', async () => {
    const { tx, role, row } = setup();
    row.UserRoles.push({
      Role: { ...role, RoleKey: 'inactive_extra', Status: 'disabled' },
    });
    await expect(
      authorizeProjectKnowledgeWrite(tx, 8, actions[0]!),
    ).resolves.toBeUndefined();
  });
});
