import { BadRequestException } from '@nestjs/common';
import { parse as parseCsv } from 'csv-parse/sync';
import type { PreparedRevenueRow } from './ports/revenue-import-repository.js';

export function prepareRevenueCsv(buffer: Buffer): PreparedRevenueRow[] {
  if (buffer.byteLength > 10 * 1024 * 1024)
    throw new BadRequestException('CSV cannot exceed 10 MiB');
  let rows: string[][];
  try {
    rows = parseCsv(new TextDecoder('utf-8', { fatal: true }).decode(buffer), {
      bom: true,
      skip_empty_lines: true,
      relax_column_count: true,
      max_record_size: 65_536,
    }) as string[][];
  } catch {
    throw new BadRequestException('Invalid CSV syntax or UTF-8 input');
  }
  const header = ['resortId', 'reportDate', 'revenueAmount', 'note'];
  if (
    !rows.length ||
    rows[0].length !== 4 ||
    rows[0].some((v, i) => v.trim() !== header[i])
  )
    throw new BadRequestException(
      'CSV header does not match the required columns',
    );
  if (rows.length > 5001)
    throw new BadRequestException('CSV cannot exceed 5000 data rows');
  const seen = new Set<string>();
  return rows.slice(1).map((columns, index) => {
    const fail = (error: string): PreparedRevenueRow => ({
      rowNumber: index + 2,
      input: null,
      error,
    });
    if (columns.length !== 4) return fail('列数必须为 4');
    const [id, reportDate, revenueAmount, note] = columns.map((v) => v.trim());
    const resortId = Number(id);
    if (
      !/^[1-9]\d*$/.test(id) ||
      !Number.isSafeInteger(resortId) ||
      resortId > 2147483647
    )
      return fail('resortId 格式错误');
    const date = new Date(`${reportDate}T00:00:00.000Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(reportDate) ||
      !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== reportDate
    )
      return fail('reportDate 格式错误');
    if (!/^\d{1,10}(\.\d{1,2})?$/.test(revenueAmount))
      return fail('revenueAmount 格式错误');
    if (note.length > 300) return fail('note 不能超过 300 字符');
    const key = `${resortId}:${reportDate}`;
    if (seen.has(key)) return fail('同一批次包含重复雪场和日期');
    seen.add(key);
    return {
      rowNumber: index + 2,
      input: { resortId, reportDate, revenueAmount, note: note || null },
      error: null,
    };
  });
}
