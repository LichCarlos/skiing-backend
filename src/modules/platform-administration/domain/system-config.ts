export interface ContactEmailValidator {
  isValid(value: string): boolean;
}

export const SYSTEM_CONFIG_CATALOG = [
  {
    configKey: 'site.about',
    label: '平台介绍',
    maxLength: 10000,
    defaultValue: null,
  },
  {
    configKey: 'site.contactEmail',
    label: '联系邮箱',
    maxLength: 254,
    defaultValue: null,
  },
  {
    configKey: 'site.name',
    label: '平台名称',
    maxLength: 50,
    defaultValue: '凛迹雪客',
  },
  {
    configKey: 'site.privacyPolicy',
    label: '隐私政策',
    maxLength: 30000,
    defaultValue: null,
  },
  {
    configKey: 'site.tagline',
    label: '平台标语',
    maxLength: 200,
    defaultValue: '滑雪社群综合服务平台',
  },
  {
    configKey: 'site.termsOfService',
    label: '用户协议',
    maxLength: 30000,
    defaultValue: null,
  },
] as const;
export type SystemConfigKey =
  (typeof SYSTEM_CONFIG_CATALOG)[number]['configKey'];
export class SystemConfigError extends Error {
  constructor(
    readonly kind: 'invalid' | 'not-found' | 'conflict' | 'forbidden',
    message: string,
  ) {
    super(message);
  }
}
export function configDefinition(key: string) {
  const item = SYSTEM_CONFIG_CATALOG.find((entry) => entry.configKey === key);
  if (!item)
    throw new SystemConfigError('not-found', 'Configuration key not found');
  return item;
}
export function normalizeConfigValue(
  key: string,
  value: unknown,
  emailValidator: ContactEmailValidator,
): string {
  const item = configDefinition(key);
  if (typeof value !== 'string')
    throw new SystemConfigError('invalid', 'Configuration value must be text');
  const normalized = value.trim();
  if (!normalized || Array.from(normalized).length > item.maxLength)
    throw new SystemConfigError(
      'invalid',
      `Configuration value must contain 1–${item.maxLength} characters`,
    );
  if (key === 'site.contactEmail' && !emailValidator.isValid(normalized))
    throw new SystemConfigError('invalid', 'Invalid contact email');
  return normalized;
}
export function assertConfigVersion(version: number) {
  if (!Number.isInteger(version) || version < 0 || version > 2147483647)
    throw new SystemConfigError('invalid', 'Invalid expectedVersion');
  if (version === 2147483647)
    throw new SystemConfigError('conflict', 'Configuration version exhausted');
}
