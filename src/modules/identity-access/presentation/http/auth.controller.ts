import {
  BadRequestException,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  HttpException,
  ServiceUnavailableException,
  Post,
  Req,
  Res,
  UnauthorizedException,
  Body,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiResponse,
  ApiServiceUnavailableResponse,
} from '@nestjs/swagger';
import {
  LoginLimitUnavailableError,
  LoginRateLimitExceededError,
} from '../../application/check-login-attempt.js';
import { loginClientIp } from '../../../../shared/http/trusted-proxies.js';
import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { getAllowedWebOrigins } from '../../../../shared/http/web-origins.js';
import type { PermissionNode } from '../../domain/permission-tree.js';
import {
  AccountAlreadyRegisteredError,
  InvalidRegistrationInputError,
  RegisterUser,
} from '../../application/register-user.js';
import {
  AuthenticationRejectedError,
  LoginUser,
  type AuthSessionVO,
} from '../../application/login-user.js';
import {
  RefreshAuthSession,
  RefreshSessionRejectedError,
} from '../../application/refresh-auth-session.js';
import { LogoutAuthSession } from '../../application/logout-auth-session.js';
import {
  AuthenticatedUserUnavailableError,
  GetCurrentUser,
  type CurrentUserVO as CurrentUserModel,
} from '../../application/get-current-user.js';
import { Public, RequirePermissions } from './authorization.decorators.js';
import {
  ACCESS_TOKEN_COOKIE,
  CSRF_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  readCookie,
} from './access-token.guard.js';
import {
  LoginUserDto,
  LogoutAuthSessionDto,
  RefreshAuthSessionDto,
  RegisterUserDto,
} from './auth.dto.js';

const ACCESS_COOKIE_PATH = '/api/v1';
const AUTH_COOKIE_PATH = '/api/v1/auth';
const CSRF_COOKIE_PATH = '/api/v1';
const ACCESS_TTL_MS = 15 * 60 * 1000;

interface AuthRequest extends Request {
  authenticatedUserId?: number;
}

class RegisteredUserVO {
  @ApiProperty()
  userId!: number;

  @ApiProperty()
  account!: string;

  @ApiProperty()
  nickname!: string;
}

class PermissionNodeVO implements PermissionNode {
  @ApiProperty()
  permissionId!: number;

  @ApiProperty({ type: Number, nullable: true })
  parentId!: number | null;

  @ApiProperty()
  permissionKey!: string;

  @ApiProperty()
  permissionName!: string;

  @ApiProperty({ enum: ['directory', 'menu', 'button', 'api'] })
  permissionType!: PermissionNode['permissionType'];

  @ApiProperty({ type: String, nullable: true })
  route!: string | null;

  @ApiProperty({ type: String, nullable: true })
  icon!: string | null;

  @ApiProperty({ type: () => PermissionNodeVO, isArray: true })
  children!: PermissionNodeVO[];
}

class CurrentUserRoleVO {
  @ApiProperty()
  roleKey!: string;

  @ApiProperty()
  roleName!: string;
}

class CurrentUserVO implements CurrentUserModel {
  @ApiProperty()
  userId!: number;

  @ApiProperty()
  account!: string;

  @ApiProperty()
  nickname!: string;

  @ApiProperty({ type: String, nullable: true })
  avatarUrl!: string | null;

  @ApiProperty({ type: () => CurrentUserRoleVO, isArray: true })
  roles!: CurrentUserRoleVO[];

  @ApiProperty({ type: [String] })
  permissionKeys!: string[];

  @ApiProperty({ type: () => PermissionNodeVO, isArray: true })
  menuTree!: PermissionNode[];

  @ApiProperty({
    type: 'object',
    nullable: true,
    properties: {
      merchantId: { type: 'number' },
      businessName: { type: 'string' },
    },
  })
  merchant!: { merchantId: number; businessName: string } | null;
}

class RegisterUserResponseVO {
  @ApiProperty({ example: 201 })
  code!: number;

  @ApiProperty({ example: 'success' })
  msg!: string;

  @ApiProperty({ type: () => RegisteredUserVO })
  data!: RegisteredUserVO;

  @ApiProperty({ format: 'uuid' })
  traceId!: string;
}

class CurrentUserResponseVO {
  @ApiProperty({ example: 200 })
  code!: number;

  @ApiProperty({ example: 'success' })
  msg!: string;

  @ApiProperty({ type: () => CurrentUserVO })
  data!: CurrentUserVO;

  @ApiProperty({ format: 'uuid' })
  traceId!: string;
}

class AuthSessionDataVO {
  @ApiPropertyOptional({ description: 'Returned only to native App clients.' })
  accessToken?: string;

  @ApiPropertyOptional({ description: 'Returned only to native App clients.' })
  refreshToken?: string;

