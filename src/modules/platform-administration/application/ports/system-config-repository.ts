import type { SystemConfigKey } from '../../domain/system-config.js';
export const SYSTEM_CONFIG_REPOSITORY = Symbol('SYSTEM_CONFIG_REPOSITORY');
export interface SystemConfigRecord {
  configKey: string;
  value: unknown;
  status: string;
  version: number;
  updatedAt: Date;
  updatedByUserId: number | null;
}
export interface SystemConfigAudit {
  actorUserId: number;
  traceId: string;
  clientIp: string | null;
  userAgent: string | null;
}
export interface SystemConfigRepository {
  read(
    keys: readonly SystemConfigKey[],
    actorUserId?: number,
  ): Promise<SystemConfigRecord[]>;
  update(
    key: SystemConfigKey,
    value: string,
    expectedVersion: number,
    audit: SystemConfigAudit,
  ): Promise<SystemConfigRecord>;
}
