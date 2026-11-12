import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type SystemConfig } from '@prisma/client';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';
import { ResolveAuthorizationPrincipal } from '../../identity-access/application/resolve-authorization-principal.js';
import {
  mayEnterManagementPortal,
  resolveDataScope,
} from '../../identity-access/domain/authorization.js';
import { PrismaAuthorizationPrincipalReader } from '../../identity-access/infrastructure/prisma-authorization-principal-reader.js';
import type {
  SystemConfigAudit,
  SystemConfigRepository,
} from '../application/ports/system-config-repository.js';
import {
  CONTACT_EMAIL_VALIDATOR,
  type ContactEmailValidator,
} from '../application/ports/contact-email-validator.js';
import {
  SystemConfigError,
  assertConfigVersion,
  configDefinition,
  normalizeConfigValue,
  type SystemConfigKey,
} from '../domain/system-config.js';

@Injectable()
export class PrismaSystemConfigRepository implements SystemConfigRepository {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CONTACT_EMAIL_VALIDATOR)
    private readonly emailValidator: ContactEmailValidator,
  ) {}
  async read(keys: readonly SystemConfigKey[], actorUserId?: number) {
    keys.forEach(configDefinition);
    return this.prisma.$transaction(
      async (tx) => {
        if (actorUserId !== undefined)
          await authorize(tx, actorUserId, 'system:config:list');
        return (
          await tx.systemConfig.findMany({
            where: { ConfigKey: { in: [...keys] } },
            orderBy: { ConfigKey: 'asc' },
          })
        ).map(record);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async update(
    key: SystemConfigKey,
    value: string,
    expectedVersion: number,
    audit: SystemConfigAudit,
  ) {
    configDefinition(key);
    assertConfigVersion(expectedVersion);
    const normalized = normalizeConfigValue(key, value, this.emailValidator);
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const actor = await authorize(
            tx,
            audit.actorUserId,
            'system:config:update',
          );
          const before = await tx.systemConfig.findUnique({
            where: { ConfigKey: key },
          });
          if ((before?.Version ?? 0) !== expectedVersion)
            throw new SystemConfigError(
              'conflict',
              'Configuration changed; reload before saving',
            );
          if (before) {
            const changed = await tx.systemConfig.updateMany({
              where: { ConfigKey: key, Version: expectedVersion },
              data: {
                Value: normalized,
                Status: 'active',
                Version: { increment: 1 },
                UpdatedByUserId: audit.actorUserId,
              },
            });
            if (changed.count !== 1)
              throw new SystemConfigError(
                'conflict',
                'Configuration changed; reload before saving',
              );
          } else
            await tx.systemConfig.create({
              data: {
                ConfigKey: key,
                Value: normalized,
                Version: 1,
                UpdatedByUserId: audit.actorUserId,
              },
            });
          const after = await tx.systemConfig.findUniqueOrThrow({
            where: { ConfigKey: key },
          });
          await tx.operationLog.create({
            data: {
              ActorUserId: audit.actorUserId,
              ActorAccountSnapshot: actor.Account,
              ActionKey: 'system:config:update',
              ResourceKey: 'system-config',
              TargetType: 'SystemConfig',
              TargetId: key,
              Result: 'success',
              TraceId: audit.traceId,
              ClientIp: audit.clientIp,
              UserAgent: audit.userAgent,
              Metadata: {
                configKey: key,
                beforeVersion: before?.Version ?? 0,
                afterVersion: after.Version,
              },
            },
          });
          return record(after);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2002', 'P2034'].includes(error.code)
      )
        throw new SystemConfigError(
          'conflict',
          'Concurrent configuration update; reload before saving',
        );
      throw error;
    }
  }
}
async function authorize(
  tx: Prisma.TransactionClient,
  userId: number,
  permission: string,
) {
  const principal = await new ResolveAuthorizationPrincipal(
    new PrismaAuthorizationPrincipalReader(tx),
  ).execute(userId);
  if (
    !principal?.active ||
    !principal.roles.some((r) => r.active && r.roleKey === 'system_admin') ||
    !mayEnterManagementPortal(principal) ||
    !resolveDataScope(principal, permission)
  )
    throw new SystemConfigError(
      'forbidden',
      'Only system_admin may manage configuration',
    );
  const actor = await tx.user.findUnique({
    where: { UserId: userId },
    select: {
      Account: true,
      UserRoles: {
        where: {
          Role: {
            Status: 'active',
            RoleKey: 'system_admin',
            SystemRoleCode: 'system_admin',
          },
        },
        select: { RoleId: true },
      },
    },
  });
  if (!actor?.UserRoles.length)
    throw new SystemConfigError(
      'forbidden',
      'System administrator identity required',
    );
  return actor;
}
function record(row: SystemConfig) {
  return {
    configKey: row.ConfigKey,
    value: row.Value,
    status: row.Status,
    version: row.Version,
    updatedAt: row.UpdateTime,
    updatedByUserId: row.UpdatedByUserId,
  };
}
