import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  SYSTEM_CONFIG_CATALOG,
  SystemConfigError,
  assertConfigVersion,
  configDefinition,
  normalizeConfigValue,
} from '../domain/system-config.js';
import {
  SYSTEM_CONFIG_REPOSITORY,
  type SystemConfigAudit,
  type SystemConfigRecord,
  type SystemConfigRepository,
} from './ports/system-config-repository.js';
import {
  CONTACT_EMAIL_VALIDATOR,
  type ContactEmailValidator,
} from './ports/contact-email-validator.js';

@Injectable()
export class ManageSystemConfig {
  constructor(
    @Inject(SYSTEM_CONFIG_REPOSITORY)
    private readonly repository: SystemConfigRepository,
    @Inject(CONTACT_EMAIL_VALIDATOR)
    private readonly emailValidator: ContactEmailValidator,
  ) {}
  async list(
    actorUserId: number,
    query: { page: number; pageSize: number; keyword?: string },
  ) {
    if (
      !Number.isSafeInteger(actorUserId) ||
      actorUserId < 1 ||
      actorUserId > 2147483647
    )
      throw new SystemConfigError(
        'forbidden',
        'Configuration actor is unavailable',
      );
    const { page, pageSize } = query,
      skip = (page - 1) * pageSize;
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100 ||
      !Number.isSafeInteger(skip) ||
      skip > 2147483647 ||
      (query.keyword !== undefined &&
        (typeof query.keyword !== 'string' ||
          Array.from(query.keyword).length > 100))
    )
      throw new SystemConfigError('invalid', 'Invalid configuration query');
    const rows = await this.repository.read(
      SYSTEM_CONFIG_CATALOG.map((d) => d.configKey),
      actorUserId,
    );
    const keyword = query.keyword?.trim().toLowerCase() ?? '';
    const definitions = SYSTEM_CONFIG_CATALOG.filter((d) =>
      `${d.configKey} ${d.label}`.toLowerCase().includes(keyword),
    );
    const items = definitions.slice(skip, skip + pageSize).map((d) =>
      toItem(
        d.configKey,
        this.emailValidator,
        rows.find((r) => r.configKey === d.configKey),
      ),
    );
    return {
      items,
      total: definitions.length,
      page,
      pageSize,
      hasNext: skip + items.length < definitions.length,
    };
  }
  async update(
    key: string,
    value: unknown,
    version: number,
    audit: SystemConfigAudit,
  ) {
    const definition = configDefinition(key),
      normalized = normalizeConfigValue(key, value, this.emailValidator);
    assertConfigVersion(version);
    return toItem(
      definition.configKey,
      this.emailValidator,
      await this.repository.update(
        definition.configKey,
        normalized,
        version,
        audit,
      ),
    );
  }
  async publicConfig() {
    const rows = await this.repository.read(
      SYSTEM_CONFIG_CATALOG.map((d) => d.configKey),
    );
    const items = SYSTEM_CONFIG_CATALOG.map((d) =>
      toItem(
        d.configKey,
        this.emailValidator,
        rows.find((r) => r.configKey === d.configKey),
      ),
    );
    const value = (key: string) =>
      items.find((item) => item.configKey === key)!.value;
    return {
      siteName: value('site.name')!,
      tagline: value('site.tagline')!,
      about: value('site.about'),
      contactEmail: value('site.contactEmail'),
      privacyPolicy: value('site.privacyPolicy'),
      termsOfService: value('site.termsOfService'),
      revision: createHash('sha256')
        .update(
          JSON.stringify(
            items.map(({ configKey, version }) => [configKey, version]),
          ),
        )
        .digest('hex'),
    };
  }
}
function toItem(
  key: string,
  emailValidator: ContactEmailValidator,
  row?: SystemConfigRecord,
) {
  const d = configDefinition(key);
  let value: string | null = d.defaultValue;
  if (row?.status === 'active') {
    try {
      value = normalizeConfigValue(key, row.value, emailValidator);
    } catch {
      /* Legacy invalid values use the public default, but retain their version for repair. */
    }
  }
  return {
    ...d,
    valueType: 'text' as const,
    value,
    version: row?.version ?? 0,
    updatedAt: row?.updatedAt.toISOString() ?? null,
    updatedByUserId: row?.updatedByUserId ?? null,
  };
}
