import { createHash } from 'node:crypto';
import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
  ConflictException,
  GoneException,
} from '@nestjs/common';
import { Prisma, type ResortRevenueRecord } from '@prisma/client';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';
import { RevenueWriteConflictError } from '../application/revenue-errors.js';
import { ResolveAuthorizationPrincipal } from '../../identity-access/application/resolve-authorization-principal.js';
import { PrismaAuthorizationPrincipalReader } from '../../identity-access/infrastructure/prisma-authorization-principal-reader.js';
import {
  mayEnterManagementPortal,
  resolveDataScope,
} from '../../identity-access/domain/authorization.js';
import type { MerchantResortAccess } from '../domain/resort-management-scope.js';
import type { RevenueRepository } from '../application/ports/revenue-repository.js';
import type {
  RevenueAuditContext,
  RevenueQueryRange,
  UpsertRevenueInput,
  RevenueRecordView,
} from '../application/revenue-models.js';
import {
  merchantResortWhere,
  merchantResortTargetWhere,
} from './merchant-resort-scope.js';
const include = {
  Resort: { select: { ResortId: true, Name: true } },
  Creator: { select: { UserId: true, Nickname: true } },
};
type RevenueRecord = ResortRevenueRecord & {
  Resort: { ResortId: number; Name: string };
  Creator: { UserId: number; Nickname: string };
};

