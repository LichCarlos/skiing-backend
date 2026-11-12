import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import {
  ASSET_STORAGE,
  type AssetStorage,
} from '../../assets/application/ports/asset-storage.js';
import {
  isValidNickname,
  normalizeNickname,
} from '../domain/registration-rules.js';
import {
  USER_PROFILE_REPOSITORY,
  InvalidAvatarAssetError,
  ProfileAccessDeniedError,
  ProfileConflictError,
  type ProfilePatch,
  type UserProfileAudit,
  type UserProfileRepository,
} from './ports/user-profile-repository.js';

@Injectable()
export class UpdateOwnProfile {
  constructor(
    @Inject(USER_PROFILE_REPOSITORY)
    private readonly profiles: UserProfileRepository,
    @Inject(ASSET_STORAGE) private readonly storage: AssetStorage,
  ) {}
  async execute(userId: number, patch: ProfilePatch, audit: UserProfileAudit) {
    if (patch.nickname === undefined && patch.avatarAssetId === undefined)
      throw new BadRequestException('At least one profile field is required');
    if (
      patch.nickname !== undefined &&
      (typeof patch.nickname !== 'string' ||
        !isValidNickname(normalizeNickname(patch.nickname)))
    )
      throw new BadRequestException(
        'Nickname must be 1–50 characters after trimming',
      );
    if (
      patch.avatarAssetId !== undefined &&
      patch.avatarAssetId !== null &&
      (typeof patch.avatarAssetId !== 'string' ||
        !/^[1-9]\d{0,18}$/.test(patch.avatarAssetId) ||
        BigInt(patch.avatarAssetId) > 9_223_372_036_854_775_807n)
    )
      throw new BadRequestException('Invalid avatar asset ID');
    try {
      const result = await this.profiles.updateOwn(
        userId,
        {
          ...patch,
          ...(patch.nickname !== undefined
            ? { nickname: normalizeNickname(patch.nickname) }
            : {}),
        },
        audit,
      );
      return {
        userId: result.userId,
        account: result.account,
        nickname: result.nickname,
        avatarAssetId: result.avatarAssetId,
        avatarUrl: result.avatarStorageKey
          ? await this.storage.createReadUrl(result.avatarStorageKey, 900)
          : result.avatarAssetId
            ? null
            : result.legacyAvatar,
      };
    } catch (error) {
      if (error instanceof ProfileAccessDeniedError)
        throw new ForbiddenException('Account profile update is not permitted');
      if (error instanceof InvalidAvatarAssetError)
        throw new BadRequestException(
          'Avatar must be a ready image owned by this account',
        );
      if (error instanceof ProfileConflictError)
        throw new ConflictException(
          'Profile changed concurrently; reload before retrying',
        );
      throw error;
    }
  }
}
