export const SELF_PASSWORD_CHANGE_REPOSITORY = Symbol(
  'SELF_PASSWORD_CHANGE_REPOSITORY',
);

export interface SelfPasswordChangeRepository {
  findPasswordHash(userId: number): Promise<string | null>;
  updatePassword(input: {
    userId: number;
    expectedPasswordHash: string;
    passwordHash: string;
    traceId: string;
    clientIp: string | null;
    userAgent: string | null;
    now: Date;
  }): Promise<boolean>;
}
