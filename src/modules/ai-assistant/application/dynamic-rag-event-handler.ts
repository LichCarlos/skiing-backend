import { isPublicRagRecord } from '../domain/rag-source-eligibility.js';
import { claimRagEvent } from './claim-rag-event.js';
import { Inject, Injectable } from '@nestjs/common';
import {
  RAG_SOURCE_READER,
  type RagSourceReader,
} from './ports/rag-source-reader.js';
import {
  INBOX_LEASE,
  type InboxLease,
} from '../../integration-events/application/ports/inbox-lease.js';
import type { IntegrationEvent } from '../../integration-events/domain/integration-event.js';
import {
  RAG_DOCUMENT_WRITER,
  type RagDocumentWriter,
} from './ports/rag-document-writer.js';
import { RagDocumentIndexingService } from './rag-document-indexing.service.js';

const CONSUMER_KEY = 'rag-dynamic-indexer.v1';

@Injectable()
export class DynamicRagEventHandler {
  constructor(
    @Inject(RAG_SOURCE_READER) private readonly sources: RagSourceReader,
    @Inject(INBOX_LEASE) private readonly inbox: InboxLease,
    private readonly indexing: RagDocumentIndexingService,
    @Inject(RAG_DOCUMENT_WRITER) private readonly writer: RagDocumentWriter,
  ) {}

  async handle(event: IntegrationEvent): Promise<boolean> {
    if (event.eventType !== 'dynamic.changed.v1') return false;
    const dynamicId = parseDynamicId(event.payload.dynamicId);
    const identity = {
      consumerKey: CONSUMER_KEY,
      eventId: event.eventId,
      eventType: event.eventType,
    };
    const claim = await claimRagEvent(this.inbox, identity);
    if (!claim) return false;

    try {
      const dynamic = await this.sources.findDynamic(dynamicId);
      const sourceKey = `dynamic:${dynamicId}`;
      if (
        !dynamic ||
        !isPublicRagRecord(dynamic) ||
        dynamic.author.status !== 'active' ||
        (dynamic.resort &&
          (dynamic.resort.status !== 'published' || dynamic.resort.deletedAt))
      ) {
        await this.writer.disable(sourceKey);
      } else {
        const content = [
          ...(dynamic.publicFields ?? []).map(
            (f) => `${f.label}：${JSON.stringify(f.value)}`,
          ),
          `作者：${dynamic.author.nickname}`,
          dynamic.resort ? `关联雪场：${dynamic.resort.name}` : null,
          `动态内容：${dynamic.content}`,
        ]
          .filter((line): line is string => line !== null)
          .join('\n');
        await this.indexing.index({
          sourceKey,
          sourceType: 'dynamic',
          sourceId: dynamic.id,
          title: `滑雪动态：${dynamic.author.nickname}`,
          content,
          accessScope: 'public',
          merchantId: null,
          sourceUpdatedAt: dynamic.updatedAt,
          sourceState: dynamic.sourceState,
        });
      }
      if (!(await this.inbox.complete(identity, claim)))
        throw new Error('RAG inbox claim was lost before completion');
      return true;
    } catch (error) {
      await this.inbox.release(identity, claim).catch(() => undefined);
      throw error;
    }
  }
}

function parseDynamicId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw new TypeError(
      'Dynamic event must contain a positive integer dynamicId',
    );
  return value;
}
