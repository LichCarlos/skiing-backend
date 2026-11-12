import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { RoleAuthorizationRepository } from './ports/role-authorization-repository.js';
import { ManagementWriteAuthorizationError } from '../../identity-access/domain/management-write-authorization.js';
import {
  RoleAuthorizationAdministratorRequiredError,
  ProtectedSystemRoleError,
  InvalidRoleAuthorizationReferenceError,
} from './role-authorization-errors.js';
import { ManageRoleAuthorization } from './manage-role-authorization.js';

const snapshot = {
  roleId: 7,
  roleKey: 'resort_operator',
  roleName: '雪场运营',
  status: 'active',
  permissionIds: [3],
  dataScopes: [{ resourceKey: 'resort', scopeType: 'merchant' as const }],
  fieldPolicies: [],
};
const authorization = {
  permissionIds: [3],
  dataScopes: [{ resourceKey: 'resort', scopeType: 'merchant' as const }],
  fieldPolicies: [],
};
const audit = {
  actorUserId: 42,
  traceId: 'trace-42',
  clientIp: '127.0.0.1',
  userAgent: 'test-client',
};

function createRepository(
  overrides: Partial<RoleAuthorizationRepository> = {},
): RoleAuthorizationRepository {
  return {
    findSnapshot: vi.fn(async () => snapshot),
    replaceAuthorization: vi.fn(async () => snapshot),
    ...overrides,
  };
}

describe('ManageRoleAuthorization', () => {
  it('maps transaction permission and scope denial to 403', async () => {
    const service = new ManageRoleAuthorization(
      createRepository({
        replaceAuthorization: vi.fn(async () => {
          throw new ManagementWriteAuthorizationError();
        }),
      }),
    );
    await expect(
      service.replace({ roleId: 7, authorization, audit }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('returns 403 when the transaction no longer finds active administrator authority', async () => {
    const service = new ManageRoleAuthorization(
      createRepository({
        replaceAuthorization: vi.fn(async () => {
          throw new RoleAuthorizationAdministratorRequiredError();
        }),
      }),
    );
    await expect(
      service.replace({ roleId: 7, authorization, audit }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('replaces the complete authorization snapshot through the repository', async () => {
    const replaceAuthorization = vi.fn(async () => snapshot);
    const repository = createRepository({ replaceAuthorization });
    const service = new ManageRoleAuthorization(repository);

    await expect(
      service.replace({ roleId: 7, authorization, audit }),
    ).resolves.toEqual(snapshot);
    expect(replaceAuthorization).toHaveBeenCalledWith({
      roleId: 7,
      authorization,
      audit,
    });
  });

  it('rejects invalid snapshots before persistence', async () => {
    const replaceAuthorization = vi.fn(async () => snapshot);
    const repository = createRepository({ replaceAuthorization });
    const service = new ManageRoleAuthorization(repository);

    await expect(
      service.replace({
        roleId: 7,
        authorization: {
          ...authorization,
          permissionIds: [3, 3],
        },
        audit,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(replaceAuthorization).not.toHaveBeenCalled();
  });

  it('prevents mutation of system_admin and unknown permission references', async () => {
    const protectedRepository = createRepository({
      replaceAuthorization: vi.fn(async () => {
        throw new ProtectedSystemRoleError();
      }),
    });
    const protectedService = new ManageRoleAuthorization(protectedRepository);
    await expect(
      protectedService.replace({ roleId: 1, authorization, audit }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const invalidRepository = createRepository({
      replaceAuthorization: vi.fn(async () => {
        throw new InvalidRoleAuthorizationReferenceError(
          'Every permission must exist and be active',
        );
      }),
    });
    const invalidService = new ManageRoleAuthorization(invalidRepository);
    await expect(
      invalidService.replace({ roleId: 7, authorization, audit }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns 404 when a requested role does not exist', async () => {
    const repository = createRepository({
      findSnapshot: vi.fn(async () => null),
    });
    const service = new ManageRoleAuthorization(repository);

    await expect(service.get(999)).rejects.toMatchObject({ status: 404 });
  });
});
