import {
  ARTICLE_CONTENT_PARSER,
  unavailableContentParser,
  type ArticleContentParser,
} from './ports/content-parser.js';
import type { ResolvedDataScope } from '../../identity-access/domain/authorization.js';
import {
  resolveArticleAccess,
  mayCreateArticle,
  articleActorMatches,
  type ArticleAccess,
} from '../domain/article-scope.js';
import {
  BadRequestException,
  ForbiddenException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  ASSET_STORAGE,
  type AssetStorage,
} from '../../assets/application/ports/asset-storage.js';
import {
  validateCustomFieldWrite,
  filterReadableCustomFields,
} from '../../platform-administration/domain/custom-field-validation.js';
import {
  canPublishContent,
  canWithdrawContent,
  contentPage,
} from '../domain/content-rules.js';
import {
  ARTICLE_REPOSITORY,
  type ArticleRepository,
  type ArticleTransaction,
  type ArticleFieldContext,
} from './ports/article-repository.js';
import type {
  ArticleRecord,
  ArticleInput,
  ArticleValues,
  ArticleChange,
  ContentListQuery,
  ContentAuditContext,
} from './content-models.js';
export type AdminArticleAuditContext = ContentAuditContext;
@Injectable()
export class AdminArticleService {
  constructor(
    @Inject(ARTICLE_REPOSITORY) private readonly articles: ArticleRepository,
    @Inject(ASSET_STORAGE) private readonly storage: AssetStorage,
    @Inject(ARTICLE_CONTENT_PARSER)
    private readonly contentParser: ArticleContentParser = unavailableContentParser,
  ) {}
  async list(
    query: ContentListQuery,
    scope: ResolvedDataScope | undefined,
    actorUserId: number,
  ) {
    const access = requireAccess(scope, actorUserId);
    const paging = parsePage(query);
    const { items, total } = await this.articles.runRead(
      access,
      actorUserId,
      async (tx) => {
        const page = await tx.findPage({
          skip: paging.skip,
          take: paging.pageSize,
          keyword: query.keyword?.trim(),
          status: query.status,
        });
        return {
          ...page,
          items: page.items.map((item) => readable(item, tx.fields)),
        };
      },
    );
    return {
      items: await Promise.all(items.map((item) => this.toVO(item))),
      page: paging.page,
      pageSize: paging.pageSize,
      total,
      hasNext: paging.skip + items.length < total,
    };
  }
  async get(
    id: number,
    scope: ResolvedDataScope | undefined,
    actorUserId: number,
  ) {
    const access = requireAccess(scope, actorUserId);
    assertArticleId(id);
    const record = await this.articles.runRead(
      access,
      actorUserId,
      async (tx) => readable(requireArticle(await tx.find(id)), tx.fields),
    );
    return this.toVO(record);
  }
  async customFieldSchema(
    scope: ResolvedDataScope | undefined,
    actorUserId: number,
  ) {
    const access = requireAccess(scope, actorUserId);
    return this.articles.runRead(access, actorUserId, async (tx) => ({
      entityType: 'article' as const,
      groups: tx.fields.groups
        .map((group) => ({
          groupKey: group.groupKey,
          label: group.label,
          sortOrder: group.sortOrder,
          fields: group.fields.flatMap((field) => {
            const policy = tx.fields.policies.get(field.fieldKey);
            return policy?.canRead || policy?.canWrite
              ? [{ ...field, ...policy }]
              : [];
          }),
        }))
        .filter((group) => group.fields.length > 0),
    }));
  }
  async create(
    body: ArticleInput,
    audit: ContentAuditContext,
    scope: ResolvedDataScope | undefined,
  ) {
    const access = requireAccess(scope, audit.actorUserId);
    if (!mayCreateArticle(access))
      throw new ForbiddenException('Selected scope cannot create articles');
    const record = await this.articles.runWrite(
      access,
      audit.actorUserId,
      async (tx) => {
        const values = this.validateWrite(body, {}, tx.fields);
        await tx.assertReferences(values);
        const created = await tx.create(values, audit.actorUserId);
        await tx.appendChanged(created.articleId, 'draft');
        await tx.audit(audit, created.articleId, {
          actionKey: 'content:article:create',
          before: null,
          after: { title: values.title, status: 'draft' },
        });
        return readable(created, tx.fields);
      },
    );
    return this.toVO(record);
  }
  async update(
    id: number,
    body: ArticleInput,
    audit: ContentAuditContext,
    scope: ResolvedDataScope | undefined,
  ) {
    const access = requireAccess(scope, audit.actorUserId);
    assertArticleId(id);
    const record = await this.articles.runWrite(
      access,
      audit.actorUserId,
      async (tx) => {
        const existing = requireArticle(await tx.find(id));
        if (
          body.expectedVersion !== undefined &&
          body.expectedVersion !== existing.version
        )
          throw new ConflictException('Article changed concurrently');
        if (
          (body.contentFormat === 'markdown_v1' ||
            existing.contentFormat === 'markdown_v1') &&
          (body.expectedVersion === undefined ||
            body.contentFormat === undefined)
        )
          throw new ConflictException(
            'Markdown update requires explicit format and expectedVersion',
          );
        if (
          existing.contentFormat === 'markdown_v1' &&
          body.contentFormat !== 'markdown_v1'
        )
          throw new UnprocessableEntityException(
            'Markdown cannot be silently downgraded to plain text',
          );
        const values = this.validateWrite(
          body,
          existing.customFields,
          tx.fields,
        );
        await tx.assertReferences(values, id);
        await updateOrConflict(tx, id, existing.version, { values });
        await tx.appendChanged(id, existing.status);
        await tx.audit(audit, id, {
          actionKey: 'content:article:update',
          before: snapshot(existing),
          after: {
            title: values.title,
            status: existing.status,
            version: existing.version + 1,
          },
        });
        return readable(requireArticle(await tx.find(id)), tx.fields);
      },
    );
    return this.toVO(record);
  }
  async remove(
    id: number,
    audit: ContentAuditContext,
    scope: ResolvedDataScope | undefined,
  ): Promise<void> {
    const access = requireAccess(scope, audit.actorUserId);
    assertArticleId(id);
    await this.articles.runWrite(access, audit.actorUserId, async (tx) => {
      const existing = requireArticle(await tx.find(id));
      await updateOrConflict(tx, id, existing.version, {
        deletedAt: new Date(),
      });
      await tx.appendChanged(id, 'deleted');
      await tx.audit(audit, id, {
        actionKey: 'content:article:delete',
        before: snapshot(existing),
        after: { deleted: true },
      });
    });
  }
  async publish(
    id: number,
    audit: ContentAuditContext,
    scope: ResolvedDataScope | undefined,
  ) {
    return this.transition(
      id,
      'published',
      audit,
      requireAccess(scope, audit.actorUserId),
    );
  }
  async withdraw(
    id: number,
    audit: ContentAuditContext,
    scope: ResolvedDataScope | undefined,
  ) {
    return this.transition(
      id,
      'withdrawn',
      audit,
      requireAccess(scope, audit.actorUserId),
    );
  }
  private async transition(
    id: number,
    status: 'published' | 'withdrawn',
    audit: ContentAuditContext,
    access: ArticleAccess,
  ) {
    assertArticleId(id);
    const record = await this.articles.runWrite(
      access,
      audit.actorUserId,
      async (tx) => {
        const existing = requireArticle(await tx.find(id));
        if (
          status === 'published'
            ? !canPublishContent(existing.status)
            : !canWithdrawContent(existing.status)
        )
          throw new ConflictException(
            status === 'published'
              ? 'Only draft or withdrawn articles can be published'
              : 'Only published articles can be withdrawn',
          );
        if (status === 'published' && existing.contentFormat === 'markdown_v1')
          await tx.assertReferences({ ...existing, customFields: {} }, id);
        await updateOrConflict(tx, id, existing.version, {
          status,
          ...(status === 'published'
            ? { publishTime: existing.publishTime ?? new Date() }
            : {}),
        });
        await tx.appendChanged(id, status);
        const changed = requireArticle(await tx.find(id));
        await tx.audit(audit, id, {
          actionKey:
            status === 'published'
              ? 'content:article:publish'
              : 'content:article:withdraw',
          before: snapshot(existing),
          after: snapshot(changed),
        });
        return readable(changed, tx.fields);
      },
    );
    return this.toVO(record);
  }
  private validateWrite(
    body: ArticleInput,
    existingFields: unknown,
    context: ArticleFieldContext,
  ): ArticleValues {
    const title = requiredText(body.title, 'title', 200);
    const summary = requiredText(body.summary, 'summary', 1000);
    const content = requiredText(body.body, 'body', 100000);
    const contentFormat = body.contentFormat ?? 'plain_text';
    if (!['plain_text', 'markdown_v1'].includes(contentFormat))
      throw new UnprocessableEntityException('Unsupported article format');
    if (
      body.expectedVersion !== undefined &&
      (!Number.isInteger(body.expectedVersion) ||
        body.expectedVersion < 1 ||
        body.expectedVersion > 2147483647)
    )
      throw new UnprocessableEntityException('Invalid expectedVersion');
    if (contentFormat === 'markdown_v1') {
      try {
        this.contentParser.parse(content);
      } catch (error) {
        throw new UnprocessableEntityException(
          error instanceof Error ? error.message : 'Invalid Markdown',
        );
      }
    }
    const categoryValue = requiredText(
      body.categoryValue,
      'categoryValue',
      100,
    );
    let coverAssetId: string | null = null;
    if (body.coverAssetId !== undefined && body.coverAssetId !== null) {
      if (
        typeof body.coverAssetId !== 'string' ||
        !/^[1-9]\d{0,18}$/.test(body.coverAssetId) ||
        BigInt(body.coverAssetId) > 9_223_372_036_854_775_807n
      )
        throw new UnprocessableEntityException('Invalid coverAssetId');
      coverAssetId = body.coverAssetId;
    }
    const { definitions, policies, dictionaryValues } = context;
    const fields = validateCustomFieldWrite({
      definitions,
      policies,
      dictionaryValues,
      existingValues: isRecord(existingFields) ? existingFields : {},
      submittedValues: body.customFields === undefined ? {} : body.customFields,
    });
    if (!fields.ok)
      throw new UnprocessableEntityException({
        message: 'Invalid custom fields',
        details: fields.issues,
      });
    return {
      title: title,
      summary: summary,
      body: content,
      contentFormat,
      coverAssetId: coverAssetId,
      categoryValue: categoryValue,
      customFields: fields.values,
      schemaVersion: Math.max(
        1,
        ...definitions.map((field) => field.schemaVersion),
      ),
    };
  }

