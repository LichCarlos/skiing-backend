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

const CONSUMER_KEY = 'rag-dictionary-indexer.v1';

@Injectable()
export class DictionaryRagEventHandler {
  constructor(
    @Inject(RAG_SOURCE_READER) private readonly sources: RagSourceReader,
    @Inject(INBOX_LEASE) private readonly inbox: InboxLease,
    private readonly indexing: RagDocumentIndexingService,
    @Inject(RAG_DOCUMENT_WRITER) private readonly writer: RagDocumentWriter,
  ) {}

  async handle(event: IntegrationEvent): Promise<boolean> {
    if (event.eventType !== 'dictionary.changed.v1') return false;
    const { dictType, itemId } = parseDictionaryIdentity(event.payload);
    const previousValue = parsePreviousValue(event.payload.previousValue);
    const identity = {
      consumerKey: CONSUMER_KEY,
      eventId: event.eventId,
      eventType: event.eventType,
    };
    const claim = await claimRagEvent(this.inbox, identity);
    if (!claim) return false;

    try {
      const { type, item, breadcrumb, sourceState } =
        await this.sources.findDictionary(dictType, itemId);
      if (previousValue && previousValue !== item?.value)
        await this.writer.disable(dictionarySourceKey(dictType, previousValue));

      const sourceKey = item ? dictionarySourceKey(dictType, item.value) : null;
      if (
        !type ||
        type.status !== 'active' ||
        !type.publiclyReadable ||
        !item ||
        item.status !== 'active'
      ) {
        if (sourceKey) await this.writer.disable(sourceKey);
      } else {
        if (!breadcrumb || !sourceState) {
          await this.writer.disable(sourceKey!);
        } else {
          const content = [
            `公开字典：${type.name}`,
            `字典类型：${dictType}`,
            `层级路径：${breadcrumb.map(({ label }) => label).join(' / ')}`,
            `稳定值：${item.value}`,
          ].join('\n');
          await this.indexing.index({
            sourceKey: sourceKey!,
            sourceType: 'dictionary',
            sourceId: item.id,
            title: `${type.name}：${item.label}`,
            content,
            accessScope: 'public',
            merchantId: null,
            sourceUpdatedAt: item.updatedAt,
            sourceState,
          });
        }
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

function parseDictionaryIdentity(payload: Record<string, unknown>) {
  if (
    typeof payload.dictType !== 'string' ||
    payload.dictType.length < 1 ||
    payload.dictType.length > 100 ||
    typeof payload.itemId !== 'number' ||
    !Number.isSafeInteger(payload.itemId) ||
    payload.itemId < 1
  )
    throw new TypeError('Dictionary event identity is invalid');
  return { dictType: payload.dictType, itemId: payload.itemId };
}

function parsePreviousValue(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length > 100)
    throw new TypeError('Dictionary event previousValue is invalid');
  return value;
}

function dictionarySourceKey(dictType: string, value: string) {
  return `dictionary:${dictType}:${value}`;
}