  @ApiProperty({ format: 'date-time' })
  accessTokenExpiresAt!: string;

  @ApiProperty({ format: 'date-time' })
  sessionExpiresAt!: string;

  @ApiProperty({ type: () => CurrentUserVO })
  currentUser!: CurrentUserVO;
}

class AuthSessionResponseVO {
  @ApiProperty({ example: 200 })
  code!: number;

  @ApiProperty({ example: 'success' })
  msg!: string;

  @ApiProperty({ type: () => AuthSessionDataVO })
  data!: AuthSessionDataVO;

  @ApiProperty({ format: 'uuid' })
  traceId!: string;
}

class CsrfDataVO {
  @ApiProperty({ type: String, nullable: true })
  csrfToken!: string | null;
}

class CsrfResponseVO {
  @ApiProperty({ example: 200 })
  code!: number;

  @ApiProperty({ example: 'success' })
  msg!: string;

  @ApiProperty({ type: () => CsrfDataVO })
  data!: CsrfDataVO;

  @ApiProperty({ format: 'uuid' })
  traceId!: string;
}

class LogoutDataVO {
  @ApiProperty({ example: true })
  loggedOut!: boolean;
}

class LogoutResponseVO {
  @ApiProperty({ example: 200 })
  code!: number;

  @ApiProperty({ example: 'success' })
  msg!: string;

  @ApiProperty({ type: () => LogoutDataVO })
  data!: LogoutDataVO;

  @ApiProperty({ format: 'uuid' })
  traceId!: string;
}

