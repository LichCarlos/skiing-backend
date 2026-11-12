import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { parse as parseCsv } from 'csv-parse/sync';
import {
  permitsMerchantResortAccess,
  type MerchantResortAccess,
} from '../domain/resort-management-scope.js';
import {
  REVENUE_REPOSITORY,
  type RevenueRepository,
} from './ports/revenue-repository.js';
import type {
  RevenueAuditContext,
  RevenueListQuery,
  UpsertRevenueInput,
} from './revenue-models.js';
import { RevenueWriteConflictError } from './revenue-errors.js';
export type { RevenueAuditContext } from './revenue-models.js';
@Injectable()
export class RevenueService {
  constructor(
    @Inject(REVENUE_REPOSITORY) private readonly revenue: RevenueRepository,
  ) {}
  async merchantList(access: MerchantResortAccess, query: RevenueListQuery) {
    assertAccess(access);
    const range = parseRange(query);
    const page = query.page ?? 1,
      pageSize = query.pageSize ?? 20;
    const result = await this.revenue.findPage(access, {
      resortId: query.resortId,
      from: range.from,
      to: range.to,
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return {
      ...result,
      page,
      pageSize,
      hasNext: page * pageSize < result.total,
    };
  }
  async adminList(actorUserId: number, query: RevenueListQuery) {
    const { page, pageSize } = query;
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      page > 2147483647 ||
      !Number.isSafeInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100 ||
      (page - 1) * pageSize > 2147483647
    )
      throw new BadRequestException('Invalid pagination');
    let range: ReturnType<typeof parseRange>;
    try {
      range = parseRange(query);
    } catch {
      throw new BadRequestException('Invalid date range');
    }
    const result = await this.revenue.adminPage(actorUserId, {
      resortId: query.resortId,
      from: range.from,
      to: range.to,
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return {
      ...result,
      page,
      pageSize,
      hasNext: page * pageSize < result.total,
    };
  }
  async upsertIdempotent(
    body: UpsertRevenueInput,
    requestId: string | undefined,
    audit: RevenueAuditContext,
  ) {
    const key = validRequestId(requestId);
    validateRevenue(body);
    try {
      return await this.revenue.upsertIdempotent(body, key, audit);
    } catch (error) {
      if (error instanceof RevenueWriteConflictError)
        throw new ConflictException(error.message);
      throw error;
    }
  }
  requestResult(actorUserId: number, requestId: string) {
    return this.revenue.requestResult(actorUserId, validRequestId(requestId));
  }
  async merchantSummary(access: MerchantResortAccess, query: RevenueListQuery) {
    assertAccess(access);
    const range = parseRange(query, true);
    const result = await this.revenue.summarize(access, {
      resortId: query.resortId,
      from: range.from,
      to: range.to,
    });
    return { ...result, fromDate: range.fromDate, toDate: range.toDate };
  }
  async upsert(
    body: UpsertRevenueInput,
    source: 'manual' | 'import',
    audit: RevenueAuditContext,
  ) {
    validateRevenue(body);
    try {
      return await this.revenue.upsert(body, source, audit);
    } catch (error) {
      if (error instanceof RevenueWriteConflictError)
        throw new ConflictException(error.message);
      throw error;
    }
  }
  async importCsv(buffer: Buffer, audit: RevenueAuditContext) {
    if (buffer.byteLength > 10 * 1024 * 1024)
      throw new BadRequestException('CSV cannot exceed 10 MiB');
    let rows: string[][];
    try {
      const csvText = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
      rows = parseCsv(csvText, {
        bom: true,
        skip_empty_lines: true,
        relax_column_count: true,
        max_record_size: 65_536,
      }) as string[][];
    } catch {
      throw new BadRequestException('Invalid CSV syntax or UTF-8 input');
    }
    const expectedHeader = ['resortId', 'reportDate', 'revenueAmount', 'note'];
    if (
      !rows.length ||
      rows[0].length !== expectedHeader.length ||
      rows[0].some((header, index) => header.trim() !== expectedHeader[index])
    )
      throw new BadRequestException(
        'CSV header does not match the required columns',
      );

    const dataRows = rows.slice(1);
    if (dataRows.length > 5_000)
      throw new BadRequestException('CSV cannot exceed 5000 data rows');

    const seen = new Set<string>();
    const results: {
      rowNumber: number;
      success: boolean;
      revenueId: number | null;
      error: string | null;
    }[] = [];
    for (const [index, columns] of dataRows.entries()) {
      const rowNumber = index + 2;
      if (columns.length !== 4) {
        results.push(rowFailure(rowNumber, '列数必须为 4'));
        continue;
      }
      const [resortIdText, reportDate, revenueAmount, note] = columns.map((v) =>
        v.trim(),
      );
      const resortId = Number(resortIdText);
      if (
        !/^[1-9]\d*$/.test(resortIdText) ||
        !Number.isSafeInteger(resortId) ||
        resortId > 2_147_483_647
      ) {
        results.push(rowFailure(rowNumber, 'resortId 格式错误'));
        continue;
      }
      try {
        parseDate(reportDate);
      } catch {
        results.push(rowFailure(rowNumber, 'reportDate 格式错误'));
        continue;
      }
      if (!/^\d{1,10}(\.\d{1,2})?$/.test(revenueAmount)) {
        results.push(rowFailure(rowNumber, 'revenueAmount 格式错误'));
        continue;
      }
      if (note.length > 300) {
        results.push(rowFailure(rowNumber, 'note 不能超过 300 字符'));
        continue;
      }
      const batchKey = `${resortId}:${reportDate}`;
      if (seen.has(batchKey)) {
        results.push(rowFailure(rowNumber, '同一批次包含重复雪场和日期'));
        continue;
      }
      seen.add(batchKey);
      try {
        const record = await this.upsert(
          { resortId, reportDate, revenueAmount, note },
          'import',
          audit,
        );
        results.push({
          rowNumber,
          success: true,
          revenueId: record.revenueId,
          error: null,
        });
      } catch (error) {
        results.push(
          rowFailure(
            rowNumber,
            error instanceof UnprocessableEntityException &&
              error.message === 'Unknown resortId'
              ? '雪场不存在或已停用'
              : '数据保存失败',
          ),
        );
      }
    }
    const succeededRows = results.filter((item) => item.success).length;
    return {
      totalRows: dataRows.length,
      succeededRows,
      failedRows: dataRows.length - succeededRows,
      results,
    };
  }
}

function parseRange(query: RevenueListQuery, applyDefault = false) {
  const fromDate = query.fromDate ? parseDate(query.fromDate) : null;
  const toDate = query.toDate ? parseDate(query.toDate) : null;
  if (fromDate && toDate && fromDate > toDate)
    throw new BadRequestException('fromDate must not exceed toDate');
  const effectiveTo = toDate ?? (applyDefault ? utcToday() : null);
  const effectiveFrom =
    fromDate ??
    (applyDefault && effectiveTo
      ? new Date(effectiveTo.getTime() - 29 * 24 * 60 * 60 * 1000)
      : null);
  if (effectiveFrom && effectiveTo && effectiveFrom > effectiveTo)
    throw new BadRequestException('fromDate must not exceed toDate');
  if (
    effectiveFrom &&
    effectiveTo &&
    (effectiveTo.getTime() - effectiveFrom.getTime()) / 86_400_000 > 366
  )
    throw new BadRequestException('Date range cannot exceed 367 days');
  return {
    fromDate: effectiveFrom ? formatDate(effectiveFrom) : null,
    toDate: effectiveTo ? formatDate(effectiveTo) : null,
    from: effectiveFrom,
    to: effectiveTo,
  };
}

function validateRevenue(body: UpsertRevenueInput) {
  if (
    !Number.isSafeInteger(body.resortId) ||
    body.resortId < 1 ||
    body.resortId > 2_147_483_647
  )
    throw new UnprocessableEntityException('Invalid resortId');
  parseDate(body.reportDate);
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(body.revenueAmount))
    throw new UnprocessableEntityException('Invalid revenueAmount');
  if (
    body.note != null &&
    (typeof body.note !== 'string' || body.note.length > 300)
  )
    throw new UnprocessableEntityException('Invalid note');
}

function parseDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new UnprocessableEntityException('Invalid reportDate');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || formatDate(date) !== value)
    throw new UnprocessableEntityException('Invalid reportDate');
  return date;
}

function utcToday(): Date {
  return new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function rowFailure(rowNumber: number, error: string) {
  return { rowNumber, success: false, revenueId: null, error };
}

function assertAccess(access: MerchantResortAccess) {
  if (!permitsMerchantResortAccess(access))
    throw new ForbiddenException('A valid merchant resort scope is required');
}

export function validRequestId(value: string | undefined): string {
  if (
    !value ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new BadRequestException(
      'A UUID Idempotency-Key/requestId is required',
    );
  return value.toLowerCase();
}
