import type { ManagedUserStatus } from '../../domain/managed-user.js';
import type { ResolvedDataScope } from '../../domain/authorization.js';

export const MANAGED_USER_REPOSITORY = Symbol('MANAGED_USER_REPOSITORY');

export interface ManagedUserRole {
  roleId: number;
  roleKey: string;
  roleName: string;
  systemRoleCode: string | null;
  status: string;
}

export interface ManagedUser {
  userId: number;
  account: string;
  nickname: string;
  status: ManagedUserStatus;
  roles: ManagedUserRole[];
  merchant: { merchantId: number; businessName: string; status: string } | null;
  createdAt: Date;
}

export interface UserManagementAudit {
  actorUserId: number;
  traceId: string;
  clientIp: string | null;
  userAgent: string | null;
}

export interface ManagedUserRepository {
  list(input: {
    page: number;
    pageSize: number;
    keyword?: string;
    status?: ManagedUserStatus;
    scope: ResolvedDataScope;
  }): Promise<{ items: ManagedUser[]; total: number }>;
  findById(
    userId: number,
    scope: ResolvedDataScope,
  ): Promise<ManagedUser | null>;
  create(input: {
    account: string;
    nickname: string;
    passwordHash: string;
    roleIds: readonly number[];
    audit: UserManagementAudit;
  }): Promise<ManagedUser>;
  replaceRoles(input: {
    userId: number;
    roleIds: readonly number[];
    audit: UserManagementAudit;
  }): Promise<ManagedUser | null>;
  setStatus(input: {
    userId: number;
    status: ManagedUserStatus;
    audit: UserManagementAudit;
  }): Promise<ManagedUser | null>;
}
