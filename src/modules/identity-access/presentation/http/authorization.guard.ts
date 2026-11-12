import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  mayEnterManagementPortal,
  resolveDataScope,
  type AuthorizationPrincipal,
  type ResolvedDataScope,
} from '../../domain/authorization.js';
import { ResolveAuthorizationPrincipal } from '../../application/resolve-authorization-principal.js';
import { MANAGEMENT_PORTAL_ACCESS_PERMISSION } from '../../domain/permissions.js';
import {
  MANAGEMENT_ROUTE_METADATA,
  MANAGEMENT_ENTRY_ONLY_METADATA,
  PUBLIC_ROUTE_METADATA,
  REQUIRED_PERMISSIONS_METADATA,
  RESOURCE_SCOPE_METADATA,
} from './authorization.decorators.js';

interface AuthenticatedRequest {
  authenticatedUserId?: number;
  user?: AuthorizationPrincipal | null;
  authorizationDataScopes?: Readonly<Record<string, ResolvedDataScope>>;
}

@Injectable()
export class AuthorizationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly principals: ResolveAuthorizationPrincipal,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(
      PUBLIC_ROUTE_METADATA,
      targets,
    );
    if (isPublic === true) return true;

    const requiredPermissions = this.reflector.getAllAndOverride<
      readonly string[]
    >(REQUIRED_PERMISSIONS_METADATA, targets);
    const isManagementRoute = this.reflector.getAllAndOverride<boolean>(
      MANAGEMENT_ROUTE_METADATA,
      targets,
    );
    const resourceKey = this.reflector.getAllAndOverride<string>(
      RESOURCE_SCOPE_METADATA,
      targets,
    );
    const entryOnly =
      isManagementRoute === true &&
      this.reflector.getAllAndOverride<boolean>(
        MANAGEMENT_ENTRY_ONLY_METADATA,
        targets,
      ) === true;
    if (
      !requiredPermissions ||
      (!requiredPermissions.length && !entryOnly) ||
      requiredPermissions.some((key) => key.trim().length === 0) ||
      (resourceKey !== undefined && resourceKey.trim().length === 0)
    ) {
      throw new ForbiddenException('Route authorization is not configured');
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authenticatedUserId = request.authenticatedUserId;
    if (
      !Number.isSafeInteger(authenticatedUserId) ||
      authenticatedUserId === undefined ||
      authenticatedUserId < 1
    ) {
      throw new UnauthorizedException();
    }
    const principal = await this.principals.execute(authenticatedUserId);
    if (!principal || principal.userId !== authenticatedUserId) {
      throw new UnauthorizedException();
    }
    request.user = principal;
    if (!principal.active) throw new ForbiddenException();
    if (isManagementRoute && !mayEnterManagementPortal(principal)) {
      throw new ForbiddenException(
        `Missing ${MANAGEMENT_PORTAL_ACCESS_PERMISSION} grant`,
      );
    }
    const authorizationDataScopes: Record<string, ResolvedDataScope> = {};
    for (const permissionKey of requiredPermissions) {
      const scope = resolveDataScope(principal, permissionKey, resourceKey);
      if (!scope) throw new ForbiddenException();
      authorizationDataScopes[resourceKey ?? permissionKey] = scope;
    }
    request.authorizationDataScopes = authorizationDataScopes;
    return true;
  }
}
