export const AUTHENTICATION_REPOSITORY = Symbol('AUTHENTICATION_REPOSITORY');

export interface AuthenticationRoleRecord {
  key: string;
  name: string;
  status: string;
  permissionKeys: readonly { key: string; status: string }[];
}

export interface AuthenticationIdentityRecord {
  userId: number;
  account: string;
  nickname: string;
  avatarUrl: string | null;
  status: string;
  passwordHash?: string | null;
  merchant: { id: number; businessName: string; status: string } | null;
  roles: readonly AuthenticationRoleRecord[];
}

export interface AuthenticationRepository {
  findByAccount(account: string): Promise<AuthenticationIdentityRecord | null>;
  findByUserId(userId: number): Promise<AuthenticationIdentityRecord | null>;
}
