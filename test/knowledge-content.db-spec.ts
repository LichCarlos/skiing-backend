import { parseArticleMarkdown } from '../src/shared/content/markdown.js';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/shared/persistence/prisma.service.js';
import { AdminArticleService } from '../src/modules/knowledge-content/application/admin-article-service.js';
import { PublicArticleQueries } from '../src/modules/knowledge-content/application/public-article-queries.js';
import { ProjectKnowledgeService } from '../src/modules/knowledge-content/application/project-knowledge.service.js';
import { PrismaArticleRepository } from '../src/modules/knowledge-content/infrastructure/prisma-article.repository.js';
import { PrismaPublicArticleReader } from '../src/modules/knowledge-content/infrastructure/prisma-public-article.reader.js';
import { PrismaProjectKnowledgeRepository } from '../src/modules/knowledge-content/infrastructure/prisma-project-knowledge.repository.js';
import { PrismaOutboxStore } from '../src/modules/integration-events/infrastructure/prisma-outbox.store.js';
import type { AssetStorage } from '../src/modules/assets/application/ports/asset-storage.js';

describe('Knowledge content persistence (dedicated migrated PostgreSQL)', () => {
  const prisma = new PrismaService(),
    outbox = new PrismaOutboxStore(prisma);
  const storage: AssetStorage = {
    put: async () => {
      throw new Error('Fixture has no assets');
    },
    remove: async () => {
      throw new Error('Fixture has no assets');
    },
    createReadUrl: async () => {
      throw new Error('Fixture has no assets');
    },
  };
  const articles = new AdminArticleService(
    new PrismaArticleRepository(prisma, outbox),
    storage,
  );
  const publicReader = new PrismaPublicArticleReader(prisma),
    publicArticles = new PublicArticleQueries(publicReader, storage);
  const knowledge = new ProjectKnowledgeService(
    new PrismaProjectKnowledgeRepository(prisma, outbox),
  );
  const suffix = randomUUID(),
    categoryValue = `test-${suffix}`,
    foreignType = `test.public.${suffix}`;
  const userIds: number[] = [],
    articleIds: number[] = [],
    projectIds: number[] = [],
    itemIds: number[] = [],
    roleIds: number[] = [];
  let categoryTypeCreated = false,
    foreignTypeCreated = false;
  let ownerId: number,
    projectActorId: number,
    otherId: number,
    selectedId: number,
    allId: number,
    firstId: number,
    secondId: number,
    otherArticleId: number;
  const audit = (actorUserId = ownerId) => ({
    actorUserId,
    traceId: randomUUID(),
    clientIp: null,
    userAgent: null,
  });
  const all = { kind: 'all' } as const;
  const groupKey = `ct_${suffix.slice(0, 8)}`;
  const field = (name: string) => `ct_${name}_${suffix.replaceAll('-', '')}`;
  const body = (title: string) => ({
    title,
    summary: 'Summary',
    body: 'Safe ski knowledge',
    categoryValue,
  });
  beforeAll(async () => {
    if (!process.env.DATABASE_URL)
      throw new Error(
        'DATABASE_URL must explicitly identify a migrated test database',
      );
    await prisma.$connect();
    const type = await prisma.dictionaryType.findUnique({
      where: { DictType: 'knowledge.article_category' },
    });
    if (type)
      expect(type).toMatchObject({ Status: 'active', PubliclyReadable: true });
    else {
      await prisma.dictionaryType.create({
        data: {
          DictType: 'knowledge.article_category',
          DictName: 'Categories',
          GroupKey: 'knowledge',
          PubliclyReadable: true,
        },
      });
      categoryTypeCreated = true;
    }
    await prisma.dictionaryType.create({
      data: {
        DictType: foreignType,
        DictName: 'Other public dictionary',
        GroupKey: 'test',
        PubliclyReadable: true,
      },
    });
    foreignTypeCreated = true;
    for (const dictType of ['knowledge.article_category', foreignType]) {
      const item = await prisma.dictionaryItem.create({
        data: {
          DictType: dictType,
          Value: dictType === foreignType ? `foreign-${suffix}` : categoryValue,
          Label: 'Test category',
        },
      });
      itemIds.push(item.ItemId);
    }
    for (const account of [
      `content-a-${suffix}`,
      `content-b-${suffix}`,
      `content-s-${suffix}`,
      `content-g-${suffix}`,
    ]) {
      const actor = await prisma.user.create({
        data: {
          Account: account,
          PasswordHash: 'disabled',
          Nickname: 'Content fixture',
        },
      });
      userIds.push(actor.UserId);
    }
    [ownerId, otherId, selectedId, allId] = userIds as [
      number,
      number,
      number,
      number,
    ];
    for (const [name, authorId] of [
      ['A1', ownerId],
      ['A2', ownerId],
      ['B1', otherId],
    ] as const) {
      const row = await prisma.article.create({
        data: {
          Title: `${suffix} ${name}`,
          Summary: 'Summary',
          Body: 'Body',
          CategoryValue: categoryValue,
          AuthorId: authorId,
        },
      });
      articleIds.push(row.ArticleId);
    }
    [firstId, secondId, otherArticleId] = articleIds as [
      number,
      number,
      number,
    ];
    const permissions = await prisma.permission.findMany({
      where: {
        PermissionKey: {
          in: ['content:article:manage', 'management:portal:enter'],
        },
        Status: 'active',
      },
    });
    expect(permissions).toHaveLength(2);
    for (const userId of userIds) {
      const scopeType =
        userId === selectedId ? 'selected' : userId === allId ? 'all' : 'self';
      const role = await prisma.role.create({
        data: {
          RoleKey: 'ct-' + userId + '-' + suffix.slice(0, 8),
          RoleName: 'Content fixture',
          DataScope: 'self',
          UserRoles: { create: { UserId: userId } },
          RolePermissions: {
            create: permissions.map((p) => ({ PermissionId: p.PermissionId })),
          },
          DataScopes: {
            create: {
              ResourceKey: 'article',
              ScopeType: scopeType,
              ...(scopeType === 'selected'
                ? { ScopeConfig: { selectedIds: [otherArticleId] } }
                : {}),
            },
          },
        },
      });
      roleIds.push(role.RoleId);
    }
    await prisma.customFieldGroup.create({
      data: {
        EntityType: 'article',
        GroupKey: groupKey,
        Label: 'Content test fields',
      },
    });
    for (const name of ['read', 'write', 'secret', 'union', 'disabled'])
      await prisma.customFieldDefinition.create({
        data: {
          EntityType: 'article',
          GroupKey: groupKey,
          FieldKey: field(name),
          Label: name,
          DataType: 'text',
          Status: name === 'disabled' ? 'disabled' : 'active',
          SchemaVersion: 7,
        },
      });
    await prisma.roleFieldPermission.createMany({
      data: [
        {
          RoleId: roleIds[0]!,
          EntityType: 'article',
          FieldKey: field('read'),
          CanRead: true,
          CanWrite: false,
        },
        {
          RoleId: roleIds[0]!,
          EntityType: 'article',
          FieldKey: field('write'),
          CanRead: false,
          CanWrite: true,
        },
        {
          RoleId: roleIds[0]!,
          EntityType: 'article',
          FieldKey: field('union'),
          CanRead: true,
          CanWrite: false,
        },
        {
          RoleId: roleIds[0]!,
          EntityType: 'article',
          FieldKey: field('disabled'),
          CanRead: true,
          CanWrite: true,
        },
      ],
    });
    const extraRole = await prisma.role.create({
      data: {
        RoleKey: `ct-extra-${suffix.slice(0, 8)}`,
        RoleName: 'Additional field grants',
        DataScope: 'self',
        UserRoles: { create: { UserId: ownerId } },
        FieldPolicies: {
          create: {
            EntityType: 'article',
            FieldKey: field('union'),
            CanRead: false,
            CanWrite: true,
          },
        },
      },
    });
    roleIds.push(extraRole.RoleId);
    const systemAdmin = await prisma.role.findUniqueOrThrow({
      where: { SystemRoleCode: 'system_admin' },
    });
    const projectActor = await prisma.user.create({
      data: {
        Account: `content-p-${suffix}`,
        PasswordHash: 'disabled',
        Nickname: 'Project fixture',
        UserRoles: { create: { RoleId: systemAdmin.RoleId } },
      },
    });
    projectActorId = projectActor.UserId;
    userIds.push(projectActorId);
  });
  afterAll(async () => {
    try {
      if (userIds.length)
        await prisma.operationLog.deleteMany({
          where: { ActorUserId: { in: userIds } },
        });
      for (const [type, ids] of [
        ['article', articleIds],
        ['project_doc', projectIds],
      ] as const) {
        if (ids.length)
          await prisma.outboxEvent.deleteMany({
            where: {
              AggregateType: type,
              AggregateId: { in: ids.map(String) },
            },
          });
      }
      if (articleIds.length)
        await prisma.article.deleteMany({
          where: { ArticleId: { in: articleIds } },
        });
      if (userIds.length)
        await prisma.asset.deleteMany({
          where: { OwnerUserId: { in: userIds } },
        });
      if (projectIds.length)
        await prisma.projectKnowledge.deleteMany({
          where: { ProjectKnowledgeId: { in: projectIds } },
        });
      if (roleIds.length)
        await prisma.role.deleteMany({ where: { RoleId: { in: roleIds } } });
      await prisma.customFieldDefinition.deleteMany({
        where: { EntityType: 'article', GroupKey: groupKey },
      });
      await prisma.customFieldGroup.deleteMany({
        where: { EntityType: 'article', GroupKey: groupKey },
      });
      if (itemIds.length)
        await prisma.dictionaryItem.deleteMany({
          where: { ItemId: { in: itemIds } },
        });
      if (foreignTypeCreated)
        await prisma.dictionaryType.delete({
          where: { DictType: foreignType },
        });
      if (categoryTypeCreated)
        await prisma.dictionaryType.delete({
          where: { DictType: 'knowledge.article_category' },
        });
      if (userIds.length)
        await prisma.user.deleteMany({ where: { UserId: { in: userIds } } });
    } finally {
      await prisma.$disconnect();
    }
  });
  it('filters self and selected before pagination/count and makes invisible targets 404', async () => {
    const own = await articles.list(
      { keyword: suffix, page: 1, pageSize: 1 },
      { kind: 'self', userId: ownerId },
      ownerId,
    );
    expect(own.total).toBe(2);
    expect(own.items).toHaveLength(1);
    const selected = await articles.list(
      { keyword: suffix },
      { kind: 'selected', ids: [otherArticleId] },
      selectedId,
    );
    expect(selected.total).toBe(1);
    expect(selected.items[0]!.articleId).toBe(otherArticleId);
    await expect(
      articles.get(otherArticleId, { kind: 'self', userId: ownerId }, ownerId),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      articles.get(
        firstId,
        { kind: 'selected', ids: [otherArticleId] },
        selectedId,
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      articles.publish(otherArticleId, audit(), {
        kind: 'self',
        userId: ownerId,
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(
      await prisma.outboxEvent.count({
        where: {
          AggregateType: 'article',
          AggregateId: String(otherArticleId),
        },
      }),
    ).toBe(0);
  });
  it('denies selected creation and merchant scope and fixes author to the authenticated actor', async () => {
    await expect(
      articles.create(body(`${suffix} selected`), audit(), {
        kind: 'selected',
        ids: [secondId],
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      articles.list({}, { kind: 'merchant', merchantId: 1 }, ownerId),
    ).rejects.toMatchObject({ status: 403 });
    const created = await articles.create(body(`${suffix} Created`), audit(), {
      kind: 'self',
      userId: ownerId,
    });
    articleIds.push(created.articleId);
    expect(
      await prisma.article.findUniqueOrThrow({
        where: { ArticleId: created.articleId },
      }),
    ).toMatchObject({ AuthorId: ownerId, Status: 'draft', PublishTime: null });
    await expect(
      articles.get(
        created.articleId,
        { kind: 'self', userId: otherId },
        otherId,
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('persists publication/edit/withdraw/republication/delete with matching outbox and audit', async () => {
    const own = { kind: 'self', userId: ownerId } as const;
    const published = await articles.publish(firstId, audit(), own);
    expect(published.publishTime).not.toBeNull();
    await articles.update(firstId, body(`${suffix} Updated`), audit(), own);
    expect(await publicArticles.get(firstId)).toMatchObject({
      title: `${suffix} Updated`,
      publishTime: published.publishTime,
    });
    await articles.withdraw(firstId, audit(), own);
    await expect(publicArticles.get(firstId)).rejects.toMatchObject({
      status: 404,
    });
    expect((await articles.publish(firstId, audit(), own)).publishTime).toBe(
      published.publishTime,
    );
    await articles.remove(firstId, audit(), own);
    await expect(articles.get(firstId, all, allId)).rejects.toMatchObject({
      status: 404,
    });
    expect(
      await prisma.outboxEvent.count({
        where: { AggregateType: 'article', AggregateId: String(firstId) },
      }),
    ).toBe(5);
    expect(
      await prisma.operationLog.count({
        where: { TargetType: 'Article', TargetId: String(firstId) },
      }),
    ).toBe(5);
  });
  it('rolls back article edits and outbox when the audit insert fails', async () => {
    const before = await prisma.article.findUniqueOrThrow({
      where: { ArticleId: otherArticleId },
    });
    await expect(
      articles.update(
        otherArticleId,
        body(`${suffix} Must rollback`),
        { ...audit(allId), traceId: 'x'.repeat(101) },
        all,
      ),
    ).rejects.toMatchObject({ code: 'P2000' });
    expect(
      await prisma.article.findUniqueOrThrow({
        where: { ArticleId: otherArticleId },
      }),
    ).toMatchObject({ Title: before.Title, Version: before.Version });
    expect(
      await prisma.outboxEvent.count({
        where: {
          AggregateType: 'article',
          AggregateId: String(otherArticleId),
        },
      }),
    ).toBe(0);
  });
  it('excludes other public dictionaries and inactive article categories', async () => {
    const categories = await publicReader.categories();
    expect(categories.map((item) => item.value)).toContain(categoryValue);
    expect(categories.map((item) => item.value)).not.toContain(
      `foreign-${suffix}`,
    );
    await articles.publish(secondId, audit(allId), all);
    await prisma.dictionaryItem.update({
      where: { ItemId: itemIds[0]! },
      data: { Status: 'disabled' },
    });
    try {
      await expect(publicArticles.get(secondId)).rejects.toMatchObject({
        status: 404,
      });
      expect((await publicArticles.list({ categoryValue })).total).toBe(0);
    } finally {
      await prisma.dictionaryItem.update({
        where: { ItemId: itemIds[0]! },
        data: { Status: 'active' },
      });
    }
  });
  it('preserves project knowledge versions, first publication and atomic audit rollback', async () => {
    const projectAudit = () => audit(projectActorId);
    const created = await knowledge.create(
      {
        title: `${suffix} Platform`,
        content: 'Public platform instructions',
        category: 'platform',
      },
      projectAudit(),
    );
    projectIds.push(created.projectKnowledgeId);
    const id = created.projectKnowledgeId;
    const published = await knowledge.publish(id, projectAudit());
    expect(published).toMatchObject({ status: 'published', version: 2 });
    await expect(
      knowledge.update(
        id,
        {
          title: 'Title',
          content: 'Content',
          category: 'platform',
          version: 1,
        },
        projectAudit(),
      ),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      knowledge.withdraw(id, { ...projectAudit(), traceId: 'x'.repeat(101) }),
    ).rejects.toMatchObject({ code: 'P2000' });
    expect(await knowledge.get(id)).toMatchObject({
      status: 'published',
      version: 2,
    });
    expect(
      await prisma.outboxEvent.count({
        where: { AggregateType: 'project_doc', AggregateId: String(id) },
      }),
    ).toBe(2);
    await knowledge.withdraw(id, projectAudit());
    expect((await knowledge.publish(id, projectAudit()))!.publishTime).toBe(
      published!.publishTime,
    );
    await knowledge.remove(id, projectAudit());
    await expect(knowledge.get(id)).rejects.toMatchObject({ status: 404 });
    expect(
      await prisma.operationLog.count({
        where: { TargetType: 'ProjectKnowledge', TargetId: String(id) },
      }),
    ).toBe(5);
  });
  it('filters real multi-role fields in list/detail and hides disabled/unknown stored fields', async () => {
    await prisma.article.update({
      where: { ArticleId: secondId },
      data: {
        CustomFields: {
          [field('read')]: 'readable',
          [field('write')]: 'write-only',
          [field('secret')]: 'private',
          [field('union')]: 'combined',
          [field('disabled')]: 'inactive',
          legacy: 'preserve',
        },
      },
    });
    const scope = { kind: 'self', userId: ownerId } as const;
    const visible = {
      [field('read')]: 'readable',
      [field('union')]: 'combined',
    };
    expect((await articles.get(secondId, scope, ownerId)).customFields).toEqual(
      visible,
    );
    const list = await articles.list({ keyword: suffix }, scope, ownerId);
    expect(
      list.items.find((item) => item.articleId === secondId)!.customFields,
    ).toEqual(visible);
  });
  it('exposes only granted active metadata; all scope alone does not grant field access', async () => {
    const schema = await articles.customFieldSchema(
      { kind: 'self', userId: ownerId },
      ownerId,
    );
    const group = schema.groups.find((group) => group.groupKey === groupKey)!;
    expect(group.fields.map((item) => item.fieldKey).sort()).toEqual(
      [field('read'), field('write'), field('union')].sort(),
    );
    expect(
      group.fields.find((item) => item.fieldKey === field('union')),
    ).toMatchObject({ canRead: true, canWrite: true });
    expect((await articles.customFieldSchema(all, allId)).groups).toEqual([]);
    expect(
      (
        await articles.customFieldSchema(
          { kind: 'selected', ids: [otherArticleId] },
          selectedId,
        )
      ).groups,
    ).toEqual([]);
  });
  it('allows the protected system_admin to read/write the active field catalog', async () => {
    const admin = await prisma.userRole.findFirstOrThrow({
      where: {
        Role: { RoleKey: 'system_admin', Status: 'active' },
        User: { Status: 'active' },
      },
    });
    const schema = await articles.customFieldSchema(all, admin.UserId);
    const group = schema.groups.find((group) => group.groupKey === groupKey)!;
    expect(group.fields.map((item) => item.fieldKey).sort()).toEqual(
      ['read', 'write', 'union', 'secret'].map(field).sort(),
    );
    expect(group.fields.every((item) => item.canRead && item.canWrite)).toBe(
      true,
    );
  });
  it('hides all fields when their group has been disabled without deleting stored values', async () => {
    const where = {
      EntityType_GroupKey: { EntityType: 'article', GroupKey: groupKey },
    };
    await prisma.customFieldGroup.update({
      where,
      data: { Status: 'disabled' },
    });
    try {
      expect(
        (
          await articles.customFieldSchema(
            { kind: 'self', userId: ownerId },
            ownerId,
          )
        ).groups,
      ).toEqual([]);
      expect(
        (
          await articles.get(
            secondId,
            { kind: 'self', userId: ownerId },
            ownerId,
          )
        ).customFields,
      ).toEqual({});
      const row = await prisma.article.findUniqueOrThrow({
        where: { ArticleId: secondId },
      });
      expect(row.CustomFields).toHaveProperty(field('secret'), 'private');
    } finally {
      await prisma.customFieldGroup.update({
        where,
        data: { Status: 'active' },
      });
    }
  });
  it('rejects read-only/unknown/disabled writes without changing row, audit or outbox', async () => {
    const before = await prisma.article.findUniqueOrThrow({
      where: { ArticleId: secondId },
    });
    const count = await prisma.outboxEvent.count({
      where: { AggregateType: 'article', AggregateId: String(secondId) },
    });
    const logs = await prisma.operationLog.count({
      where: { TargetType: 'Article', TargetId: String(secondId) },
    });
    for (const key of [
      field('read'),
      field('secret'),
      field('disabled'),
      'unknown',
    ]) {
      await expect(
        articles.update(
          secondId,
          { ...body('Denied'), customFields: { [key]: 'bad' } },
          audit(),
          { kind: 'self', userId: ownerId },
        ),
      ).rejects.toMatchObject({ status: 422 });
    }
    expect(
      await prisma.article.findUniqueOrThrow({
        where: { ArticleId: secondId },
      }),
    ).toMatchObject({
      Version: before.Version,
      Title: before.Title,
      CustomFields: before.CustomFields,
    });
    expect(
      await prisma.outboxEvent.count({
        where: { AggregateType: 'article', AggregateId: String(secondId) },
      }),
    ).toBe(count);
    expect(
      await prisma.operationLog.count({
        where: { TargetType: 'Article', TargetId: String(secondId) },
      }),
    ).toBe(logs);
  });
  it('merges role grants for writes while preserving invisible stored values and filtering the response', async () => {
    const result = await articles.update(
      secondId,
      {
        ...body(`${suffix} Field update`),
        customFields: {
          [field('write')]: 'changed secret',
          [field('union')]: 'changed combined',
        },
      },
      audit(),
      { kind: 'self', userId: ownerId },
    );
    expect(result.customFields).toEqual({
      [field('read')]: 'readable',
      [field('union')]: 'changed combined',
    });
    const row = await prisma.article.findUniqueOrThrow({
      where: { ArticleId: secondId },
    });
    expect(row).toMatchObject({
      SchemaVersion: 7,
      CustomFields: {
        [field('read')]: 'readable',
        [field('write')]: 'changed secret',
        [field('secret')]: 'private',
        [field('union')]: 'changed combined',
        [field('disabled')]: 'inactive',
        legacy: 'preserve',
      },
    });
  });
  it('reloads field grants and schema after a previously authorized request context', async () => {
    const where = {
      RoleId_EntityType_FieldKey: {
        RoleId: roleIds[4]!,
        EntityType: 'article',
        FieldKey: field('union'),
      },
    };
    const scope = { kind: 'self', userId: ownerId } as const;
    await prisma.roleFieldPermission.update({
      where,
      data: { CanWrite: false },
    });
    try {
      await expect(
        articles.update(
          secondId,
          { ...body('Revoked'), customFields: { [field('union')]: 'bad' } },
          audit(),
          scope,
        ),
      ).rejects.toMatchObject({ status: 422 });
    } finally {
      await prisma.roleFieldPermission.update({
        where,
        data: { CanWrite: true },
      });
    }
    const definition = {
      EntityType_FieldKey: { EntityType: 'article', FieldKey: field('union') },
    };
    await prisma.customFieldDefinition.update({
      where: definition,
      data: { Status: 'disabled' },
    });
    try {
      await expect(
        articles.update(
          secondId,
          { ...body('Disabled'), customFields: { [field('union')]: 'bad' } },
          audit(),
          scope,
        ),
      ).rejects.toMatchObject({ status: 422 });
      expect(
        (await articles.get(secondId, scope, ownerId)).customFields,
      ).toEqual({ [field('read')]: 'readable' });
    } finally {
      await prisma.customFieldDefinition.update({
        where: definition,
        data: { Status: 'active' },
      });
    }
  });
  it.each([
    'account',
    'role',
    'action',
    'portal',
    'scope',
    'conflict',
  ] as const)(
    'rechecks committed %s changes on every article read and command without side effects',
    async (change) => {
      const scope = { kind: 'self', userId: ownerId } as const;
      const roleId = roleIds[0]!,
        extraRoleId = roleIds[4]!;
      const permissionKey =
        change === 'portal'
          ? 'management:portal:enter'
          : 'content:article:manage';
      const permission = await prisma.permission.findUniqueOrThrow({
        where: { PermissionKey: permissionKey },
      });
      const before = await articleEffects(secondId);
      const articleCount = await prisma.article.count({
        where: { AuthorId: ownerId },
      });
      try {
        if (change === 'account')
          await prisma.user.update({
            where: { UserId: ownerId },
            data: { Status: 'disabled' },
          });
        if (change === 'role')
          await prisma.role.update({
            where: { RoleId: roleId },
            data: { Status: 'disabled' },
          });
        if (change === 'action' || change === 'portal')
          await prisma.rolePermission.delete({
            where: {
              RoleId_PermissionId: {
                RoleId: roleId,
                PermissionId: permission.PermissionId,
              },
            },
          });
        if (change === 'scope')
          await prisma.roleDataScope.update({
            where: {
              RoleId_ResourceKey: { RoleId: roleId, ResourceKey: 'article' },
            },
            data: {
              ScopeType: 'selected',
              ScopeConfig: { selectedIds: [secondId] },
            },
          });
        if (change === 'conflict')
          await prisma.role.update({
            where: { RoleId: extraRoleId },
            data: {
              DataScope: 'all',
              RolePermissions: {
                create: { PermissionId: permission.PermissionId },
              },
            },
          });
        for (const run of [
          () => articles.list({}, scope, ownerId),
          () => articles.get(secondId, scope, ownerId),
          () => articles.customFieldSchema(scope, ownerId),
          () => articles.create(body('Must not create'), audit(), scope),
          () =>
            articles.update(secondId, body('Must not write'), audit(), scope),
          () => articles.publish(secondId, audit(), scope),
          () => articles.withdraw(secondId, audit(), scope),
          () => articles.remove(secondId, audit(), scope),
        ])
          await expect(run()).rejects.toMatchObject({ status: 403 });
        expect(await articleEffects(secondId)).toEqual(before);
        expect(
          await prisma.article.count({ where: { AuthorId: ownerId } }),
        ).toBe(articleCount);
      } finally {
        if (change === 'account')
          await prisma.user.update({
            where: { UserId: ownerId },
            data: { Status: 'active' },
          });
        if (change === 'role')
          await prisma.role.update({
            where: { RoleId: roleId },
            data: { Status: 'active' },
          });
        if (change === 'action' || change === 'portal')
          await prisma.rolePermission.create({
            data: { RoleId: roleId, PermissionId: permission.PermissionId },
          });
        if (change === 'scope')
          await prisma.roleDataScope.update({
            where: {
              RoleId_ResourceKey: { RoleId: roleId, ResourceKey: 'article' },
            },
            data: {
              ScopeType: 'self',
              ScopeConfig: (await import('@prisma/client')).Prisma.DbNull,
            },
          });
        if (change === 'conflict') {
          await prisma.rolePermission.delete({
            where: {
              RoleId_PermissionId: {
                RoleId: extraRoleId,
                PermissionId: permission.PermissionId,
              },
            },
          });
          await prisma.role.update({
            where: { RoleId: extraRoleId },
            data: { DataScope: 'self' },
          });
        }
      }
    },
  );
  it.each([null, [], 'invalid', false])(
    'rejects invalid field container %j without article/audit/event changes',
    async (customFields) => {
      const id = await articleFixture(),
        before = await articleEffects(id);
      const scope = { kind: 'self', userId: ownerId } as const;
      const count = await prisma.article.count({
        where: { AuthorId: ownerId },
      });
      const input = {
        ...body('Must not write'),
        customFields: customFields as unknown as Record<string, unknown>,
      };
      await expect(
        articles.create(input, audit(), scope),
      ).rejects.toMatchObject({ status: 422 });
      await expect(
        articles.update(id, input, audit(), scope),
      ).rejects.toMatchObject({ status: 422 });
      expect(await articleEffects(id)).toEqual(before);
      expect(await prisma.article.count({ where: { AuthorId: ownerId } })).toBe(
        count,
      );
    },
  );
  it('a protected sole administrator reads and writes active fields without explicit field grants', async () => {
    const created = await articles.create(
      {
        ...body('Protected administrator'),
        customFields: { [field('secret')]: 'protected-write' },
      },
      audit(projectActorId),
      all,
    );
    articleIds.push(created.articleId);
    expect(created.customFields).toEqual({
      [field('secret')]: 'protected-write',
    });
    expect(
      (await articles.customFieldSchema(all, projectActorId)).groups
        .flatMap((group) => group.fields)
        .find((def) => def.fieldKey === field('secret')),
    ).toMatchObject({ canRead: true, canWrite: true });
    const published = await articles.publish(
      created.articleId,
      audit(projectActorId),
      all,
    );
    expect(published.customFields).toEqual(created.customFields);
    expect(
      (await articles.withdraw(created.articleId, audit(projectActorId), all))
        .customFields,
    ).toEqual(created.customFields);
    await articles.update(
      created.articleId,
      {
        ...body('Updated by protected administrator'),
        customFields: { [field('secret')]: null },
      },
      audit(projectActorId),
      all,
    );
    expect(
      (await articles.get(created.articleId, all, projectActorId)).customFields,
    ).toEqual({ [field('secret')]: null });
    const effects = await articleEffects(created.articleId);
    expect(effects.events).toBe(4);
    expect(effects.logs).toBe(4);
  });
  it.each(['item', 'type'] as const)(
    'rejects a dictionary %s disabled after field-directory loading and preserves the stored selection',
    async (kind) => {
      const choiceKey = field('choice-' + kind),
        choiceValue = `foreign-${suffix}`;
      await prisma.customFieldDefinition.create({
        data: {
          EntityType: 'article',
          GroupKey: groupKey,
          FieldKey: choiceKey,
          Label: 'Choice',
          DataType: 'single_select',
          Status: 'active',
          OptionsDictType: foreignType,
          SchemaVersion: 8,
        },
      });
      await prisma.roleFieldPermission.create({
        data: {
          RoleId: roleIds[0]!,
          EntityType: 'article',
          FieldKey: choiceKey,
          CanRead: true,
          CanWrite: true,
        },
      });
      const scope = { kind: 'self', userId: ownerId } as const;
      const created = await articles.create(
        {
          ...body('Dictionary selection'),
          customFields: { [choiceKey]: choiceValue },
        },
        audit(),
        scope,
      );
      articleIds.push(created.articleId);
      expect(
        (await articles.customFieldSchema(scope, ownerId)).groups
          .flatMap((group) => group.fields)
          .find((def) => def.fieldKey === choiceKey),
      ).toMatchObject({ canWrite: true, optionsDictType: foreignType });
      const before = await articleEffects(created.articleId);
      const setStatus = (Status: string) =>
        kind === 'type'
          ? prisma.dictionaryType.update({
              where: { DictType: foreignType },
              data: { Status },
            })
          : prisma.dictionaryItem.update({
              where: {
                DictType_Value: { DictType: foreignType, Value: choiceValue },
              },
              data: { Status },
            });
      await setStatus('disabled');
      try {
        await expect(
          articles.update(
            created.articleId,
            {
              ...body('Stale selected value'),
              customFields: { [choiceKey]: choiceValue },
            },
            audit(),
            scope,
          ),
        ).rejects.toMatchObject({ status: 422 });
        expect(await articleEffects(created.articleId)).toEqual(before);
        // Omitting that field must preserve the old value even though it cannot be resubmitted.
        await articles.update(
          created.articleId,
          body('Preserve omitted selection'),
          audit(),
          scope,
        );
        expect(
          (
            await prisma.article.findUniqueOrThrow({
              where: { ArticleId: created.articleId },
            })
          ).CustomFields,
        ).toEqual({ [choiceKey]: choiceValue });
      } finally {
        await setStatus('active');
      }
    },
  );
  it('rolls back article and an already appended event when Outbox append fails before audit', async () => {
    const id = await articleFixture(),
      before = await articleEffects(id);
    const failing = new AdminArticleService(
      new PrismaArticleRepository(prisma, {
        claimBatch: (...args) => outbox.claimBatch(...args),
        markPublished: (...args) => outbox.markPublished(...args),
        scheduleRetry: (...args) => outbox.scheduleRetry(...args),
        markFailed: (...args) => outbox.markFailed(...args),
        async append(transaction, event) {
          await outbox.append(transaction, event);
          throw new Error('Controlled Outbox append failure');
        },
      }),
      storage,
    );
    await expect(
      failing.update(id, body('Must rollback event and article'), audit(), {
        kind: 'self',
        userId: ownerId,
      }),
    ).rejects.toThrow('Controlled Outbox append failure');
    expect(await articleEffects(id)).toEqual(before);
  });
  async function articleFixture(version = 1) {
    const row = await prisma.article.create({
      data: {
        Title: suffix,
        Summary: 'Summary',
        Body: 'Body',
        CategoryValue: categoryValue,
        AuthorId: ownerId,
        Version: version,
      },
    });
    articleIds.push(row.ArticleId);
    return row.ArticleId;
  }
  async function coverFixture() {
    return prisma.asset.create({
      data: {
        OwnerUserId: ownerId,
        StorageKey: `${suffix}/${randomUUID()}`,
        OriginalName: 'cover.png',
        MimeType: 'image/png',
        SizeBytes: 12n,
        Sha256: 'd'.repeat(64),
        Status: 'ready',
      },
    });
  }
  async function articleEffects(id: number) {
    return {
      row: await prisma.article.findUniqueOrThrow({ where: { ArticleId: id } }),
      logs: await prisma.operationLog.count({
        where: { TargetType: 'Article', TargetId: String(id) },
      }),
      events: await prisma.outboxEvent.count({
        where: { AggregateType: 'article', AggregateId: String(id) },
      }),
    };
  }
  it('rejects a ready non-image article cover without a business write', async () => {
    const id = await articleFixture(),
      image = await coverFixture(),
      before = await articleEffects(id);
    await prisma.asset.update({
      where: { AssetId: image.AssetId },
      data: { MimeType: 'text/plain' },
    });
    await expect(
      articles.update(
        id,
        { ...body('Denied cover'), coverAssetId: image.AssetId.toString() },
        audit(),
        { kind: 'self', userId: ownerId },
      ),
    ).rejects.toMatchObject({ status: 422 });
    expect(await articleEffects(id)).toEqual(before);
  });
  it.each([0, 2147483648])(
    'rejects article identifier %s outside int4 before querying',
    async (id) => {
      await expect(
        articles.get(id, { kind: 'self', userId: ownerId }, ownerId),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        articles.publish(id, audit(), { kind: 'self', userId: ownerId }),
      ).rejects.toMatchObject({ status: 400 });
    },
  );
  it('rejects a bigint overflow in article cover without a SQL error', async () => {
    const id = await articleFixture(),
      before = await articleEffects(id);
    await expect(
      articles.update(
        id,
        { ...body('Denied ID'), coverAssetId: '9223372036854775808' },
        audit(),
        { kind: 'self', userId: ownerId },
      ),
    ).rejects.toMatchObject({ status: 422 });
    expect(await articleEffects(id)).toEqual(before);
  });
  it('rejects an exhausted article version without increment overflow', async () => {
    const id = await articleFixture(2147483647),
      before = await articleEffects(id);
    await expect(
      articles.publish(id, audit(), { kind: 'self', userId: ownerId }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await articleEffects(id)).toEqual(before);
  });
  it.each(['image', 'category'] as const)(
    'coordinates article %s binding with an actual competing status update',
    async (kind) => {
      const id = await articleFixture(),
        image = await coverFixture(),
        before = await articleEffects(id);
      let release!: () => void, locked!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const ready = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const holding = prisma.$transaction(
        async (tx) => {
          if (kind === 'image')
            await tx.asset.update({
              where: { AssetId: image.AssetId },
              data: { Status: 'pending_scan' },
            });
          else
            await tx.dictionaryItem.update({
              where: { ItemId: itemIds[0]! },
              data: { Status: 'disabled' },
            });
          locked();
          await gate;
        },
        { timeout: 15000 },
      );
      await ready;
      const updating = articles
        .update(
          id,
          {
            ...body('Concurrent reference'),
            ...(kind === 'image'
              ? { coverAssetId: image.AssetId.toString() }
              : {}),
          },
          audit(),
          { kind: 'self', userId: ownerId },
        )
        .then(
          () => ({ status: 200 }),
          (error) => error as { status: number },
        );
      let result!: { status: number };
      try {
        const deadline = Date.now() + 8000;
        let waiting = 0;
        while (Date.now() < deadline) {
          const table =
            kind === 'image' ? '%FROM "Asset"%' : '%FROM "DictionaryItem"%';
          const rows = await prisma.$queryRaw<
            { count: number }[]
          >`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE ${table} AND query LIKE '%FOR SHARE%'`;
          waiting = rows[0].count;
          if (waiting) break;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(waiting).toBeGreaterThan(0);
      } finally {
        release();
        try {
          await holding;
          result = await updating;
        } finally {
          if (kind === 'category')
            await prisma.dictionaryItem.update({
              where: { ItemId: itemIds[0]! },
              data: { Status: 'active' },
            });
        }
      }
      expect(result.status).toBe(409);
      expect(await articleEffects(id)).toEqual(before);
    },
  );
  describe('Markdown inline assets and optimistic concurrency', () => {
    const markdownArticles = new AdminArticleService(
      new PrismaArticleRepository(prisma, outbox),
      {
        ...storage,
        createReadUrl: async (key) =>
          `https://assets.test/${encodeURIComponent(key)}`,
      },
      { parse: parseArticleMarkdown },
    );
    it('persists deduplicated asset IDs, publishes an authorized projection, protects deletion and replaces bindings atomically', async () => {
      const image = await coverFixture();
      const scope = { kind: 'self', userId: ownerId } as const;
      const created = await markdownArticles.create(
        {
          ...body('Markdown asset fixture'),
          body: `## 安全\n\n![a](asset:${image.AssetId}) ![b](asset:${image.AssetId})`,
          contentFormat: 'markdown_v1',
        },
        audit(),
        scope,
      );
      articleIds.push(created.articleId);
      expect(
        await prisma.articleBodyAsset.count({
          where: { ArticleId: created.articleId },
        }),
      ).toBe(1);
      await expect(
        prisma.asset.delete({ where: { AssetId: image.AssetId } }),
      ).rejects.toMatchObject({ code: 'P2003' });
      const published = await markdownArticles.publish(
        created.articleId,
        audit(),
        scope,
      );
      const publicView = await new PublicArticleQueries(publicReader, {
        ...storage,
        createReadUrl: async () => 'https://assets.test/read',
      }).get(created.articleId);
      expect(publicView).toMatchObject({
        contentFormat: 'markdown_v1',
        bodyAssets: [
          { assetId: String(image.AssetId), url: 'https://assets.test/read' },
        ],
      });
      const updated = await markdownArticles.update(
        created.articleId,
        {
          ...body('Remove body image'),
          body: '**新内容**',
          contentFormat: 'markdown_v1',
          expectedVersion: published.version,
        },
        audit(),
        scope,
      );
      expect(updated.status).toBe('published');
      expect(
        await prisma.articleBodyAsset.count({
          where: { ArticleId: created.articleId },
        }),
      ).toBe(0);
      await expect(
        prisma.asset.delete({ where: { AssetId: image.AssetId } }),
      ).resolves.toBeDefined();
    });
    it('rejects another account image without content, reference, audit or Outbox changes', async () => {
      const image = await coverFixture();
      await prisma.asset.update({
        where: { AssetId: image.AssetId },
        data: { OwnerUserId: otherId },
      });
      const id = await articleFixture(),
        before = await articleEffects(id);
      await expect(
        markdownArticles.update(
          id,
          {
            ...body('Foreign asset'),
            body: `![x](asset:${image.AssetId})`,
            contentFormat: 'markdown_v1',
            expectedVersion: before.row.Version,
          },
          audit(),
          { kind: 'self', userId: ownerId },
        ),
      ).rejects.toMatchObject({ status: 422 });
      expect(await articleEffects(id)).toEqual(before);
      expect(
        await prisma.articleBodyAsset.count({ where: { ArticleId: id } }),
      ).toBe(0);
    });
    it('rejects stale Markdown updates after a concurrent save without extra audit or events', async () => {
      const id = await articleFixture(),
        scope = { kind: 'self', userId: ownerId } as const;
      const row = await prisma.article.findUniqueOrThrow({
        where: { ArticleId: id },
      });
      const write = {
        ...body('Versioned content'),
        body: '**保存**',
        contentFormat: 'markdown_v1' as const,
        expectedVersion: row.Version,
      };
      await markdownArticles.update(id, write, audit(), scope);
      const before = await articleEffects(id);
      await expect(
        markdownArticles.update(id, write, audit(), scope),
      ).rejects.toMatchObject({ status: 409 });
      expect(await articleEffects(id)).toEqual(before);
    });
  });
});
