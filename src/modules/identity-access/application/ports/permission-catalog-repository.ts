import type {
  PermissionCatalogAuditContext,
  PermissionCatalogInput,
  PermissionCatalogPatch,
  PermissionCatalogRecord,
} from '../../domain/permission-catalog.js';

export const PERMISSION_CATALOG_REPOSITORY = Symbol(
  'PERMISSION_CATALOG_REPOSITORY',
);

export interface PermissionCatalogRepository {
  findTree(): Promise<PermissionCatalogRecord[]>;
  create(input: {
    permission: PermissionCatalogInput;
    audit: PermissionCatalogAuditContext;
  }): Promise<PermissionCatalogRecord>;
  update(input: {
    permissionId: number;
    patch: PermissionCatalogPatch;
    audit: PermissionCatalogAuditContext;
  }): Promise<PermissionCatalogRecord | null>;
  disable(input: {
    permissionId: number;
    audit: PermissionCatalogAuditContext;
  }): Promise<'disabled' | 'missing' | 'protected' | 'in-use'>;
  sync(input: {
    audit: PermissionCatalogAuditContext;
  }): Promise<{ created: number; updated: number; disabled: number }>;
}
