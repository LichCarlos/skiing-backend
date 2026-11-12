import { isPublicRagRecord } from '../domain/rag-source-eligibility.js';
import { claimRagEvent } from './claim-rag-event.js';
import { Inject, Injectable } from '@nestjs/common';
import {
  RAG_DOCUMENT_WRITER,
  type RagDocumentWriter,
} from './ports/rag-document-writer.js';
import { RagDocumentIndexingService } from './rag-document-indexing.service.js';
import {
  RAG_SOURCE_READER,
  type RagSourceReader,
} from './ports/rag-source-reader.js';
import {
  INBOX_LEASE,
  type InboxLease,
} from '../../integration-events/application/ports/inbox-lease.js';
import type { IntegrationEvent } from '../../integration-events/domain/integration-event.js';

const CONSUMER_KEY = 'rag-resort-indexer.v1';

@Injectable()
export class ResortRagEventHandler {
  constructor(
    @Inject(RAG_SOURCE_READER) private readonly sources: RagSourceReader,
    @Inject(INBOX_LEASE) private readonly inbox: InboxLease,
    private readonly indexing: RagDocumentIndexingService,
    @Inject(RAG_DOCUMENT_WRITER) private readonly writer: RagDocumentWriter,
  ) {}

  async handle(event: IntegrationEvent): Promise<boolean> {
    if (event.eventType !== 'resort.changed.v1') return false;
    const resortId = parseResortId(event.payload.resortId);
    const identity = {
      consumerKey: CONSUMER_KEY,
      eventId: event.eventId,
      eventType: event.eventType,
    };
    const claim = await claimRagEvent(this.inbox, identity);
    if (!claim) return false;

    try {
      const resort = await this.sources.findResort(resortId);

      const sourceKey = `resort:${resortId}`;
      if (!resort || !isPublicRagRecord(resort)) {
        await this.writer.disable(sourceKey);
      } else {
        const location = [
          resort.province,
          resort.city,
          resort.district,
          resort.address,
        ]
          .filter(Boolean)
          .join('');
        const content = [
          ...(resort.publicFields ?? []).map(
            (f) => `${f.label}：${JSON.stringify(f.value)}`,
          ),
          `雪场名称：${resort.name}`,
          location ? `位置：${location}` : null,
          `票价：${resort.price} 元起`,
          `营业状态：${resort.openStatus}`,
          `雪况：${resort.snowCondition}`,
          resort.openingHours ? `营业时间：${resort.openingHours}` : null,
          resort.fitTags.length
            ? `适合人群：${resort.fitTags.join('、')}`
            : null,
          resort.trailSummary ? `雪道信息：${resort.trailSummary}` : null,
          resort.facilitySummary ? `设施信息：${resort.facilitySummary}` : null,
          `简介：${resort.description}`,
        ]
          .filter((line): line is string => line !== null)
          .join('\n');

        await this.indexing.index({
          sourceKey,
          sourceType: 'resort',
          sourceId: resort.id,
          title: resort.name,
          content,
          accessScope: 'public',
          merchantId: null,
          sourceUpdatedAt: resort.updatedAt,
          sourceState: resort.sourceState,
        });
      }

      if (!(await this.inbox.complete(identity, claim))) {
        throw new Error('RAG inbox claim was lost before completion');
      }
      return true;
    } catch (error) {
      await this.inbox.release(identity, claim).catch(() => undefined);
      throw error;
    }
  }
}

function parseResortId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(
      'Resort event must contain a positive integer resortId',
    );
  }
  return value;
}