@Injectable()
export class PrismaRevenueRepository implements RevenueRepository {
  constructor(private readonly prisma: PrismaService) {}
  async adminPage(
    actorUserId: number,
    query: RevenueQueryRange & { skip: number; take: number },
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        const principal = await new ResolveAuthorizationPrincipal(
          new PrismaAuthorizationPrincipalReader(tx),
        ).execute(actorUserId);
        const scope = resolveDataScope(
          principal,
          'revenue:system:list',
          'resort',
        );
        if (
          !mayEnterManagementPortal(principal) ||
          !scope ||
          !['all', 'selected'].includes(scope.kind)
        )
          throw new ForbiddenException(
            'A valid global/selected resort read scope is required',
          );
        const resortWhere: Prisma.SkiResortWhereInput = {
          DeletedAt: null,
          ...(scope.kind === 'selected'
            ? { ResortId: { in: [...scope.ids] } }
            : {}),
        };
        if (
          query.resortId &&
          !(await tx.skiResort.findFirst({
            where: { AND: [resortWhere, { ResortId: query.resortId }] },
            select: { ResortId: true },
          }))
        )
          throw new NotFoundException('Resort not found');
        const where: Prisma.ResortRevenueRecordWhereInput = {
          Resort: { is: resortWhere },
          ...(query.resortId ? { ResortId: query.resortId } : {}),
          ReportDate: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        };
        const [records, total] = await Promise.all([
          tx.resortRevenueRecord.findMany({
            where,
            skip: query.skip,
            take: query.take,
            orderBy: [{ ReportDate: 'desc' }, { RevenueId: 'desc' }],
            include,
          }),
          tx.resortRevenueRecord.count({ where }),
        ]);
        return { items: records.map(toVO), total };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async upsertIdempotent(
    body: UpsertRevenueInput,
    requestId: string,
    audit: RevenueAuditContext,
  ) {
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          resortId: body.resortId,
          reportDate: body.reportDate,
          revenueAmount: new Prisma.Decimal(body.revenueAmount).toFixed(2),
          note: normalizeNote(body.note),
        }),
      )
      .digest('hex');
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await authorizeWrite(tx, audit.actorUserId);
          // No waiting: another live attempt must not silently execute twice.
          const lockName = `revenue.upsert:${audit.actorUserId}:${requestId}`;
          const [lock] = await tx.$queryRaw<
            { acquired: boolean }[]
          >`SELECT pg_try_advisory_xact_lock(hashtextextended(${lockName}, 0)) AS acquired`;
          if (!lock?.acquired)
            throw requestConflict('REVENUE_REQUEST_IN_PROGRESS');
          const key = {
            ActorUserId_Operation_RequestId: {
              ActorUserId: audit.actorUserId,
              Operation: 'revenue.upsert',
              RequestId: requestId,
            },
          };
          const previous = await tx.revenueWriteRequest.findUnique({
            where: key,
          });
          if (previous) {
            if (previous.ExpiresAt <= new Date() || previous.Result === null)
              throw requestConflict('REVENUE_REQUEST_EXPIRED');
            if (previous.RequestHash !== requestHash)
              throw requestConflict('REVENUE_REQUEST_MISMATCH');
            return previous.Result as unknown as RevenueRecordView;
          }
          const result = await writeRevenue(tx, body, 'manual', audit);
          const completedAt = new Date();
          await tx.revenueWriteRequest.create({
            data: {
              ...key.ActorUserId_Operation_RequestId,
              RequestHash: requestHash,
              Result: result,
              CompletedAt: completedAt,
              ExpiresAt: new Date(completedAt.getTime() + 30 * 86400000),
            },
          });
          return result;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002')
          throw requestConflict('REVENUE_REQUEST_IN_PROGRESS');
        if (
          error.code === 'P2034' ||
          (error.code === 'P2010' &&
            ['40001', '40P01'].includes(String(error.meta?.code)))
        )
          throw new RevenueWriteConflictError();
      }
      throw error;
    }
  }
  async requestResult(actorUserId: number, requestId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        await authorizeWrite(tx, actorUserId);
        const request = await tx.revenueWriteRequest.findUnique({
          where: {
            ActorUserId_Operation_RequestId: {
              ActorUserId: actorUserId,
              Operation: 'revenue.upsert',
              RequestId: requestId,
            },
          },
        });
        if (!request) throw new NotFoundException('Revenue request not found');
        if (request.ExpiresAt <= new Date() || request.Result === null)
          throw new GoneException('Revenue request result expired');
        const record = request.Result as unknown as RevenueRecordView;
        // Deliberate whitelist: never include the request body, note or creator snapshot.
        return {
          requestId,
          status: 'completed' as const,
          createdAt: request.CreateTime.toISOString(),
          completedAt: request.CompletedAt.toISOString(),
          result: {
            revenueId: record.revenueId,
            resortId: record.resortId,
            reportDate: record.reportDate,
            revenueAmount: record.revenueAmount,
            source: record.source,
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
          },
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async purgeExpiredResults(now = new Date()) {
    const rows = await this.prisma.revenueWriteRequest.findMany({
      where: { ExpiresAt: { lte: now }, Result: { not: Prisma.DbNull } },
      select: { ActorUserId: true, Operation: true, RequestId: true },
      orderBy: { ExpiresAt: 'asc' },
      take: 500,
    });
    if (!rows.length) return 0;
    const result = await this.prisma.revenueWriteRequest.updateMany({
      where: { OR: rows, ExpiresAt: { lte: now } },
      data: { Result: Prisma.DbNull },
    });
    return result.count;
  }
  async findPage(
    access: MerchantResortAccess,
    query: RevenueQueryRange & { skip: number; take: number },
  ) {
    const where = revenueWhere(access, query);
    const [records, total] = await this.prisma.$transaction(
      [
        this.prisma.resortRevenueRecord.findMany({
          where,
          skip: query.skip,
          take: query.take,
          orderBy: [{ ReportDate: 'desc' }, { RevenueId: 'desc' }],
          include,
        }),
        this.prisma.resortRevenueRecord.count({ where }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return { items: records.map(toVO), total };
  }
  async summarize(access: MerchantResortAccess, query: RevenueQueryRange) {
    const where = revenueWhere(access, query);
    return this.prisma.$transaction(
      async (tx) => {
        const [aggregate, grouped, resort] = await Promise.all([
          tx.resortRevenueRecord.aggregate({
            where,
            _sum: { RevenueAmount: true },
          }),
          tx.resortRevenueRecord.groupBy({
            by: ['ReportDate'],
            where,
            _sum: { RevenueAmount: true },
            orderBy: { ReportDate: 'asc' },
          }),
          query.resortId
            ? tx.skiResort.findFirst({
                where: merchantResortTargetWhere(access, query.resortId),
                select: { ResortId: true, Name: true },
              })
            : Promise.resolve(null),
        ]);
        if (query.resortId && !resort)
          throw new NotFoundException('Resort not found');
        return {
          resortId: resort?.ResortId ?? null,
          resortName: resort?.Name ?? null,
          totalAmount: (
            aggregate._sum.RevenueAmount ?? new Prisma.Decimal(0)
          ).toFixed(2),
          daily: grouped.map((item) => ({
            date: formatDate(item.ReportDate),
            amount: (item._sum.RevenueAmount ?? new Prisma.Decimal(0)).toFixed(
              2,
            ),
          })),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async upsert(
    body: UpsertRevenueInput,
    source: 'manual' | 'import',
    audit: RevenueAuditContext,
  ) {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await authorizeWrite(tx, audit.actorUserId);
          return writeRevenue(tx, body, source, audit);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2034' ||
          (error.code === 'P2010' &&
            ['40001', '40P01'].includes(String(error.meta?.code))))
      )
        throw new RevenueWriteConflictError();
      throw error;
    }
  }
}
export async function authorizeWrite(
  tx: Prisma.TransactionClient,
  userId: number,
) {
  const principal = await new ResolveAuthorizationPrincipal(
    new PrismaAuthorizationPrincipalReader(tx),
  ).execute(userId);
  if (
    !mayEnterManagementPortal(principal) ||
    !resolveDataScope(principal, 'revenue:system:upsert')
  )
    throw new ForbiddenException(
      'Revenue write authorization is no longer valid',
    );
}
function requestConflict(code: string) {
  return new ConflictException({
    message: code,
    details: [{ code, message: code }],
  });
}
function revenueWhere(
  access: MerchantResortAccess,
  query: RevenueQueryRange,
): Prisma.ResortRevenueRecordWhereInput {
  return {
    Resort: { is: merchantResortWhere(access) },
    ...(query.resortId ? { ResortId: query.resortId } : {}),
    ...(query.from || query.to
      ? {
          ReportDate: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        }
      : {}),
  };
}
function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}
function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
function normalizeNote(note?: string | null): string | null {
  return note?.trim() || null;
}
function toVO(record: RevenueRecord) {
  return {
    revenueId: record.RevenueId,
    resortId: record.ResortId,
    resortName: record.Resort.Name,
    reportDate: formatDate(record.ReportDate),
    revenueAmount: record.RevenueAmount.toFixed(2),
    source: record.Source,
    note: record.Note,
    createdBy: {
      userId: record.Creator.UserId,
      nickname: record.Creator.Nickname,
    },
    createdAt: record.CreateTime.toISOString(),
    updatedAt: record.UpdateTime.toISOString(),
  };
}

async function writeAudit(
  tx: Prisma.TransactionClient,
  audit: RevenueAuditContext,
  input: {
    actionKey: string;
    targetId: number;
    before: Prisma.InputJsonValue | null;
    after: Prisma.InputJsonValue;
  },
) {
  const actor = await tx.user.findUnique({
    where: { UserId: audit.actorUserId },
    select: { Account: true },
  });
  if (!actor) throw new NotFoundException('Audit actor not found');
  await tx.operationLog.create({
    data: {
      ActorUserId: audit.actorUserId,
      ActorAccountSnapshot: actor.Account,
      ActionKey: input.actionKey,
      ResourceKey: 'revenue',
      TargetType: 'ResortRevenueRecord',
      TargetId: String(input.targetId),
      Result: 'success',
      TraceId: audit.traceId,
      ClientIp: audit.clientIp,
      UserAgent: audit.userAgent,
      Metadata: { before: input.before, after: input.after },
    },
  });
}

export async function writeRevenue(
  tx: Prisma.TransactionClient,
  body: UpsertRevenueInput,
  source: 'manual' | 'import',
  audit: RevenueAuditContext,
) {
  const reportDate = parseDate(body.reportDate);
  // Keep the referenced resort available until revenue and audit commit.
  const resorts = await tx.$queryRaw<{ ResortId: number }[]>`
  SELECT "ResortId" FROM "SkiResort"
  WHERE "ResortId" = ${body.resortId} AND "DeletedAt" IS NULL
  FOR SHARE
`;
  if (resorts.length !== 1)
    throw new UnprocessableEntityException('Unknown resortId');
  const key = {
    ResortId_ReportDate: {
      ResortId: body.resortId,
      ReportDate: reportDate,
    },
  };
  const previous = await tx.resortRevenueRecord.findUnique({
    where: key,
    select: {
      RevenueId: true,
      RevenueAmount: true,
      Source: true,
      Note: true,
      CreatedBy: true,
    },
  });
  const record = await tx.resortRevenueRecord.upsert({
    where: key,
    create: {
      ResortId: body.resortId,
      ReportDate: reportDate,
      RevenueAmount: new Prisma.Decimal(body.revenueAmount),
      Source: source,
      Note: normalizeNote(body.note),
      CreatedBy: audit.actorUserId,
    },
    update: {
      RevenueAmount: new Prisma.Decimal(body.revenueAmount),
      Source: source,
      Note: normalizeNote(body.note),
    },
    include,
  });
  await writeAudit(tx, audit, {
    actionKey: 'revenue:system:upsert',
    targetId: record.RevenueId,
    before: previous
      ? {
          revenueAmount: previous.RevenueAmount.toFixed(2),
          source: previous.Source,
          note: previous.Note,
          createdBy: previous.CreatedBy,
        }
      : null,
    after: {
      resortId: record.ResortId,
      reportDate: formatDate(record.ReportDate),
      revenueAmount: record.RevenueAmount.toFixed(2),
      source: record.Source,
      note: record.Note,
    },
  });
  return toVO(record as RevenueRecord);
}
