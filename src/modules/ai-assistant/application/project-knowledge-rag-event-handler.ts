import { isPublicPublishedRagRecord } from '../domain/rag-source-eligibility.js';
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

const CONSUMER_KEY = 'rag-project-knowledge-indexer.v1';
@Injectable()
export class ProjectKnowledgeRagEventHandler {
  constructor(
    @Inject(RAG_SOURCE_READER) private readonly sources: RagSourceReader,
    @Inject(INBOX_LEASE) private readonly inbox: InboxLease,
    private readonly indexing: RagDocumentIndexingService,
    @Inject(RAG_DOCUMENT_WRITER) private readonly writer: RagDocumentWriter,
  ) {}

  async handle(event: IntegrationEvent): Promise<boolean> {
    if (event.eventType !== 'project_doc.changed.v1') return false;
    const id = event.payload.projectKnowledgeId;
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1)
      throw new TypeError(
        'Project knowledge event must contain a positive integer projectKnowledgeId',
      );
    const identity = {
      consumerKey: CONSUMER_KEY,
      eventId: event.eventId,
      eventType: event.eventType,
    };
    const claim = await claimRagEvent(this.inbox, identity);
    if (!claim) return false;
    try {
      const row = await this.sources.findProjectKnowledge(id);
      const sourceKey = `project:${id}`;
      if (!row || !isPublicPublishedRagRecord(row))
        await this.writer.disable(sourceKey);
      else {
        const content = [
          `项目知识分类：${row.category}`,
          row.content,
          row.sourceUrl ? `来源：${row.sourceUrl}` : null,
        ]
          .filter((line): line is string => line !== null)
          .join('\n\n');
        await this.indexing.index({
          sourceKey,
          sourceType: 'project_doc',
          sourceId: row.id,
          title: row.title,
          content,
          accessScope: 'public',
          merchantId: null,
          sourceUpdatedAt: row.updatedAt,
          sourceState: row.sourceState,
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
