import type {
  RoleAuthorizationDataScope,
  RoleAuthorizationFieldPolicy,
  RoleAuthorizationInput,
} from '../../domain/role-authorization.js';

export const ROLE_AUTHORIZATION_REPOSITORY = Symbol(
  'ROLE_AUTHORIZATION_REPOSITORY',
);

export interface RoleAuthorizationSnapshot extends RoleAuthorizationInput {
  roleId: number;
  roleKey: string;
  roleName: string;
  status: string;
}

export interface RoleAuthorizationAuditContext {
  actorUserId: number;
  traceId: string;
  clientIp: string | null;
  userAgent: string | null;
}

export interface ReplaceRoleAuthorizationInput {
  roleId: number;
  authorization: RoleAuthorizationInput;
  audit: RoleAuthorizationAuditContext;
}

export interface RoleAuthorizationRepository {
  findSnapshot(roleId: number): Promise<RoleAuthorizationSnapshot | null>;
  replaceAuthorization(
    input: ReplaceRoleAuthorizationInput,
  ): Promise<RoleAuthorizationSnapshot | null>;
}

export type {
  RoleAuthorizationDataScope,
  RoleAuthorizationFieldPolicy,
  RoleAuthorizationInput,
};
