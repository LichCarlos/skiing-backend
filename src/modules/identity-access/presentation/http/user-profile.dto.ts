import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class UpdateProfileDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 50 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  nickname?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    pattern: '^[1-9][0-9]{0,18}$',
    description:
      'Omit to retain; null to clear. A ready image owned by this user.',
  })
  @ValidateIf(
    (_object, value: unknown) => value !== undefined && value !== null,
  )
  @IsString()
  @Matches(/^[1-9]\d{0,18}$/)
  avatarAssetId?: string | null;
}
export class UserProfileVO {
  @ApiProperty() userId!: number;
  @ApiProperty() account!: string;
  @ApiProperty() nickname!: string;
  @ApiProperty({ type: String, nullable: true }) avatarAssetId!: string | null;
  @ApiProperty({ type: String, nullable: true }) avatarUrl!: string | null;
}
