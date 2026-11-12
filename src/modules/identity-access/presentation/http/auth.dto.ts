import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  Validate,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  normalizeAccount,
  normalizeNickname,
} from '../../domain/registration-rules.js';

@ValidatorConstraint({ name: 'passwordByteLength', async: false })
export class PasswordByteLengthConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    const byteLength = Buffer.byteLength(value, 'utf8');
    return byteLength >= 8 && byteLength <= 72;
  }

  defaultMessage(): string {
    return 'password must be 8 to 72 UTF-8 bytes';
  }
}

@ValidatorConstraint({ name: 'loginPasswordByteLength', async: false })
export class LoginPasswordByteLengthConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    const byteLength = Buffer.byteLength(value, 'utf8');
    return byteLength > 0 && byteLength <= 72;
  }

  defaultMessage(): string {
    return 'password must be at most 72 UTF-8 bytes';
  }
}

export class RegisterUserDto {
  @ApiProperty({ maxLength: 50, example: 'snow.rider' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizeAccount(value) : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  account!: string;

  @ApiProperty({ minLength: 8, maxLength: 72, example: 'snow-boarding-2026' })
  @IsString()
  @Validate(PasswordByteLengthConstraint)
  password!: string;

  @ApiProperty({ minLength: 1, maxLength: 50, example: '雪客' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizeNickname(value) : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  nickname!: string;
}

export class LoginUserDto {
  @ApiProperty({ maxLength: 50, example: 'snow.rider' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizeAccount(value) : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  account!: string;

  @ApiProperty({ maxLength: 72 })
  @IsString()
  @Validate(LoginPasswordByteLengthConstraint)
  password!: string;
}

export class RefreshAuthSessionDto {
  @ApiPropertyOptional({
    maxLength: 256,
    description: 'Expo only; Web uses a cookie.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  refreshToken?: string;
}

export class LogoutAuthSessionDto extends RefreshAuthSessionDto {}

export class ChangeOwnPasswordDto {
  @ApiProperty({ maxLength: 72 })
  @IsString()
  @Validate(LoginPasswordByteLengthConstraint)
  currentPassword!: string;

  @ApiProperty({ minLength: 8, maxLength: 72 })
  @IsString()
  @Validate(PasswordByteLengthConstraint)
  newPassword!: string;
}
