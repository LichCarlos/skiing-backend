import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  REVENUE_IMPORT_REPOSITORY,
  type RevenueImportRepository,
} from './ports/revenue-import-repository.js';
import type { RevenueAuditContext } from './revenue-models.js';
import { validRequestId } from './revenue-service.js';
import { prepareRevenueCsv } from './prepare-revenue-csv.js';

@Injectable()
export class RevenueImportService {
  constructor(
    @Inject(REVENUE_IMPORT_REPOSITORY)
    private readonly jobs: RevenueImportRepository,
  ) {}
  create(
    buffer: Buffer,
    requestId: string | undefined,
    audit: RevenueAuditContext,
  ) {
    const key = validRequestId(requestId);
    const rows = prepareRevenueCsv(buffer);
    return this.jobs.create(
      key,
      createHash('sha256').update(buffer).digest('hex'),
      rows,
      audit,
    );
  }
  find(actorUserId: number, jobId: string) {
    return this.jobs.find(actorUserId, validRequestId(jobId));
  }
  async run(jobId: string) {
    const claim = await this.jobs.claim(validRequestId(jobId));
    if (!claim) return false;
    try {
      for (let count = 0; count < 25; count++) {
        const result = await this.jobs.processOne(claim);
        if (result !== 'processed') return true;
      }
      await this.jobs.release(claim);
      return true;
    } catch (error) {
      await this.jobs.defer(claim).catch(() => undefined);
      throw error;
    }
  }
  async recover() {
    for (const jobId of await this.jobs.ready(5)) {
      try {
        await this.run(jobId);
      } catch {
        /* Durable backoff is recorded by run(). */
      }
    }
  }
  retain() {
    return this.jobs.retain();
  }
}
