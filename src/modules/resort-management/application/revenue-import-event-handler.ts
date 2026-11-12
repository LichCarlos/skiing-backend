import { Inject, Injectable } from '@nestjs/common';
import {
  INBOX_LEASE,
  type InboxLease,
} from '../../integration-events/application/ports/inbox-lease.js';
import type { IntegrationEvent } from '../../integration-events/domain/integration-event.js';
import { RevenueImportService } from './revenue-import.service.js';
import { validRequestId } from './revenue-service.js';

@Injectable()
export class RevenueImportEventHandler {
  constructor(
    @Inject(INBOX_LEASE) private readonly inbox: InboxLease,
    private readonly imports: RevenueImportService,
  ) {}
  async handle(event: IntegrationEvent) {
    if (event.eventType !== 'revenue.import.requested.v1') return false;
    if (
      typeof event.payload.jobId !== 'string' ||
      Object.keys(event.payload).length !== 1
    )
      throw new TypeError('Revenue import event requires only jobId');
    const jobId = validRequestId(event.payload.jobId);
    if (event.aggregateType !== 'revenue_import' || event.aggregateId !== jobId)
      throw new TypeError('Revenue import aggregate mismatch');
    const identity = {
      consumerKey: 'revenue-import.v1',
      eventId: event.eventId,
      eventType: event.eventType,
    };
    const claim = await this.inbox.claim(identity, 60_000);
    if (!claim) {
      if (await this.inbox.isProcessed(identity)) return false;
      throw new Error('Revenue import Inbox is busy');
    }
    try {
      // The event wakes a bounded slice; durable jobs remain discoverable by recovery.
      await this.imports.run(jobId);
      if (!(await this.inbox.complete(identity, claim)))
        throw new Error('Revenue import Inbox claim lost');
      return true;
    } catch (error) {
      await this.inbox.release(identity, claim).catch(() => undefined);
      throw error;
    }
  }
}
