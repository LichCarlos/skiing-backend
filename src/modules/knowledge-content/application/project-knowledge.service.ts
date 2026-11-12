import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  PROJECT_KNOWLEDGE_REPOSITORY,
  type ProjectKnowledgeRepository,
  type ProjectKnowledgeTransaction,
} from './ports/project-knowledge-repository.js';
import {
  canPublishContent,
  canWithdrawContent,
  contentPage,
} from '../domain/content-rules.js';
import {
  validateProjectKnowledge,
  ProjectKnowledgeValidationError,
} from '../domain/project-knowledge-validation.js';
import type {
  ContentListQuery,
  ContentAuditContext,
  ProjectKnowledgeInput,
  ProjectKnowledgeUpdate,
  ProjectKnowledgeRecord,
  ProjectKnowledgeChange,
} from './content-models.js';
export type ProjectKnowledgeAudit = ContentAuditContext;
@Injectable()
export class ProjectKnowledgeService {
  constructor(
    @Inject(PROJECT_KNOWLEDGE_REPOSITORY)
    private readonly knowledge: ProjectKnowledgeRepository,
  ) {}
  async list(query: ContentListQuery) {
    let paging: ReturnType<typeof contentPage>;
    try {
      paging = contentPage(query);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid pagination',
      );
    }
    const { items, total } = await this.knowledge.findPage({
      skip: paging.skip,
      take: paging.pageSize,
      keyword: query.keyword?.trim(),
      status: query.status,
    });
    return {
      items: items.map(toVO),
      page: paging.page,
      pageSize: paging.pageSize,
      total,
      hasNext: paging.skip + items.length < total,
    };
  }
  async get(id: number) {
    assertId(id);
    return toVO(requireRecord(await this.knowledge.find(id)));
  }
  async create(body: ProjectKnowledgeInput, audit: ContentAuditContext) {
    const values = validate(body);
    const record = await this.knowledge.runWrite(async (tx) => {
      await tx.authorize(audit.actorUserId, 'content:project-knowledge:create');
      const created = await tx.create(values);
      await tx.appendChanged(created.projectKnowledgeId, 'draft');
      await tx.audit(audit, created.projectKnowledgeId, {
        actionKey: 'content:project-knowledge:create',
        before: null,
        after: { title: created.title, status: created.status },
      });
      return created;
    });
    return toVO(record);
  }
  async update(
    id: number,
    body: ProjectKnowledgeUpdate,
    audit: ContentAuditContext,
  ) {
    assertId(id);
    if (
      !Number.isSafeInteger(body.version) ||
      body.version < 1 ||
      body.version > 2_147_483_647
    )
      throw new BadRequestException('Invalid version');
    const current = requireRecord(await this.knowledge.find(id));
    if (body.version !== current.version)
      throw new ConflictException('Project knowledge changed concurrently');
    const values = validate(body);
    const record = await this.knowledge.runWrite(async (tx) => {
      await tx.authorize(audit.actorUserId, 'content:project-knowledge:update');
      await updateOrConflict(tx, id, body.version, { values });
      const updated = requireRecord(await tx.find(id));
      await tx.appendChanged(id, updated.status);
      await tx.audit(audit, id, {
        actionKey: 'content:project-knowledge:update',
        before: snapshot(current),
        after: snapshot(updated),
      });
      return updated;
    });
    return toVO(record);
  }
  async publish(id: number, audit: ContentAuditContext) {
    return this.transition(id, 'published', audit);
  }
  async withdraw(id: number, audit: ContentAuditContext) {
    return this.transition(id, 'withdrawn', audit);
  }
  async remove(id: number, audit: ContentAuditContext): Promise<void> {
    await this.transition(id, 'deleted', audit);
  }
  private async transition(
    id: number,
    target: 'published' | 'withdrawn' | 'deleted',
    audit: ContentAuditContext,
  ) {
    assertId(id);
    const actionKey =
      target === 'published'
        ? 'content:project-knowledge:publish'
        : target === 'withdrawn'
          ? 'content:project-knowledge:withdraw'
          : 'content:project-knowledge:delete';
    return this.knowledge.runWrite(async (tx) => {
      await tx.authorize(audit.actorUserId, actionKey);
      const old = requireRecord(await tx.find(id));
      if (target === 'published' && !canPublishContent(old.status))
        throw new ConflictException(
          'Only draft or withdrawn knowledge can be published',
        );
      if (target === 'withdrawn' && !canWithdrawContent(old.status))
        throw new ConflictException(
          'Only published knowledge can be withdrawn',
        );
      if (target === 'published') validate(old);
      const change: ProjectKnowledgeChange =
        target === 'deleted'
          ? { deletedAt: new Date() }
          : {
              status: target,
              ...(target === 'published'
                ? { publishTime: old.publishTime ?? new Date() }
                : {}),
            };
      await updateOrConflict(tx, id, old.version, change);
      const current = requireRecord(await tx.find(id, true));
      await tx.appendChanged(
        id,
        target === 'deleted' ? 'deleted' : current.status,
      );
      await tx.audit(audit, id, {
        actionKey,
        before: snapshot(old),
        after: { ...snapshot(current), deleted: current.deletedAt !== null },
      });
      return target === 'deleted' ? undefined : toVO(current);
    });
  }
}
function validate(input: ProjectKnowledgeInput) {
  try {
    return validateProjectKnowledge(input);
  } catch (error) {
    if (error instanceof ProjectKnowledgeValidationError) {
      if (error.kind === 'unsafe')
        throw new UnprocessableEntityException(error.message);
      throw new BadRequestException(error.message);
    }
    throw error;
  }
}
function requireRecord(
  record: ProjectKnowledgeRecord | null,
): ProjectKnowledgeRecord {
  if (!record) throw new NotFoundException('Project knowledge not found');
  return record;
}
function snapshot(record: ProjectKnowledgeRecord) {
  return {
    title: record.title,
    status: record.status,
    version: record.version,
  };
}
async function updateOrConflict(
  tx: ProjectKnowledgeTransaction,
  id: number,
  version: number,
  change: ProjectKnowledgeChange,
) {
  if (version >= 2_147_483_647)
    throw new ConflictException('Project knowledge version is exhausted');
  if (!(await tx.update(id, version, change)))
    throw new ConflictException('Project knowledge changed concurrently');
}
function assertId(id: number): void {
  if (!Number.isSafeInteger(id) || id < 1 || id > 2_147_483_647)
    throw new BadRequestException('Invalid projectKnowledgeId');
}
function toVO(row: ProjectKnowledgeRecord) {
  return {
    projectKnowledgeId: row.projectKnowledgeId,
    title: row.title,
    content: row.content,
    category: row.category,
    sourceUrl: row.sourceUrl,
    status: row.status,
    publishTime: row.publishTime?.toISOString() ?? null,
    version: row.version,
    createTime: row.createdAt.toISOString(),
    updateTime: row.updatedAt.toISOString(),
  };
}
