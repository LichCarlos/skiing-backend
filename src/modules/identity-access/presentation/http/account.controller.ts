import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Patch,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { ChangeOwnPassword } from '../../application/change-own-password.js';
import { ChangeOwnPasswordDto } from './auth.dto.js';
import { RequirePermissions } from './authorization.decorators.js';
import { UpdateOwnProfile } from '../../application/update-own-profile.js';
import { UpdateProfileDto, UserProfileVO } from './user-profile.dto.js';

interface AuthenticatedRequest extends Request {
  authenticatedUserId?: number;
  traceId?: string;
}

@ApiTags('identity-access')
@Controller('account')
export class AccountController {
  constructor(
    private readonly changeOwnPassword: ChangeOwnPassword,
    private readonly updateProfile: UpdateOwnProfile,
  ) {}

  @Patch('profile')
  @RequirePermissions('account:profile:update')
  @ApiOperation({
    summary: 'Update own nickname or avatar',
    description:
      'At least one field. Omitted avatar is retained; null clears it. Replacing or clearing the avatar removes the legacy URL. Only own ready images are accepted. Identity and permission fields are rejected.',
  })
  @ApiOkResponse({ type: UserProfileVO })
  profile(
    @Body() input: UpdateProfileDto,
    @Req() request: AuthenticatedRequest,
  ) {
    if (!request.authenticatedUserId) throw new UnauthorizedException();
    return this.updateProfile.execute(request.authenticatedUserId, input, {
      traceId: request.traceId ?? 'unknown',
      clientIp: request.ip?.slice(0, 64) ?? null,
      userAgent: request.get('user-agent')?.slice(0, 500) ?? null,
    });
  }

  @Patch('password')
  @RequirePermissions('account:password:update')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Change the authenticated user password' })
  @ApiNoContentResponse()
  @ApiBadRequestResponse({
    description: 'New password does not meet password policy.',
  })
  @ApiUnauthorizedResponse({
    description: 'Authentication or current password is invalid.',
  })
  async changePassword(
    @Body() input: ChangeOwnPasswordDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    if (!request.authenticatedUserId) throw new UnauthorizedException();
    await this.changeOwnPassword.execute({
      userId: request.authenticatedUserId,
      currentPassword: input.currentPassword,
      newPassword: input.newPassword,
      traceId: request.traceId ?? 'unknown',
      clientIp: request.ip ?? null,
      userAgent: request.get('user-agent') ?? null,
    });
  }
}
