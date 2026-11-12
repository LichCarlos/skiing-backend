import { articleAuthorization } from './article-authorization.js';
import { articleActor } from '../../../../test/fixtures/article-actor.js';
import type { Prisma } from '@prisma/client';

function setup() {
  const user = articleActor();
  const tx = {
    user: { findUnique: vi.fn(async () => user) },
    customFieldDefinition: {
      findMany: vi.fn(async () => [
        {
          FieldDefinitionId: 1,
          Label: 'Level',
          GroupKey: 'general',
          SortOrder: 0,
          DefaultValue: null,
          Group: { GroupKey: 'general', Label: 'General', SortOrder: 0 },
          FieldKey: 'level',
          DataType: 'single_select',
          Required: false,
          Validation: null,
          OptionsDictType: 'knowledge.level',
          SchemaVersion: 3,
        },
      ]),
    },
    roleFieldPermission: {
      findMany: vi.fn(async () => [
        { FieldKey: 'level', CanRead: true, CanWrite: false },
        { FieldKey: 'level', CanRead: false, CanWrite: true },
        { FieldKey: 'secret', CanRead: false, CanWrite: false },
      ]),
    },
    dictionaryItem: {
      findMany: vi.fn(async () => [
        { DictType: 'knowledge.level', Value: 'beginner' },
      ]),
    },
  };
  const authorize = (
    access: Parameters<typeof articleAuthorization>[1] = { kind: 'all' },
  ) =>
    articleAuthorization(tx as unknown as Prisma.TransactionClient, access, 3);
  return { tx, user, authorize };
}
describe('Article authorization snapshot', () => {
  it('combines active role field grants and loads active schema/dictionaries on the transaction', async () => {
    const { tx, authorize } = setup();
    const { fields } = await authorize();
    expect(fields.policies.get('level')).toEqual({
      canRead: true,
      canWrite: true,
    });
    expect(fields.policies.get('secret')).toEqual({
      canRead: false,
      canWrite: false,
    });
    expect(fields.dictionaryValues.get('knowledge.level')).toEqual(
      new Set(['beginner']),
    );
    expect(tx.roleFieldPermission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          EntityType: 'article',
          Role: { Status: 'active', UserRoles: { some: { UserId: 3 } } },
        },
      }),
    );
    expect(tx.customFieldDefinition.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          EntityType: 'article',
          Status: 'active',
          Group: { Status: 'active' },
        },
      }),
    );
    expect(tx.dictionaryItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          DictType: { in: ['knowledge.level'] },
          Status: 'active',
          Type: { Status: 'active' },
        },
      }),
    );
  });
  it.each([
    'account',
    'role',
    'action',
    'portal',
    'scope',
    'conflict',
  ] as const)(
    'rejects revoked/changed %s before loading fields',
    async (change) => {
      const { user, tx, authorize } = setup();
      const role = user.UserRoles[0]!.Role;
      if (change === 'account') user.Status = 'disabled';
      if (change === 'role') role.Status = 'disabled';
      if (change === 'action' || change === 'portal')
        role.RolePermissions = role.RolePermissions.filter(
          ({ Permission }) =>
            Permission.PermissionKey !==
            (change === 'action'
              ? 'content:article:manage'
              : 'management:portal:enter'),
        );
      if (change === 'scope') role.DataScopes[0]!.ScopeType = 'self';
      if (change === 'conflict')
        user.UserRoles.push(
          articleActor({ kind: 'self', userId: 3 }).UserRoles[0]!,
        );
      await expect(authorize()).rejects.toMatchObject({ status: 403 });
      expect(tx.customFieldDefinition.findMany).not.toHaveBeenCalled();
      expect(tx.roleFieldPermission.findMany).not.toHaveBeenCalled();
    },
  );
  it('gives the protected sole system_admin all active fields without a data-scope-based bypass', async () => {
    const { user, tx, authorize } = setup();
    user.UserRoles[0]!.Role.RoleKey = 'system_admin';
    tx.user.findUnique
      .mockResolvedValueOnce(user)
      .mockResolvedValueOnce({ UserRoles: [{ RoleId: 1 }] } as never);
    const result = await authorize();
    expect(result.fields.policies.get('level')).toEqual({
      canRead: true,
      canWrite: true,
    });
    expect(result.fields.policies.has('secret')).toBe(false);
    expect(tx.roleFieldPermission.findMany).not.toHaveBeenCalled();
    expect(tx.user.findUnique).toHaveBeenLastCalledWith({
      where: { UserId: 3, Status: 'active' },
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
    });
  });
  it('rejects a sole system_admin role key without protected active membership before field loading', async () => {
    const { user, tx, authorize } = setup();
    user.UserRoles[0]!.Role.RoleKey = 'system_admin';
    tx.user.findUnique
      .mockResolvedValueOnce(user)
      .mockResolvedValueOnce({ UserRoles: [] } as never);
    await expect(authorize()).rejects.toMatchObject({ status: 403 });
    expect(tx.customFieldDefinition.findMany).not.toHaveBeenCalled();
    expect(tx.roleFieldPermission.findMany).not.toHaveBeenCalled();
  });
  it.each([0, -1, 1.5, 2147483648, Number.MAX_SAFE_INTEGER])(
    'rejects actor %s before Prisma reads',
    async (id) => {
      const { tx } = setup();
      await expect(
        articleAuthorization(
          tx as unknown as Prisma.TransactionClient,
          { kind: 'all' },
          id,
        ),
      ).rejects.toMatchObject({ status: 403 });
      expect(tx.user.findUnique).not.toHaveBeenCalled();
    },
  );
  it('denies missing accounts and absent grants instead of falling back to all fields', async () => {
    const { tx, authorize } = setup();
    tx.user.findUnique.mockResolvedValueOnce(null as never);
    await expect(authorize()).rejects.toMatchObject({ status: 403 });
    tx.roleFieldPermission.findMany.mockResolvedValueOnce([]);
    expect((await authorize()).fields.policies.size).toBe(0);
  });
});