@ApiTags('identity-access')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly registerUser: RegisterUser,
    private readonly loginUser: LoginUser,
    private readonly refreshSession: RefreshAuthSession,
    private readonly logoutSession: LogoutAuthSession,
    private readonly currentUser: GetCurrentUser,
  ) {}

  @Get('csrf')
  @Public()
  @ApiOperation({ summary: 'Issue a browser CSRF token' })
  @ApiOkResponse({ type: CsrfResponseVO })
  csrf(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const origin = request.headers.origin;
    if (!origin || !getAllowedWebOrigins().has(origin)) {
      return { csrfToken: null };
    }
    return { csrfToken: issueCsrfCookie(response) };
  }

  @Post('register')
  @Public()
  @ApiOperation({
    summary: 'Register a user account without creating a session',
  })
  @ApiCreatedResponse({ type: RegisterUserResponseVO })
  @ApiBadRequestResponse({
    description: 'Account, password, or nickname is invalid.',
  })
  @ApiConflictResponse({ description: 'The account is already registered.' })
  async register(@Body() input: RegisterUserDto) {
    try {
      return await this.registerUser.execute(input);
    } catch (error) {
      if (error instanceof AccountAlreadyRegisteredError) {
        throw new ConflictException('Account is already registered');
      }
      if (error instanceof InvalidRegistrationInputError) {
        throw new BadRequestException({
          message: 'Registration input is invalid',
          details: [
            {
              field: error.field,
              code: 'VALIDATION_ERROR',
              message: error.message,
            },
          ],
        });
      }
      throw error;
    }
  }

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create a short-lived access and refresh session' })
  @ApiOkResponse({ type: AuthSessionResponseVO })
  @ApiUnauthorizedResponse({ description: 'Account or password is invalid.' })
  @ApiResponse({
    status: 429,
    description:
      'Login rate limit exceeded. Account 5/60s and trusted IP 30/60s; all valid attempts count. No automatic login replay.',
    headers: {
      'Retry-After': {
        description:
          'Ceiling seconds until all exhausted budgets recover, minimum 1.',
        schema: { type: 'integer', minimum: 1 },
      },
    },
    schema: {
      type: 'object',
      required: ['code', 'msg', 'data', 'traceId'],
      properties: {
        code: { type: 'integer', enum: [429] },
        msg: { type: 'string', enum: ['Login rate limit exceeded'] },
        data: { type: 'object', nullable: true, example: null },
        traceId: { type: 'string' },
      },
    },
  })
  @ApiServiceUnavailableResponse({
    description:
      'Login limit storage unavailable; fails closed before credentials or sessions are processed. Generic error envelope.',
    schema: {
      type: 'object',
      required: ['code', 'msg', 'data', 'traceId'],
      properties: {
        code: { type: 'integer', enum: [503] },
        msg: { type: 'string', enum: ['Internal server error'] },
        data: { type: 'object', nullable: true, example: null },
        traceId: { type: 'string' },
      },
    },
  })
  async login(
    @Body() input: LoginUserDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    try {
      let clientIp: string;
      try {
        clientIp = loginClientIp(request);
      } catch {
        throw new LoginLimitUnavailableError();
      }
      return this.presentSession(
        request,
        response,
        await this.loginUser.execute(input, clientIp),
      );
    } catch (error) {
      if (error instanceof LoginRateLimitExceededError) {
        response.setHeader('Retry-After', String(error.retryAfterSeconds));
        throw new HttpException(
          'Login rate limit exceeded',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      if (error instanceof LoginLimitUnavailableError)
        throw new ServiceUnavailableException();
      if (error instanceof AuthenticationRejectedError) {
        throw new UnauthorizedException('Invalid account or password');
      }
      throw error;
    }
  }

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate a refresh token and issue a new access JWT',
  })
  @ApiOkResponse({ type: AuthSessionResponseVO })
  @ApiUnauthorizedResponse({
    description: 'Refresh session is invalid or reused.',
  })
  async refresh(
    @Body() input: RefreshAuthSessionDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshToken = this.getRefreshToken(request, input?.refreshToken);
    if (!refreshToken) {
      if (this.isWebRequest(request)) clearAuthCookies(response);
      throw new UnauthorizedException();
    }
    try {
      return this.presentSession(
        request,
        response,
        await this.refreshSession.execute(refreshToken),
      );
    } catch (error) {
      if (error instanceof RefreshSessionRejectedError) {
        if (this.isWebRequest(request)) clearAuthCookies(response);
        throw new UnauthorizedException('Refresh session is invalid');
      }
      throw error;
    }
  }

  @Post('logout')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke the session; safe to call repeatedly' })
  @ApiOkResponse({ type: LogoutResponseVO })
  async logout(
    @Body() input: LogoutAuthSessionDto | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.logoutSession.execute(
      this.getRefreshToken(request, input?.refreshToken),
    );
    if (this.isWebRequest(request)) clearAuthCookies(response);
    return { loggedOut: true };
  }

  @Get('me')
  @RequirePermissions('account:profile:read')
  @ApiOperation({ summary: 'Read the current user and effective RBAC grants' })
  @ApiOkResponse({ type: CurrentUserResponseVO })
  @ApiUnauthorizedResponse({ description: 'Authentication is required.' })
  @ApiForbiddenResponse({ description: 'Current user permission is missing.' })
  async me(@Req() request: AuthRequest): Promise<CurrentUserModel> {
    if (!request.authenticatedUserId) throw new UnauthorizedException();
    try {
      return await this.currentUser.execute(request.authenticatedUserId);
    } catch (error) {
      if (error instanceof AuthenticatedUserUnavailableError) {
        throw new UnauthorizedException();
      }
      throw error;
    }
  }

  private getRefreshToken(
    request: Request,
    bodyToken: string | undefined,
  ): string | undefined {
    return this.isWebRequest(request)
      ? (readCookie(request.headers.cookie, REFRESH_TOKEN_COOKIE) ?? undefined)
      : bodyToken;
  }

  private isWebRequest(request: Request): boolean {
    const origin = request.headers.origin;
    return Boolean(origin && getAllowedWebOrigins().has(origin));
  }

  private presentSession(
    request: Request,
    response: Response,
    session: AuthSessionVO,
  ): AuthSessionVO {
    if (!this.isWebRequest(request)) return session;
    if (!session.accessToken || !session.refreshToken) {
      throw new ForbiddenException('Session tokens are unavailable');
    }
    const accessMaxAge = Math.max(
      0,
      Date.parse(session.accessTokenExpiresAt) - Date.now(),
    );
    response.cookie(ACCESS_TOKEN_COOKIE, session.accessToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: ACCESS_COOKIE_PATH,
      maxAge: Math.min(accessMaxAge, ACCESS_TTL_MS),
    });
    response.cookie(REFRESH_TOKEN_COOKIE, session.refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: AUTH_COOKIE_PATH,
      maxAge: Math.max(0, Date.parse(session.sessionExpiresAt) - Date.now()),
    });
    const {
      accessToken: _accessToken,
      refreshToken: _refreshToken,
      ...safeSession
    } = session;
    return safeSession;
  }
}

function issueCsrfCookie(response: Response): string {
  const token = randomBytes(32).toString('base64url');
  response.cookie(CSRF_TOKEN_COOKIE, token, {
    httpOnly: false,
    secure: true,
    sameSite: 'lax',
    path: CSRF_COOKIE_PATH,
    maxAge: ACCESS_TTL_MS,
  });
  return token;
}

function clearAuthCookies(response: Response): void {
  const common = { secure: true, sameSite: 'lax' as const };
  response.clearCookie(ACCESS_TOKEN_COOKIE, {
    ...common,
    path: ACCESS_COOKIE_PATH,
  });
  response.clearCookie(REFRESH_TOKEN_COOKIE, {
    ...common,
    path: AUTH_COOKIE_PATH,
  });
  response.clearCookie(CSRF_TOKEN_COOKIE, {
    ...common,
    path: CSRF_COOKIE_PATH,
  });
}
