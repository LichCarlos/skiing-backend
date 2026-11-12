import { applyDecorators, SetMetadata } from '@nestjs/common';
import type { AuthorizationResourceKey } from '../../domain/authorization-resources.js';

export const PUBLIC_ROUTE_METADATA = 'identity-access:public-route';
export const REQUIRED_PERMISSIONS_METADATA =
  'identity-access:required-permissions';
export const MANAGEMENT_ROUTE_METADATA = 'identity-access:management-route';
export const MANAGEMENT_ENTRY_ONLY_METADATA =
  'identity-access:management-entry-only';
export const RESOURCE_SCOPE_METADATA = 'identity-access:resource-scope';

export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(PUBLIC_ROUTE_METADATA, true);

export const RequirePermissions = (
  ...permissionKeys: string[]
): MethodDecorator & ClassDecorator =>
  applyDecorators(
    SetMetadata(PUBLIC_ROUTE_METADATA, false),
    SetMetadata(REQUIRED_PERMISSIONS_METADATA, permissionKeys),
  );

export const RequireManagementPermissions = (
  ...permissionKeys: string[]
): MethodDecorator & ClassDecorator =>
  applyDecorators(
    SetMetadata(PUBLIC_ROUTE_METADATA, false),
    SetMetadata(MANAGEMENT_ROUTE_METADATA, true),
    SetMetadata(REQUIRED_PERMISSIONS_METADATA, permissionKeys),
  );

// Aggregate endpoints resolve their independently granted panels in one snapshot.
export const RequireManagementEntry = (): MethodDecorator & ClassDecorator =>
  applyDecorators(
    RequireManagementPermissions(),
    SetMetadata(MANAGEMENT_ENTRY_ONLY_METADATA, true),
  );

export const RequireManagementResourcePermissions = (
  resourceKey: AuthorizationResourceKey,
  ...permissionKeys: string[]
): MethodDecorator & ClassDecorator =>
  applyDecorators(
    SetMetadata(PUBLIC_ROUTE_METADATA, false),
    SetMetadata(MANAGEMENT_ROUTE_METADATA, true),
    SetMetadata(REQUIRED_PERMISSIONS_METADATA, permissionKeys),
    SetMetadata(RESOURCE_SCOPE_METADATA, resourceKey),
  );
