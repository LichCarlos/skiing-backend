import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Req,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength, Validate } from 'class-validator';
import type { Request } from 'express';
import { ResetManagedPassword } from '../../application/reset-managed-password.js';
import type {
  AuthorizationPrincipal,
  ResolvedDataScope,
} from '../../domain/authorization.js';
import { PasswordByteLengthConstraint } from './auth.dto.js';
import { RequireManagementResourcePermissions } from './authorization.decorators.js';

export class ResetManagedPasswordDto {
  @ApiProperty({
    type: String,
    format: 'password',
    writeOnly: true,
    description: '8–72 UTF-8 bytes, preserved without trimming.',
  })
  @IsString()
  @Validate(PasswordByteLengthConstraint)
  newPassword!: string;

  @ApiProperty({ minLength: 1, maxLength: 500 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}

interface ResetRequest extends Request {
  user: AuthorizationPrincipal;
  traceId: string;
  authorizationDataScopes: Readonly<Record<string, ResolvedDataScope>>;
}

@ApiTags('identity-access')
@Controller('admin/users')
export class AdminPasswordController {
  constructor(private readonly resetPassword: ResetManagedPassword) {}

  @Patch(':id/password')
  @RequireManagementResourcePermissions('user', 'system:user:reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Reset an account password and revoke all its sessions',
    description:
      'Protected system_admin identity, management entry, reset grant and global user scope required; reauthorized within one serializable transaction with session revocation and audit. Includes self reset. No automatic replay after an unknown outcome.',
  })
  @ApiNoContentResponse()
  @ApiBadRequestResponse({
    description: 'Invalid target, password, reason or unknown input fields.',
  })
  @ApiUnauthorizedResponse()
  @ApiForbiddenResponse()
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'Concurrent password reset conflicted.' })
  async reset(
    @Param('id', ParseIntPipe) userId: number,
    @Body() dto: ResetManagedPasswordDto,
    @Req() request: ResetRequest,
  ): Promise<void> {
    if (
      !request.user?.roles.some(
        (role) => role.active && role.roleKey === 'system_admin',
      ) ||
      request.authorizationDataScopes.user?.kind !== 'all'
    )
      throw new ForbiddenException();
    await this.resetPassword.execute({
      userId,
      newPassword: dto.newPassword,
      reason: dto.reason,
      audit: {
        actorUserId: request.user.userId,
        traceId: request.traceId,
        clientIp: request.ip ?? null,
        userAgent: request.get('user-agent') ?? null,
      },
    });
  }
}
