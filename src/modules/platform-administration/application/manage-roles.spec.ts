import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { ManagedRoleRepository } from './ports/managed-role-repository.js';
import { ManageRoles } from './manage-roles.js';
import { ManagementWriteAuthorizationError } from '../../identity-access/domain/management-write-authorization.js';
import {
  ManagedRoleScopeAuthorizationError,
  ProtectedManagedRoleError,
  RegistrationRoleRequiredError,
} from './role-management-errors.js';

const role = {
  roleId: 7,
  roleKey: 'resort_operator',
  roleName: '雪场运营',
  description: null,
  dataScope: 'merchant' as const,
  status: 'active' as const,
  userCount: 2,
  permissionCount: 3,
  fieldPolicyCount: 0,
  dataScopes: [{ resourceKey: 'resort', scopeType: 'merchant' }],
};
const audit = {
  actorUserId: 42,
  traceId: 'trace-42',
  clientIp: null,
  userAgent: null,
};

function repository(overrides: Partial<ManagedRoleRepository> = {}) {
  return {
    list: vi.fn(async () => ({ items: [role], total: 1 })),
    findById: vi.fn(async () => role),
    create: vi.fn(async () => role),
    update: vi.fn(async () => role),
    disable: vi.fn(async () => true),
    ...overrides,
  } satisfies ManagedRoleRepository;
}

describe('ManageRoles', () => {
  it('maps transaction authorization denial to 403 for every write command', async () => {
    const denied = vi.fn(async () => {
      throw new ManagementWriteAuthorizationError();
    });
    const service = new ManageRoles(
      repository({ create: denied, update: denied, disable: denied }),
    );
    for (const operation of [
      () =>
        service.create({
          role: {
            roleKey: 'custom',
            roleName: 'Custom',
            description: null,
            dataScope: 'self',
          },
          audit,
        }),
      () =>
        service.update({ roleId: 7, patch: { roleName: 'Changed' }, audit }),
      () => service.disable({ roleId: 7, audit }),
    ])
      await expect(operation()).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('maps transaction scope authorization denial to HTTP 403', async () => {
    const service = new ManageRoles(
      repository({
        update: vi.fn(async () => {
          throw new ManagedRoleScopeAuthorizationError();
        }),
        create: vi.fn(async () => {
          throw new ManagedRoleScopeAuthorizationError();
        }),
      }),
    );
    await expect(
      service.update({ roleId: 7, patch: { dataScope: 'all' }, audit }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.create({
        role: {
          roleKey: 'custom',
          roleName: '自定义',
          description: null,
          dataScope: 'all',
        },
        audit,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('applies offset pagination and trims the keyword', async () => {
    const store = repository();
    const service = new ManageRoles(store);

    await expect(
      service.list({ page: 3, pageSize: 10, keyword: '  resort  ' }),
    ).resolves.toMatchObject({ page: 3, pageSize: 10, total: 1 });
    expect(store.list).toHaveBeenCalledWith({
      skip: 20,
      take: 10,
      keyword: 'resort',
    });
  });

  it('rejects invalid pagination and invalid role definitions before persistence', async () => {
    const store = repository();
    const service = new ManageRoles(store);
    await expect(
      service.list({ page: 0, pageSize: 20 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.list({ page: Number.MAX_SAFE_INTEGER, pageSize: 100 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.create({
        role: {
          roleKey: 'system_admin',
          roleName: '管理员',
          description: null,
          dataScope: 'all',
        },
        audit,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(store.create).not.toHaveBeenCalled();
  });

  it.each([
    { page: 2147483649, pageSize: 1 },
    { page: 21474838, pageSize: 100 },
  ])(
    'rejects an int32 offset overflow before persistence: %j',
    async (input) => {
      const store = repository();
      await expect(new ManageRoles(store).list(input)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(store.list).not.toHaveBeenCalled();
    },
  );

  it('accepts the maximum supported offset without rounding', async () => {
    const store = repository();
    await new ManageRoles(store).list({ page: 2147483648, pageSize: 1 });
    expect(store.list).toHaveBeenCalledWith({ skip: 2147483647, take: 1 });
  });

  it('maps protected and required registration role failures', async () => {
    const protectedService = new ManageRoles(
      repository({
        update: vi.fn(async () => {
          throw new ProtectedManagedRoleError();
        }),
      }),
    );
    await expect(
      protectedService.update({
        roleId: 1,
        patch: { roleName: 'Changed' },
        audit,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const requiredService = new ManageRoles(
      repository({
        disable: vi.fn(async () => {
          throw new RegistrationRoleRequiredError();
        }),
      }),
    );
    await expect(
      requiredService.disable({ roleId: 7, audit }),
    ).rejects.toMatchObject({ status: 409 });
  });
});
