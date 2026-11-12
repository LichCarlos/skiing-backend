import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { getAllowedWebOrigins } from '../../../../shared/http/web-origins.js';
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  CSRF_TOKEN_COOKIE,
  readCookie,
} from './access-token.guard.js';

interface RequestWithOrigin {
  headers: {
    origin?: string;
    cookie?: string;
    'x-csrf-token'?: string;
  };
  method: string;
}

@Injectable()
export class WebCsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithOrigin>();
    const origin = request.headers.origin;
    const isWrite = !['GET', 'HEAD', 'OPTIONS'].includes(
      request.method.toUpperCase(),
    );
    if (!origin) {
      if (
        isWrite &&
        (readCookie(request.headers.cookie, ACCESS_TOKEN_COOKIE) ||
          readCookie(request.headers.cookie, REFRESH_TOKEN_COOKIE))
      ) {
        throw new ForbiddenException(
          'Origin is required for cookie-authenticated writes',
        );
      }
      return true;
    }
    if (!getAllowedWebOrigins().has(origin)) {
      throw new ForbiddenException('Origin is not allowed');
    }

    if (isWrite) {
      const cookieToken = readCookie(request.headers.cookie, CSRF_TOKEN_COOKIE);
      const headerToken = request.headers['x-csrf-token'];
      if (
        !cookieToken ||
        !headerToken ||
        !equalTokens(cookieToken, headerToken)
      ) {
        throw new ForbiddenException('CSRF validation failed');
      }
    }
    return true;
  }
}

function equalTokens(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}
