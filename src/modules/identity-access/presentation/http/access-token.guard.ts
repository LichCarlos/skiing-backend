import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  AUTH_TOKEN_SERVICE,
  type AuthTokenService,
} from '../../application/ports/auth-token-service.js';
import {
  AUTH_SESSION_REPOSITORY,
  type AuthSessionRepository,
} from '../../application/ports/auth-session-repository.js';
import { Inject } from '@nestjs/common';
import {
  PUBLIC_ROUTE_METADATA,
  REQUIRED_PERMISSIONS_METADATA,
  MANAGEMENT_ENTRY_ONLY_METADATA,
} from './authorization.decorators.js';

interface AuthenticatedRequest {
  headers: { authorization?: string; cookie?: string };
  authenticatedUserId?: number;
  authenticatedSessionId?: string;
}

export const ACCESS_TOKEN_COOKIE = 'linji_access';
export const REFRESH_TOKEN_COOKIE = 'linji_refresh';
export const CSRF_TOKEN_COOKIE = 'linji_csrf';

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(AUTH_TOKEN_SERVICE)
    private readonly tokens: AuthTokenService,
    @Inject(AUTH_SESSION_REPOSITORY)
    private readonly sessions: AuthSessionRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(
      PUBLIC_ROUTE_METADATA,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic === true) {
      await this.attachOptionalPublicPrincipal(context);
      return true;
    }

    const requiredPermissions = this.reflector.getAllAndOverride<
      readonly string[]
    >(REQUIRED_PERMISSIONS_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]);
    const entryOnly =
      this.reflector.getAllAndOverride<boolean>(
        MANAGEMENT_ENTRY_ONLY_METADATA,
        [context.getHandler(), context.getClass()],
      ) === true;
    if (!requiredPermissions?.length && !entryOnly) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    const bearerToken = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length).trim()
      : null;
    const token =
      bearerToken ?? readCookie(request.headers.cookie, ACCESS_TOKEN_COOKIE);
    if (!token) throw new UnauthorizedException();

    const claims = this.tokens.verifyAccessToken(token);
    if (!claims) throw new UnauthorizedException();
    if (
      !(await this.sessions.isActive({
        sessionId: claims.sessionId,
        userId: claims.userId,
        now: new Date(),
      }))
    ) {
      throw new UnauthorizedException();
    }
    request.authenticatedUserId = claims.userId;
    request.authenticatedSessionId = claims.sessionId;
    return true;
  }

  private async attachOptionalPublicPrincipal(
    context: ExecutionContext,
  ): Promise<void> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    const bearerToken = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length).trim()
      : null;
    const token =
      bearerToken ?? readCookie(request.headers.cookie, ACCESS_TOKEN_COOKIE);
    if (!token) return;
    const claims = this.tokens.verifyAccessToken(token);
    if (!claims) return;
    if (
      !(await this.sessions.isActive({
        sessionId: claims.sessionId,
        userId: claims.userId,
        now: new Date(),
      }))
    )
      return;
    request.authenticatedUserId = claims.userId;
    request.authenticatedSessionId = claims.sessionId;
  }
}

export function readCookie(
  cookieHeader: string | undefined,
  name: string,
): string | null {
  if (!cookieHeader) return null;
  for (const cookie of cookieHeader.split(';')) {
    const separator = cookie.indexOf('=');
    if (separator < 0 || cookie.slice(0, separator).trim() !== name) continue;
    return cookie.slice(separator + 1).trim() || null;
  }
  return null;
}
