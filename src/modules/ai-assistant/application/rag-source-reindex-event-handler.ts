import { Inject, Injectable } from '@nestjs/common';
import { claimRagEvent } from './claim-rag-event.js';
import {
  INBOX_LEASE,
  type InboxLease,
} from '../../integration-events/application/ports/inbox-lease.js';
import type { IntegrationEvent } from '../../integration-events/domain/integration-event.js';
import {
  RAG_DOCUMENT_WRITER,
  type RagDocumentWriter,
  type RagIndexDocument,
} from './ports/rag-document-writer.js';
import {
  RAG_SOURCE_READER,
  type RagSourceReader,
} from './ports/rag-source-reader.js';
import { RagDocumentIndexingService } from './rag-document-indexing.service.js';
import {
  isPublicPublishedRagRecord,
  isPublicRagRecord,
} from '../domain/rag-source-eligibility.js';

const EVENT_TYPE = 'rag.source.reindex-requested.v1';
const CONSUMER_KEY = 'rag-source-reindexer.v1';

@Injectable()
export class RagSourceReindexEventHandler {
  constructor(
    @Inject(RAG_SOURCE_READER) private readonly sources: RagSourceReader,
    @Inject(INBOX_LEASE) private readonly inbox: InboxLease,
    @Inject(RAG_DOCUMENT_WRITER) private readonly writer: RagDocumentWriter,
    private readonly indexing: RagDocumentIndexingService,
  ) {}

  async handle(event: IntegrationEvent): Promise<boolean> {
    if (event.eventType !== EVENT_TYPE) return false;
    const request = parseRequest(event.payload);
    const identity = {
      consumerKey: CONSUMER_KEY,
      eventId: event.eventId,
      eventType: event.eventType,
    };
    const claim = await claimRagEvent(this.inbox, identity);
    if (!claim) return false;

    try {
      if (
        await this.writer.isCurrentCommand(
          request.sourceKey,
          request.controlVersion,
        )
      ) {
        const document = await this.readCurrentSource(request);
        if (document) {
          await this.indexing.index(document, undefined, {
            force: true,
            expectedControlVersion: request.controlVersion,
          });
        } else {
          await this.writer.disable(request.sourceKey, request.controlVersion);
        }
      }
      if (!(await this.inbox.complete(identity, claim)))
        throw new Error('RAG reindex Inbox claim was lost before completion');
      return true;
    } catch (error) {
      await this.inbox.release(identity, claim).catch(() => undefined);
      throw error;
    }
  }

