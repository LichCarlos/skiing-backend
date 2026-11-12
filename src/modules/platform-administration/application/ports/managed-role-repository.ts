import type {
  CreateManagedRoleInput,
  ManagedRole,
  ManagedRoleFilter,
  ManagedRolePage,
  RoleAuditContext,
  UpdateManagedRoleInput,
} from '../../domain/managed-role.js';

export const MANAGED_ROLE_REPOSITORY = Symbol('MANAGED_ROLE_REPOSITORY');

export interface ManagedRoleRepository {
  list(filter: ManagedRoleFilter): Promise<ManagedRolePage>;
  findById(roleId: number): Promise<ManagedRole | null>;
  create(input: {
    role: CreateManagedRoleInput;
    audit: RoleAuditContext;
  }): Promise<ManagedRole>;
  update(input: {
    roleId: number;
    patch: UpdateManagedRoleInput;
    audit: RoleAuditContext;
  }): Promise<ManagedRole | null>;
  disable(input: { roleId: number; audit: RoleAuditContext }): Promise<boolean>;
}
