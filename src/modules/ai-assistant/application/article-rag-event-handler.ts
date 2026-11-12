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

const CONSUMER_KEY = 'rag-article-indexer.v1';

@Injectable()
export class ArticleRagEventHandler {
  constructor(
    @Inject(RAG_SOURCE_READER) private readonly sources: RagSourceReader,
    @Inject(INBOX_LEASE) private readonly inbox: InboxLease,
    private readonly indexing: RagDocumentIndexingService,
    @Inject(RAG_DOCUMENT_WRITER) private readonly writer: RagDocumentWriter,
  ) {}

  async handle(event: IntegrationEvent): Promise<boolean> {
    if (event.eventType !== 'article.changed.v1') return false;
    const articleId = parseArticleId(event.payload.articleId);
    const identity = {
      consumerKey: CONSUMER_KEY,
      eventId: event.eventId,
      eventType: event.eventType,
    };
    const claim = await claimRagEvent(this.inbox, identity);
    if (!claim) return false;

    try {
      const article = await this.sources.findArticle(articleId);
      const sourceKey = `article:${articleId}`;
      if (
        !article ||
        !isPublicPublishedRagRecord(article) ||
        !article.categoryIsPublic
      ) {
        await this.writer.disable(sourceKey);
      } else {
        const customFields = article.publicFields
          .map(({ label, value }) => `${label}：${formatValue(value)}`)
          .join('\n');
        const content = [
          `文章标题：${article.title}`,
          article.authorName ? `作者：${article.authorName}` : null,
          `分类：${article.categoryValue}`,
          article.summary ? `摘要：${article.summary}` : null,
          article.body,
          customFields ? `扩展信息：\n${customFields}` : null,
        ]
          .filter((line): line is string => line !== null)
          .join('\n\n');
        await this.indexing.index({
          sourceKey,
          sourceType: 'article',
          sourceId: article.id,
          title: article.title,
          content,
          accessScope: 'public',
          merchantId: null,
          sourceUpdatedAt: article.updatedAt,
          sourceState: article.sourceState,
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

function parseArticleId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw new TypeError(
      'Article event must contain a positive integer articleId',
    );
  return value;
}

function formatValue(value: unknown): string {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  )
    return String(value);
  if (Array.isArray(value)) return value.map(String).join('、');
  return value !== null && typeof value === 'object'
    ? JSON.stringify(value)
    : '';
}