  private async readCurrentSource(
    request: ReindexRequest,
  ): Promise<RagIndexDocument | null> {
    const id = request.sourceId;
    if (id === null) return null;
    switch (request.sourceType) {
      case 'resort': {
        const row = await this.sources.findResort(id);
        if (
          !row ||
          !isPublicRagRecord(row) ||
          request.sourceKey !== `resort:${id}`
        )
          return null;
        const location = [row.province, row.city, row.district, row.address]
          .filter(Boolean)
          .join('');
        const content = [
          `雪场名称：${row.name}`,
          location ? `位置：${location}` : null,
          `票价：${row.price} 元起`,
          `营业状态：${row.openStatus}`,
          `雪况：${row.snowCondition}`,
          row.openingHours ? `营业时间：${row.openingHours}` : null,
          row.fitTags.length ? `适合人群：${row.fitTags.join('、')}` : null,
          row.trailSummary ? `雪道信息：${row.trailSummary}` : null,
          row.facilitySummary ? `设施信息：${row.facilitySummary}` : null,
          `简介：${row.description}`,
        ]
          .filter((line): line is string => line !== null)
          .join('\n');
        return publicDocument(
          request,
          row.id,
          row.name,
          content,
          row.updatedAt,
          row.sourceState,
          'resort',
        );
      }
      case 'article': {
        const row = await this.sources.findArticle(id);
        if (
          !row ||
          !isPublicPublishedRagRecord(row) ||
          !row.categoryIsPublic ||
          request.sourceKey !== `article:${id}`
        )
          return null;
        const customFields = row.publicFields
          .map(({ label, value }) => `${label}：${formatValue(value)}`)
          .join('\n');
        const content = [
          `文章标题：${row.title}`,
          row.authorName ? `作者：${row.authorName}` : null,
          `分类：${row.categoryValue}`,
          row.summary ? `摘要：${row.summary}` : null,
          row.body,
          customFields ? `扩展信息：\n${customFields}` : null,
        ]
          .filter((line): line is string => line !== null)
          .join('\n\n');
        return publicDocument(
          request,
          row.id,
          row.title,
          content,
          row.updatedAt,
          row.sourceState,
          'article',
        );
      }
      case 'project_doc': {
        const row = await this.sources.findProjectKnowledge(id);
        if (
          !row ||
          !isPublicPublishedRagRecord(row) ||
          request.sourceKey !== `project:${id}`
        )
          return null;
        const content = [
          `项目知识分类：${row.category}`,
          row.content,
          row.sourceUrl ? `来源：${row.sourceUrl}` : null,
        ]
          .filter((line): line is string => line !== null)
          .join('\n\n');
        return publicDocument(
          request,
          row.id,
          row.title,
          content,
          row.updatedAt,
          row.sourceState,
          'project_doc',
        );
      }
      case 'dynamic': {
        const row = await this.sources.findDynamic(id);
        if (
          !row ||
          !isPublicRagRecord(row) ||
          row.author.status !== 'active' ||
          (row.resort &&
            (row.resort.status !== 'published' || row.resort.deletedAt)) ||
          request.sourceKey !== `dynamic:${id}`
        )
          return null;
        const content = [
          `作者：${row.author.nickname}`,
          row.resort ? `关联雪场：${row.resort.name}` : null,
          `动态内容：${row.content}`,
        ]
          .filter((line): line is string => line !== null)
          .join('\n');
        return publicDocument(
          request,
          row.id,
          `滑雪动态：${row.author.nickname}`,
          content,
          row.updatedAt,
          row.sourceState,
          'dynamic',
        );
      }
      case 'dictionary': {
        const dictType = await this.sources.findDictionaryType(id);
        if (!dictType) return null;
        const { type, item, breadcrumb, sourceState } =
          await this.sources.findDictionary(dictType, id);
        if (
          !type ||
          type.status !== 'active' ||
          !type.publiclyReadable ||
          !item ||
          item.status !== 'active' ||
          !breadcrumb ||
          !sourceState ||
          request.sourceKey !== `dictionary:${dictType}:${item.value}`
        )
          return null;
        const content = [
          `公开字典：${type.name}`,
          `字典类型：${dictType}`,
          `层级路径：${breadcrumb.map(({ label }) => label).join(' / ')}`,
          `稳定值：${item.value}`,
        ].join('\n');
        return publicDocument(
          request,
          item.id,
          `${type.name}：${item.label}`,
          content,
          item.updatedAt,
          sourceState,
          'dictionary',
        );
      }
    }
  }
}

interface ReindexRequest {
  ragDocumentId: number;
  sourceKey: string;
  sourceType: 'resort' | 'article' | 'project_doc' | 'dynamic' | 'dictionary';
  sourceId: number | null;
  controlVersion: number;
}

function parseRequest(payload: Record<string, unknown>): ReindexRequest {
  const sourceTypes = [
    'resort',
    'article',
    'project_doc',
    'dynamic',
    'dictionary',
  ] as const;
  if (
    !isPositiveInt(payload.ragDocumentId) ||
    typeof payload.sourceKey !== 'string' ||
    payload.sourceKey.length < 1 ||
    payload.sourceKey.length > 200 ||
    typeof payload.sourceType !== 'string' ||
    !(sourceTypes as readonly string[]).includes(payload.sourceType) ||
    (payload.sourceId !== null && !isPositiveInt(payload.sourceId)) ||
    !isPositiveInt(payload.controlVersion)
  ) {
    throw new TypeError('RAG source reindex event payload is invalid');
  }
  return {
    ragDocumentId: payload.ragDocumentId,
    sourceKey: payload.sourceKey,
    sourceType: payload.sourceType as ReindexRequest['sourceType'],
    sourceId: payload.sourceId as number | null,
    controlVersion: payload.controlVersion,
  };
}

function publicDocument(
  request: ReindexRequest,
  sourceId: number,
  title: string,
  content: string,
  sourceUpdatedAt: Date,
  sourceState: NonNullable<RagIndexDocument['sourceState']>,
  sourceType: ReindexRequest['sourceType'],
): RagIndexDocument {
  return {
    sourceKey: request.sourceKey,
    sourceType,
    sourceId,
    title,
    content,
    accessScope: 'public',
    merchantId: null,
    sourceUpdatedAt,
    sourceState,
  };
}

function formatValue(value: unknown): string {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  )
    return String(value);
  if (Array.isArray(value)) return value.map(String).join('、');
  return '';
}

function isPositiveInt(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    typeof value === 'number' &&
    value > 0 &&
    value <= 2_147_483_647
  );
}
