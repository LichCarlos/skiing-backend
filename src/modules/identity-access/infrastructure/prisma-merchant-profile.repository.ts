import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type MerchantProfile } from '@prisma/client';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';
import type {
  MerchantProfileCommand,
  MerchantProfileRepository,
} from '../application/ports/merchant-profile-repository.js';
import { ResolveAuthorizationPrincipal } from '../application/resolve-authorization-principal.js';
import { PrismaAuthorizationPrincipalReader } from './prisma-authorization-principal-reader.js';
import {
  mayEnterManagementPortal,
  resolveDataScope,
} from '../domain/authorization.js';
import { PrismaCustomFieldRepository } from '../../platform-administration/infrastructure/prisma-custom-field.repository.js';
import {
  filterReadableCustomFields,
  validateCustomFieldWrite,
  type CustomFieldDefinition,
  type CustomFieldDataType,
} from '../../platform-administration/domain/custom-field-validation.js';

@Injectable()
export class PrismaMerchantProfileRepository implements MerchantProfileRepository {
  constructor(private readonly prisma: PrismaService) {}
  read(userId: number, actor: number) {
    return this.prisma.$transaction(
      async (tx) => {
        await authorize(tx, actor, 'read');
        if (
          !(await tx.user.findUnique({
            where: { UserId: userId },
            select: { UserId: true },
          }))
        )
          throw new NotFoundException('User not found');
        const record = await tx.merchantProfile.findUnique({
          where: { UserId: userId },
        });
        return record ? map(record, await fields(tx)) : null;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  schema(actor: number) {
    return this.prisma.$transaction(
      async (tx) => {
        await authorize(tx, actor, 'read');
        return {
          entityType: 'merchant_profile',
          groups: (await fields(tx)).groups.map((group) => ({
            ...group,
            fields: group.fields.map((field) => ({
              ...field,
              canRead: true,
              canWrite: true,
            })),
          })),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async write(input: MerchantProfileCommand) {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const action = input.kind === 'status' ? 'update-status' : input.kind;
          const principal = await authorize(
            tx,
            input.audit.actorUserId,
            action,
          );
          // Account before profile: shared locks in resort writes use this order too.
          await tx.$queryRaw`SELECT "UserId" FROM "User" WHERE "UserId"=${input.userId} FOR UPDATE`;
          const user = await tx.user.findUnique({
            where: { UserId: input.userId },
            select: { Status: true },
          });
          if (!user) throw new NotFoundException('User not found');
          await tx.$queryRaw`SELECT "MerchantId" FROM "MerchantProfile" WHERE "UserId"=${input.userId} FOR UPDATE`;
          const current = await tx.merchantProfile.findUnique({
            where: { UserId: input.userId },
          });
          if (input.kind === 'create' && current)
            throw new ConflictException('Profile already exists');
          if (input.kind !== 'create' && !current)
            throw new NotFoundException('Profile not found');
          if (
            current &&
            (current.Version !== input.expectedVersion ||
              current.Version >= 2147483647)
          )
            throw new ConflictException('Profile version changed or exhausted');
          if (
            (input.kind === 'create' ||
              (input.kind === 'status' && input.status === 'active')) &&
            user.Status !== 'active'
          )
            throw new ConflictException('Account is disabled');
          if (input.kind === 'status' && current?.Status === input.status)
            throw new ConflictException('Profile already has this status');
          const context = await fields(tx);
          const data: Prisma.MerchantProfileUncheckedUpdateInput = {};
          if (input.kind === 'status') data.Status = input.status;
          else {
            const dictionaryValues = new Map<string, ReadonlySet<string>>();
            for (const definition of context.definitions)
              if (
                definition.optionsDictType &&
                !dictionaryValues.has(definition.optionsDictType)
              ) {
                const items = await tx.dictionaryItem.findMany({
                  where: {
                    DictType: definition.optionsDictType,
                    Status: 'active',
                    Type: { Status: 'active' },
                  },
                  select: { Value: true },
                });
                dictionaryValues.set(
                  definition.optionsDictType,
                  new Set(items.map((i) => i.Value)),
                );
              }
            const validation = validateCustomFieldWrite({
              ...context,
              dictionaryValues,
              existingValues: current?.CustomFields as
                Record<string, unknown> | undefined,
              submittedValues: input.patch.customFields ?? {},
            });
            if (!validation.ok)
              throw new BadRequestException({
                message: 'Invalid custom fields',
                details: validation.issues.map((i) => ({
                  code: i.code,
                  field: i.fieldKey,
                  message: i.code,
                })),
              });
            data.BusinessName = input.patch.businessName;
            data.Contact = input.patch.contact;
            data.CustomFields = validation.values as Prisma.InputJsonObject;
            data.SchemaVersion = Math.max(
              1,
              ...context.groups.flatMap((g) =>
                g.fields.map((f) => f.schemaVersion),
              ),
            );
          }
          const record =
            input.kind === 'create'
              ? await tx.merchantProfile.create({
                  data: {
                    UserId: input.userId,
                    BusinessName: input.patch.businessName!,
                    Contact: input.patch.contact,
                    CustomFields: data.CustomFields as Prisma.InputJsonObject,
                    SchemaVersion: data.SchemaVersion as number,
                  },
                })
              : await tx.merchantProfile.update({
                  where: {
                    UserId: input.userId,
                    Version: input.expectedVersion,
                  },
                  data: { ...data, Version: { increment: 1 } },
                });
          const actor = await tx.user.findUniqueOrThrow({
            where: { UserId: principal.userId },
            select: { Account: true },
          });
          await tx.operationLog.create({
            data: {
              ActorUserId: principal.userId,
              ActorAccountSnapshot: actor.Account,
              ActionKey: `system:merchant-profile:${action}`,
              ResourceKey: 'user',
              TargetType: 'MerchantProfile',
              TargetId: String(record.MerchantId),
              Result: 'success',
              Reason: input.reason,
              TraceId: input.audit.traceId,
              ClientIp: input.audit.clientIp,
              UserAgent: input.audit.userAgent,
              Metadata: {
                userId: input.userId,
                previousVersion: current?.Version ?? null,
                version: record.Version,
                changedFields:
                  input.kind === 'status'
                    ? ['status']
                    : Object.keys(input.patch).sort(),
              },
            },
          });
          return map(record, context);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? error.code
          : null;
      const sqlState =
        typeof error === 'object' &&
        error !== null &&
        'meta' in error &&
        typeof error.meta === 'object' &&
        error.meta !== null &&
        'code' in error.meta
          ? error.meta.code
          : null;
      if (
        ['P2002', 'P2025', 'P2034'].includes(String(code)) ||
        (code === 'P2010' && ['40001', '40P01'].includes(String(sqlState)))
      )
        throw new ConflictException(
          'Merchant profile changed; reload before retrying',
        );
      throw error;
    }
  }
}
async function authorize(
  tx: Prisma.TransactionClient,
  actor: number,
  action: string,
) {
  const principal = await new ResolveAuthorizationPrincipal(
    new PrismaAuthorizationPrincipalReader(tx),
  ).execute(actor);
  if (
    !principal ||
    !mayEnterManagementPortal(principal) ||
    resolveDataScope(principal, `system:merchant-profile:${action}`, 'user')
      ?.kind !== 'all' ||
    !(await tx.userRole.findFirst({
      where: {
        UserId: actor,
        Role: {
          Status: 'active',
          RoleKey: 'system_admin',
          SystemRoleCode: 'system_admin',
        },
      },
    }))
  )
    throw new ForbiddenException(
      'Merchant profile administration is unavailable',
    );
  return principal;
}
async function fields(tx: Prisma.TransactionClient) {
  const groups = await new PrismaCustomFieldRepository(
    tx as PrismaService,
  ).findActiveSchema('merchant_profile');
  const definitions: CustomFieldDefinition[] = groups.flatMap((g) =>
    g.fields.map((f) => ({
      fieldKey: f.fieldKey,
      dataType: f.dataType as CustomFieldDataType,
      required: f.required,
      status: f.status,
      validation: f.validation,
      optionsDictType: f.optionsDictType,
    })),
  );
  return {
    groups,
    definitions,
    policies: new Map(
      definitions.map((f) => [f.fieldKey, { canRead: true, canWrite: true }]),
    ),
  };
}
function map(
  row: MerchantProfile,
  context: Awaited<ReturnType<typeof fields>>,
) {
  return {
    merchantId: row.MerchantId,
    userId: row.UserId,
    businessName: row.BusinessName,
    contact: row.Contact,
    status: row.Status,
    customFields: filterReadableCustomFields({
      ...context,
      values: row.CustomFields,
    }),
    schemaVersion: row.SchemaVersion,
    version: row.Version,
    createdAt: row.CreateTime,
    updatedAt: row.UpdateTime,
  };
}