  private async toVO(article: ArticleRecord) {
    return {
      articleId: article.articleId,
      title: article.title,
      summary: article.summary,
      body: article.body,
      contentFormat: article.contentFormat ?? 'plain_text',
      bodyAssets: await Promise.all(
        (article.bodyAssets ?? []).map(async (asset) => ({
          assetId: asset.assetId,
          url: await this.storage.createReadUrl(asset.storageKey, 900),
        })),
      ),
      coverAssetId: article.coverAssetId,
      coverUrl: article.coverStorageKey
        ? await this.storage.createReadUrl(article.coverStorageKey, 900)
        : null,
      category: article.category,
      authorName: article.authorName,
      status: article.status,
      publishTime: article.publishTime?.toISOString() ?? null,
      version: article.version,
      customFields: isRecord(article.customFields) ? article.customFields : {},
      createTime: article.createdAt.toISOString(),
      updateTime: article.updatedAt.toISOString(),
    };
  }
}
function requireArticle(record: ArticleRecord | null): ArticleRecord {
  if (!record) throw new NotFoundException('Article not found');
  return record;
}
function snapshot(record: ArticleRecord) {
  return {
    title: record.title,
    status: record.status,
    version: record.version,
  };
}
async function updateOrConflict(
  tx: ArticleTransaction,
  id: number,
  version: number,
  change: ArticleChange,
) {
  if (version >= 2_147_483_647)
    throw new ConflictException('Article version is exhausted');
  if (!(await tx.update(id, version, change)))
    throw new ConflictException('Article changed concurrently');
}
function assertArticleId(id: number): void {
  if (!Number.isSafeInteger(id) || id < 1 || id > 2_147_483_647)
    throw new BadRequestException('Invalid articleId');
}
function parsePage(query: ContentListQuery) {
  try {
    return contentPage(query);
  } catch (error) {
    throw new BadRequestException(
      error instanceof Error ? error.message : 'Invalid pagination',
    );
  }
}
function requiredText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new UnprocessableEntityException(`Invalid ${field}`);
  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireAccess(
  scope: ResolvedDataScope | undefined,
  actorUserId?: number,
): ArticleAccess {
  const access = resolveArticleAccess(scope);
  if (
    !access ||
    (actorUserId !== undefined && !articleActorMatches(access, actorUserId))
  )
    throw new ForbiddenException('Article data scope is not permitted');
  return access;
}

function readable(
  record: ArticleRecord,
  context: ArticleFieldContext,
): ArticleRecord {
  return {
    ...record,
    customFields: filterReadableCustomFields({
      definitions: context.definitions,
      policies: context.policies,
      values: record.customFields,
    }),
  };
}
