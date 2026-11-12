import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, type RevenueImportJob } from '@prisma/client';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';
import { appendOutboxEvent } from '../../integration-events/infrastructure/append-outbox-event.js';
import { authorizeWrite, writeRevenue } from './prisma-revenue.repository.js';
import type {
  ImportClaim,
  PreparedRevenueRow,
  RevenueImportJobView,
  RevenueImportRepository,
} from '../application/ports/revenue-import-repository.js';
import type {
  RevenueAuditContext,
  UpsertRevenueInput,
} from '../application/revenue-models.js';

const LEASE_MS = 60_000;
@Injectable()
export class PrismaRevenueImportRepository implements RevenueImportRepository {
  constructor(private readonly prisma: PrismaService) {}
  async create(
    requestId: string,
    fileHash: string,
    rows: PreparedRevenueRow[],
    audit: RevenueAuditContext,
  ) {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await authorizeWrite(tx, audit.actorUserId);
          const key = {
            ActorUserId_RequestId: {
              ActorUserId: audit.actorUserId,
              RequestId: requestId,
            },
          };
          const old = await tx.revenueImportJob.findUnique({ where: key });
          if (old) {
            if (
              (old.ResultExpiresAt && old.ResultExpiresAt <= new Date()) ||
              old.ResultsPurgedAt
            )
              throw conflict('REVENUE_IMPORT_EXPIRED');
            if (old.FileHash !== fileHash)
              throw conflict('REVENUE_IMPORT_MISMATCH');
            return view(tx, old);
          }
          const [active, own, recent] = await Promise.all([
            tx.revenueImportJob.count({
              where: { Status: { in: ['pending', 'processing'] } },
            }),
            tx.revenueImportJob.count({
              where: {
                ActorUserId: audit.actorUserId,
                Status: { in: ['pending', 'processing'] },
              },
            }),
            tx.revenueImportJob.count({
              where: {
                ActorUserId: audit.actorUserId,
                CreateTime: { gte: new Date(Date.now() - 60_000) },
              },
            }),
          ]);
          if (active >= 200 || own >= 20 || recent >= 5)
            throw new HttpException(
              'Revenue import capacity exceeded; retain the original key',
              429,
            );
          const failed = rows.filter((row) => row.error !== null).length;
          const job = await tx.revenueImportJob.create({
            data: {
              ActorUserId: audit.actorUserId,
              RequestId: requestId,
              FileHash: fileHash,
              TotalRows: rows.length,
              ProcessedRows: failed,
              FailedRows: failed,
              TraceId: audit.traceId,
              ClientIp: audit.clientIp,
              UserAgent: audit.userAgent,
            },
          });
          if (rows.length)
            await tx.revenueImportRow.createMany({
              data: rows.map((row) => ({
                JobId: job.JobId,
                RowNumber: row.rowNumber,
                Input: row.input ? { ...row.input } : Prisma.DbNull,
                Status: row.error ? 'failed' : 'pending',
                Error: row.error,
              })),
            });
          await appendOutboxEvent(tx, {
            eventType: 'revenue.import.requested.v1',
            aggregateType: 'revenue_import',
            aggregateId: job.JobId,
            payload: { jobId: job.JobId },
          });
          const actor = await tx.user.findUniqueOrThrow({
            where: { UserId: audit.actorUserId },
            select: { Account: true },
          });
          await tx.operationLog.create({
            data: {
              ActorUserId: audit.actorUserId,
              ActorAccountSnapshot: actor.Account,
              ActionKey: 'revenue:system:import',
              ResourceKey: 'revenue',
              TargetType: 'RevenueImportJob',
              TargetId: job.JobId,
              Result: 'success',
              TraceId: audit.traceId,
              ClientIp: audit.clientIp,
              UserAgent: audit.userAgent,
              Metadata: { totalRows: rows.length },
            },
          });
          return view(tx, job);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (!isConcurrency(error)) throw error;
      const committed = await this.prisma.$transaction(
        async (tx) => {
          await authorizeWrite(tx, audit.actorUserId);
          const old = await tx.revenueImportJob.findUnique({
            where: {
              ActorUserId_RequestId: {
                ActorUserId: audit.actorUserId,
                RequestId: requestId,
              },
            },
          });
          if (!old) return null;
          if (
            (old.ResultExpiresAt && old.ResultExpiresAt <= new Date()) ||
            old.ResultsPurgedAt
          )
            throw conflict('REVENUE_IMPORT_EXPIRED');
          if (old.FileHash !== fileHash)
            throw conflict('REVENUE_IMPORT_MISMATCH');
          return view(tx, old);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
      if (committed) return committed;
      throw conflict('REVENUE_IMPORT_IN_PROGRESS');
    }
  }
  async find(actorUserId: number, jobId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        await authorizeWrite(tx, actorUserId);
        const job = await tx.revenueImportJob.findFirst({
          where: { JobId: jobId, ActorUserId: actorUserId },
        });
        if (!job) throw new NotFoundException('Revenue import not found');
        if (
          job.ResultsPurgedAt ||
          (job.ResultExpiresAt && job.ResultExpiresAt <= new Date())
        )
          throw new GoneException('Revenue import result expired');
        return view(tx, job);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async claim(jobId: string) {
    const lockToken = randomUUID();
    const rows = await this.prisma.$queryRaw<{ JobId: string }[]>`
      UPDATE "RevenueImportJob" SET "Status"='processing', "LockToken"=${lockToken}::uuid,
        "LeaseUntil"=NOW()+(${LEASE_MS} * INTERVAL '1 millisecond'), "UpdateTime"=NOW()
      WHERE "JobId"=${jobId}::uuid AND "FailureAttempts" < 8 AND (
        ("Status"='pending' AND "NextAttemptAt"<=NOW()) OR ("Status"='processing' AND "LeaseUntil"<=NOW())
      ) RETURNING "JobId"
    `;
    return rows.length ? { jobId, lockToken } : null;
  }
  async processOne(
    claim: ImportClaim,
  ): Promise<'processed' | 'completed' | 'lost'> {
    let rowNumber: number | undefined;
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const job = await lockedJob(tx, claim);
          if (!job) return 'lost';
          const row = await tx.revenueImportRow.findFirst({
            where: { JobId: claim.jobId, Status: 'pending' },
            orderBy: { RowNumber: 'asc' },
          });
          if (!row) {
            await finish(tx, job, 'completed');
            return 'completed';
          }
          rowNumber = row.RowNumber;
          await authorizeWrite(tx, job.ActorUserId);
          const input = row.Input as unknown as UpsertRevenueInput;
          const record = await writeRevenue(tx, input, 'import', {
            actorUserId: job.ActorUserId,
            traceId: job.TraceId,
            clientIp: job.ClientIp,
            userAgent: job.UserAgent,
          });
          await tx.revenueImportRow.update({
            where: {
              JobId_RowNumber: { JobId: claim.jobId, RowNumber: row.RowNumber },
            },
            data: { Status: 'succeeded', RevenueId: record.revenueId },
          });
          await tx.revenueImportJob.update({
            where: { JobId: claim.jobId },
            data: {
              ProcessedRows: { increment: 1 },
              SucceededRows: { increment: 1 },
              LeaseUntil: new Date(Date.now() + LEASE_MS),
            },
          });
          return 'processed';
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      // Failed SQL transactions are rolled back before recording a business rejection.
      if (
        error instanceof ForbiddenException ||
        error instanceof UnprocessableEntityException
      ) {
        return this.prisma.$transaction(async (tx) => {
          const job = await lockedJob(tx, claim);
          if (!job) return 'lost';
          if (error instanceof ForbiddenException) {
            await failPending(tx, job, '当前账号无有效导入权限，该行未提交');
            await finish(tx, job, 'completed');
            return 'completed';
          }
          if (!rowNumber) throw error;
          const result = await tx.revenueImportRow.updateMany({
            where: {
              JobId: claim.jobId,
              RowNumber: rowNumber,
              Status: 'pending',
            },
            data: { Status: 'failed', Error: '雪场不存在或已停用' },
          });
          if (result.count)
            await tx.revenueImportJob.update({
              where: { JobId: claim.jobId },
              data: {
                ProcessedRows: { increment: 1 },
                FailedRows: { increment: 1 },
                LeaseUntil: new Date(Date.now() + LEASE_MS),
              },
            });
          return 'processed';
        });
      }
      throw error;
    }
  }
  async release(claim: ImportClaim) {
    await this.prisma.revenueImportJob.updateMany({
      where: {
        JobId: claim.jobId,
        Status: 'processing',
        LockToken: claim.lockToken,
      },
      data: {
        Status: 'pending',
        LockToken: null,
        LeaseUntil: null,
        NextAttemptAt: new Date(),
      },
    });
  }
  async defer(claim: ImportClaim) {
    await this.prisma.$transaction(async (tx) => {
      const job = await lockedJob(tx, claim);
      if (!job) return;
      const attempts = job.FailureAttempts + 1;
      await tx.revenueImportJob.update({
        where: { JobId: claim.jobId },
        data: { FailureAttempts: attempts },
      });
      if (attempts >= 8) {
        await failPending(tx, job, '任务处理失败，该行未提交');
        await finish(tx, job, 'failed');
      } else {
        await tx.revenueImportJob.update({
          where: { JobId: claim.jobId },
          data: {
            Status: 'pending',
            LockToken: null,
            LeaseUntil: null,
            NextAttemptAt: new Date(
              Date.now() + Math.min(1000 * 2 ** (attempts - 1), 60000),
            ),
          },
        });
      }
    });
  }
  async ready(limit: number) {
    const jobs = await this.prisma.revenueImportJob.findMany({
      where: {
        OR: [
          { Status: 'pending', NextAttemptAt: { lte: new Date() } },
          { Status: 'processing', LeaseUntil: { lte: new Date() } },
        ],
      },
      orderBy: [{ CreateTime: 'asc' }, { JobId: 'asc' }],
      take: limit,
      select: { JobId: true },
    });
    return jobs.map((job) => job.JobId);
  }
  async retain() {
    const now = new Date();
    const jobs = await this.prisma.revenueImportJob.findMany({
      where: {
        OR: [
          { InputExpiresAt: { lte: now }, InputsPurgedAt: null },
          { ResultExpiresAt: { lte: now }, ResultsPurgedAt: null },
        ],
      },
      take: 10,
      orderBy: { TerminalAt: 'asc' },
      select: { JobId: true },
    });
    for (const { JobId } of jobs)
      await this.prisma.$transaction(async (tx) => {
        const [job] = await tx.$queryRaw<
          RevenueImportJob[]
        >`SELECT * FROM "RevenueImportJob" WHERE "JobId"=${JobId}::uuid FOR UPDATE`;
        if (!job?.TerminalAt) return;
        if (job.ResultExpiresAt! <= now && !job.ResultsPurgedAt) {
          await tx.revenueImportRow.deleteMany({ where: { JobId } });
          await tx.revenueImportJob.update({
            where: { JobId },
            data: {
              TotalRows: 0,
              ProcessedRows: 0,
              SucceededRows: 0,
              FailedRows: 0,
              ClientIp: null,
              UserAgent: null,
              InputsPurgedAt: now,
              ResultsPurgedAt: now,
            },
          });
        } else if (job.InputExpiresAt! <= now && !job.InputsPurgedAt) {
          await tx.revenueImportRow.updateMany({
            where: { JobId },
            data: { Input: Prisma.DbNull },
          });
          await tx.revenueImportJob.update({
            where: { JobId },
            data: { ClientIp: null, UserAgent: null, InputsPurgedAt: now },
          });
        }
      });
  }
}
async function lockedJob(tx: Prisma.TransactionClient, claim: ImportClaim) {
  const [job] = await tx.$queryRaw<
    RevenueImportJob[]
  >`SELECT * FROM "RevenueImportJob" WHERE "JobId"=${claim.jobId}::uuid AND "Status"='processing' AND "LockToken"=${claim.lockToken}::uuid AND "LeaseUntil">NOW() FOR UPDATE`;
  return job;
}
async function failPending(
  tx: Prisma.TransactionClient,
  job: RevenueImportJob,
  error: string,
) {
  const result = await tx.revenueImportRow.updateMany({
    where: { JobId: job.JobId, Status: 'pending' },
    data: { Status: 'failed', Error: error },
  });
  await tx.revenueImportJob.update({
    where: { JobId: job.JobId },
    data: {
      ProcessedRows: { increment: result.count },
      FailedRows: { increment: result.count },
    },
  });
}
async function finish(
  tx: Prisma.TransactionClient,
  job: RevenueImportJob,
  status: 'completed' | 'failed',
) {
  const now = new Date();
  await tx.revenueImportJob.update({
    where: { JobId: job.JobId },
    data: {
      Status: status,
      LockToken: null,
      LeaseUntil: null,
      TerminalAt: now,
      InputExpiresAt: new Date(now.getTime() + 7 * 86400000),
      ResultExpiresAt: new Date(now.getTime() + 30 * 86400000),
    },
  });
}
async function view(
  tx: Prisma.TransactionClient,
  job: RevenueImportJob,
): Promise<RevenueImportJobView> {
  const terminal = job.Status === 'completed' || job.Status === 'failed';
  const rows = terminal
    ? await tx.revenueImportRow.findMany({
        where: { JobId: job.JobId },
        orderBy: { RowNumber: 'asc' },
        select: { RowNumber: true, Status: true, RevenueId: true, Error: true },
      })
    : [];
  return {
    jobId: job.JobId,
    status: job.Status as RevenueImportJobView['status'],
    createdAt: job.CreateTime.toISOString(),
    updatedAt: job.UpdateTime.toISOString(),
    totalRows: job.TotalRows,
    processedRows: job.ProcessedRows,
    succeededRows: job.SucceededRows,
    failedRows: job.FailedRows,
    result: terminal
      ? {
          totalRows: job.TotalRows,
          succeededRows: job.SucceededRows,
          failedRows: job.FailedRows,
          results: rows.map((row) => ({
            rowNumber: row.RowNumber,
            success: row.Status === 'succeeded',
            revenueId: row.RevenueId,
            error: row.Error,
          })),
        }
      : null,
  };
}
function conflict(code: string) {
  return new ConflictException({ details: [{ code, message: code }] });
}
function isConcurrency(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (['P2002', 'P2034'].includes(error.code) ||
      (error.code === 'P2010' &&
        ['40001', '40P01'].includes(String(error.meta?.code))))
  );
}
