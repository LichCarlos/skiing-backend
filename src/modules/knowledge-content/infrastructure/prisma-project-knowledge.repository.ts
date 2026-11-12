import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type ProjectKnowledge } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';
import {
  OUTBOX_STORE,
  type OutboxStore,
  type TransactionContext,
} from '../../integration-events/application/ports/outbox-store.js';
import type {
  ProjectKnowledgeRepository,
  ProjectKnowledgeTransaction,
} from '../application/ports/project-knowledge-repository.js';
import type {
  ProjectKnowledgeValues,
  ProjectKnowledgeRecord,
  ProjectKnowledgeChange,
  ContentPageQuery,
  ContentAuditContext,
  ContentAuditChange,
} from '../application/content-models.js';
import {
  serializableContentWrite,
  auditContent,
} from './content-persistence.js';
import { authorizeProjectKnowledgeWrite } from './project-knowledge-authorization.js';

@Injectable()
export class PrismaProjectKnowledgeRepository implements ProjectKnowledgeRepository {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(OUTBOX_STORE) private readonly outbox: OutboxStore,
  ) {}
  async find(id: number) {
    const row = await this.prisma.projectKnowledge.findFirst({
      where: { ProjectKnowledgeId: id, DeletedAt: null },
    });
    return row ? toRecord(row) : null;
  }
  async findPage(query: ContentPageQuery) {
    const where: Prisma.ProjectKnowledgeWhereInput = {
      DeletedAt: null,
      ...(query.status ? { Status: query.status } : {}),
      ...(query.keyword
        ? {
            OR: [
              { Title: { contains: query.keyword, mode: 'insensitive' } },
              { Content: { contains: query.keyword, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction(
      [
        this.prisma.projectKnowledge.findMany({
          where,
          skip: query.skip,
          take: query.take,
          orderBy: [{ UpdateTime: 'desc' }, { ProjectKnowledgeId: 'desc' }],
        }),
        this.prisma.projectKnowledge.count({ where }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return { items: items.map(toRecord), total };
  }
  runWrite<T>(
    work: (tx: ProjectKnowledgeTransaction) => Promise<T>,
  ): Promise<T> {
    return serializableContentWrite(this.prisma, (tx) =>
      work(new PrismaProjectKnowledgeTransaction(tx, this.outbox)),
    );
  }
}
class PrismaProjectKnowledgeTransaction implements ProjectKnowledgeTransaction {
  constructor(
    private readonly tx: Prisma.TransactionClient,
    private readonly outbox: OutboxStore,
  ) {}
  authorize(actorUserId: number, permission: string) {
    return authorizeProjectKnowledgeWrite(this.tx, actorUserId, permission);
  }
  async find(id: number, includeDeleted = false) {
    const row = await this.tx.projectKnowledge.findFirst({
      where: {
        ProjectKnowledgeId: id,
        ...(includeDeleted ? {} : { DeletedAt: null }),
      },
    });
    return row ? toRecord(row) : null;
  }
  async create(values: ProjectKnowledgeValues) {
    return toRecord(
      await this.tx.projectKnowledge.create({
        data: { ...toData(values), Status: 'draft' },
      }),
    );
  }
  async update(id: number, version: number, change: ProjectKnowledgeChange) {
    const result = await this.tx.projectKnowledge.updateMany({
      where: { ProjectKnowledgeId: id, DeletedAt: null, Version: version },
      data: {
        ...(change.values ? toData(change.values) : {}),
        ...(change.status ? { Status: change.status } : {}),
        ...(change.publishTime ? { PublishTime: change.publishTime } : {}),
        ...(change.deletedAt ? { DeletedAt: change.deletedAt } : {}),
        Version: { increment: 1 },
      },
    });
    return result.count === 1;
  }
  appendChanged(id: number, status: string) {
    return this.outbox.append(this.tx as unknown as TransactionContext, {
      eventId: randomUUID(),
      eventType: 'project_doc.changed.v1',
      aggregateType: 'project_doc',
      aggregateId: String(id),
      occurredAt: new Date(),
      payload: { projectKnowledgeId: id, status },
    });
  }
  audit(context: ContentAuditContext, id: number, change: ContentAuditChange) {
    return auditContent(
      this.tx,
      context,
      id,
      'content:project-knowledge',
      'ProjectKnowledge',
      change,
    );
  }
}
function toData(values: ProjectKnowledgeValues) {
  return {
    Title: values.title,
    Content: values.content,
    Category: values.category,
    SourceUrl: values.sourceUrl,
  };
}
function toRecord(row: ProjectKnowledge): ProjectKnowledgeRecord {
  return {
    projectKnowledgeId: row.ProjectKnowledgeId,
    title: row.Title,
    content: row.Content,
    category: row.Category,
    sourceUrl: row.SourceUrl,
    status: row.Status as ProjectKnowledgeRecord['status'],
    publishTime: row.PublishTime,
    version: row.Version,
    createdAt: row.CreateTime,
    updatedAt: row.UpdateTime,
    deletedAt: row.DeletedAt,
  };
}
