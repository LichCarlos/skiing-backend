export const USER_PROFILE_REPOSITORY = Symbol('USER_PROFILE_REPOSITORY');
export interface ProfilePatch {
  nickname?: string;
  avatarAssetId?: string | null;
}
export interface UserProfileRecord {
  userId: number;
  account: string;
  nickname: string;
  avatarAssetId: string | null;
  legacyAvatar: string | null;
  avatarStorageKey: string | null;
}
export interface UserProfileAudit {
  traceId: string;
  clientIp: string | null;
  userAgent: string | null;
}
export interface UserProfileRepository {
  updateOwn(
    userId: number,
    input: ProfilePatch,
    audit: UserProfileAudit,
  ): Promise<UserProfileRecord>;
}
export class ProfileAccessDeniedError extends Error {}
export class InvalidAvatarAssetError extends Error {}
export class ProfileConflictError extends Error {}
