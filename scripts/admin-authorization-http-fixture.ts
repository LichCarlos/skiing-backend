import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import { projectSourceState } from '../src/modules/ai-assistant/domain/rag-source-state.js';

const database = new URL(process.env.DATABASE_URL ?? '');
const manifestPath = process.env.ADMIN_AUTH_HTTP_FIXTURE_PATH;
const password = process.env.ADMIN_AUTH_HTTP_PASSWORD;
assert(
  database.hostname === '127.0.0.1' &&
    database.pathname === '/linji_admin_authorization_validation' &&
    process.env.ADMIN_AUTH_HTTP_CONFIRM ===
      'linji_admin_authorization_validation' &&
    manifestPath &&
    password,
  'Explicit disposable authorization HTTP database, manifest and synthetic password required',
);
const prisma = new PrismaClient();
interface Fixture {
  databaseName: string;
  adminAccount: string;
  audit: { activeId: string; deletedId: string; foreignId: string };
  retryEventId: string;
  assets: { ownId: string; removableId: string; foreignId: string };
  rag: {
    documentId: number;
    failedDocumentId: number;
    excludedDocumentId: number;
    projectKnowledgeId: number;
  };
  actors: Array<{
    userId: number;
    account: string;
    merchantId: number;
    resortId: number;
  }>;
}
try {
  const rows = await prisma.$queryRaw<
    Array<{ name: string }>
  >`SELECT current_database() AS name`;
  assert.equal(rows[0]?.name, 'linji_admin_authorization_validation');
  if (process.argv[2] === 'prepare') {
    assert.equal(await prisma.user.count(), 1);
    assert.equal(await prisma.skiResort.count(), 0);
    const admin = await prisma.user.findFirstOrThrow();
    const actors: Fixture['actors'] = [];
    for (const suffix of ['a', 'b']) {
      const user = await prisma.user.create({
        data: {
          Account: `admin_http_operator_${suffix}`,
          Nickname: '权限联调账号',
          PasswordHash: await hash(password, 10),
          MerchantProfile: {
            create: { BusinessName: `权限联调商家${suffix}` },
          },
        },
        include: { MerchantProfile: true },
      });
      const resort = await prisma.skiResort.create({
        data: {
          MerchantId: user.MerchantProfile!.MerchantId,
          Name: `权限联调雪场${suffix}`,
          LegacyDistance: 0,
          Price: 100,
          OpenStatus: 'open',
          SnowCondition: 'powder',
          Description: '权限联调原始介绍',
          Status: 'draft',
          CustomFields: {
            http_note: `原始备注${suffix}`,
            http_secret: `私有资料${suffix}`,
          },
        },
      });
      actors.push({
        userId: user.UserId,
        account: user.Account,
        merchantId: user.MerchantProfile!.MerchantId,
        resortId: resort.ResortId,
      });
    }
    const assets = {
      ownId: '9007199254741001',
      removableId: '101',
      foreignId: '9007199254741003',
    };
    for (const [index, assetId] of Object.values(assets).entries()) {
      await prisma.asset.create({
        data: {
          AssetId: BigInt(assetId),
          OwnerUserId: actors[index === 2 ? 1 : 0]!.userId,
          StorageKey: `http-assets/private-${assetId}.png`,
          OriginalName: `HTTP媒体${index}.png`,
          MimeType: 'image/png',
          SizeBytes: 2048n,
          Sha256: 'a'.repeat(64),
          Status: index === 1 ? 'rejected' : 'ready',
        },
      });
    }
    await prisma.resortRevenueRecord.createMany({
      data: actors.map((actor, index) => ({
        ResortId: actor.resortId,
        ReportDate: new Date('2026-11-03T00:00:00.000Z'),
        RevenueAmount: index === 0 ? '123.45' : '678.90',
        Source: 'manual',
        CreatedBy: admin.UserId,
        Note: '合成工作台联调数据',
      })),
    });
    await prisma.dictionaryType.upsert({
      where: { DictType: 'resort.fit_tag' },
      update: { Status: 'active' },
      create: {
        DictType: 'resort.fit_tag',
        DictName: '雪场标签',
        GroupKey: 'resort',
      },
    });
    const dictionaryRoot = await prisma.dictionaryItem.create({
      data: {
        DictType: 'resort.fit_tag',
        Label: '联调父项',
        Value: 'http_root',
      },
    });
    await prisma.dictionaryItem.create({
      data: {
        DictType: 'resort.fit_tag',
        ParentId: dictionaryRoot.ItemId,
        Label: '联调子项',
        Value: 'http_child',
        Status: 'disabled',
      },
    });
    await prisma.customFieldGroup.create({
      data: {
        EntityType: 'ski_resort',
        GroupKey: 'http_authorization',
        Label: '权限联调字段',
      },
    });
    for (const key of ['http_note', 'http_secret'])
      await prisma.customFieldDefinition.create({
        data: {
          EntityType: 'ski_resort',
          GroupKey: 'http_authorization',
          FieldKey: key,
          Label: key,
          DataType: 'text',
          IsPublic: false,
          Status: 'active',
        },
      });
    const auditTime = new Date('2026-11-03T00:00:00.000Z');
    const conversation = (userId: number | null, deleted = false) =>
      prisma.aiConversation.create({
        data: {
          UserId: userId,
          GuestSessionId: userId === null ? 'audit-http-guest' : null,
          Title: '审计联调私密标题',
          CreateTime: auditTime,
          UpdateTime: auditTime,
          DeletedAt: deleted ? auditTime : null,
        },
      });
    const active = await conversation(actors[0]!.userId);
    const deleted = await conversation(actors[0]!.userId, true);
    const foreign = await conversation(actors[1]!.userId);
    await conversation(null);
    await prisma.aiMessage.createMany({
      data: [
        {
          MessageId: 9007199254740993n,
          ConversationId: active.ConversationId,
          SenderRole: 'user',
          Content: '审计联调私密问题',
          CreateTime: auditTime,
        },
        {
          MessageId: 9007199254740994n,
          ConversationId: active.ConversationId,
          SenderRole: 'assistant',
          Content: '审计联调私密回复',
          GenerationStatus: 'completed',
          Citations: [{ sourceKey: 'article:17', title: '历史引用' }],
          CreateTime: auditTime,
        },
      ],
    });
    const knowledge = await prisma.projectKnowledge.create({
      data: {
        Title: 'HTTP RAG公开项目知识',
        Content: '公开合成滑雪项目服务说明，用于隔离联调。',
        Category: 'platform',
        Status: 'published',
        PublishTime: auditTime,
      },
    });
    const failedKnowledge = await prisma.projectKnowledge.create({
      data: {
        Title: 'HTTP RAG受限历史知识',
        Content: 'RAG联调内部正文，不进入管理元数据。',
        Category: 'platform',
        Status: 'withdrawn',
        PublishTime: auditTime,
      },
    });
    const document = await prisma.ragDocument.create({
      data: {
        SourceKey: `project:${knowledge.ProjectKnowledgeId}`,
        SourceType: 'project_doc',
        SourceId: knowledge.ProjectKnowledgeId,
        Title: knowledge.Title,
        Content: knowledge.Content,
        AccessScope: 'public',
        Status: 'indexed',
        ContentHash: createHash('sha256')
          .update(knowledge.Content)
          .digest('hex'),
        SourceUpdatedAt: knowledge.UpdateTime,
        IndexedAt: auditTime,
        Metadata: {
          sourceState: projectSourceState(knowledge),
          fixtureInternal: 'RAG联调内部元数据',
        },
      },
    });
    const vector = `[${Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0)).join(',')}]`;
    for (const [index, model] of ['z-http-model', 'a-http-model'].entries()) {
      await prisma.$executeRaw`
        INSERT INTO "RagChunk" ("RagDocumentId", "ChunkIndex", "ChunkContent", "Embedding", "EmbeddingModel")
        VALUES (${document.RagDocumentId}, ${index}, ${'RAG联调内部分块'}, ${vector}::vector, ${model})
      `;
    }
    const failedDocument = await prisma.ragDocument.create({
      data: {
        SourceKey: `project:${failedKnowledge.ProjectKnowledgeId}`,
        SourceType: 'project_doc',
        SourceId: failedKnowledge.ProjectKnowledgeId,
        Title: failedKnowledge.Title,
        Content: failedKnowledge.Content,
        AccessScope: 'admin',
        Status: 'failed',
        ContentHash: createHash('sha256')
          .update(failedKnowledge.Content)
          .digest('hex'),
        SourceUpdatedAt: failedKnowledge.UpdateTime,
        Metadata: { sourceState: projectSourceState(failedKnowledge) },
      },
    });
    const excludedDocument = await prisma.ragDocument.create({
      data: {
        SourceKey: 'revenue:http-validation',
        SourceType: 'revenue',
        Title: '不得列入来源运维的类型',
        Content: 'RAG联调内部收益',
        AccessScope: 'admin',
        Status: 'pending',
        ContentHash: createHash('sha256')
          .update('RAG联调内部收益')
          .digest('hex'),
        SourceUpdatedAt: auditTime,
      },
    });
    const retryEvent = await prisma.outboxEvent.create({
      data: {
        EventId: randomUUID(),
        EventType: 'http.fixture.recoverable.v1',
        AggregateType: 'HttpValidation',
        AggregateId: 'only-synthetic',
        Payload: { internal: 'HTTP联调内部事件正文' },
        Status: 'failed',
        Attempts: 5,
        MaxAttempts: 5,
        LastError: 'HTTP联调内部错误',
        AvailableAt: new Date('2099-01-01T00:00:00.000Z'),
      },
    });
    // The VO exposes milliseconds, while lookup must still locate this stored microsecond instant.
    await prisma.$executeRaw`
      UPDATE "OutboxEvent" SET
        "CreatedAt" = TIMESTAMPTZ '2026-11-03T01:00:00.123456Z',
        "OccurredAt" = TIMESTAMPTZ '2026-11-03T01:00:00.123456Z'
      WHERE "EventId" = ${retryEvent.EventId}::uuid
    `;
    const fixture: Fixture = {
      databaseName: rows[0]!.name,
      adminAccount: admin.Account,
      retryEventId: retryEvent.EventId,
      assets,
      actors,
      audit: {
        activeId: active.ConversationId,
        deletedId: deleted.ConversationId,
        foreignId: foreign.ConversationId,
      },
      rag: {
        documentId: document.RagDocumentId,
        failedDocumentId: failedDocument.RagDocumentId,
        excludedDocumentId: excludedDocument.RagDocumentId,
        projectKnowledgeId: knowledge.ProjectKnowledgeId,
      },
    };
    await writeFile(manifestPath, JSON.stringify(fixture, null, 2), {
      flag: 'wx',
    });
    console.info(
      'Prepared two business profiles and private fields; no merchant role assumption or credential manifest',
    );
  } else if (process.argv[2] === 'verify') {
    const fixture = JSON.parse(await readFile(manifestPath, 'utf8')) as Fixture;
    const result = JSON.parse(
      await readFile(join(dirname(manifestPath), 'client-result.json'), 'utf8'),
    ) as {
      completed: boolean;
      rejectedTraceIds: string[];
      readRoleId: number;
      writeRoleId: number;
      conflictRoleId: number;
      rag: { eventIds: string[]; concurrentWinnerReason: string };
      knowledge: { id: number; firstPublishTime: string };
      dashboard: {
        admin: {
          revenue: { amount: string; scope: string };
          users: { total: number };
          merchants: { total: number };
        };
        merchant: {
          revenue: { amount: string; scope: string };
          users: { total: number };
          merchants: { total: number };
          rag: null;
        };
        portalOnly: Record<string, unknown>;
      };
      merchantOverview: {
        resortIds: number[];
        amount: string;
        recordResortIds: number[];
        foreignDenied: boolean;
        revocationRejected: boolean;
        independentPanels: boolean;
      };
      merchantRevenue: {
        amount: string;
        total: number;
        recordResortIds: number[];
        emptyPage: boolean;
        emptyRange: boolean;
        foreignDenied: boolean;
        revocationRejected: boolean;
        scopeConflictDenied: boolean;
      };
      accountReads: {
        userId: number;
        rawProjection: boolean;
        emptyPage: boolean;
        selfScope: boolean;
        foreignDenied: boolean;
        revocationRejected: boolean;
      };
      roleReads: {
        rawProjection: boolean;
        emptyPage: boolean;
        selectedScope: boolean;
        foreignDenied: boolean;
        revocationRejected: boolean;
      };
      articleReads: {
        managedId: number;
        ownedId: number;
        firstPublishTime: string;
        lifecycle: boolean;
        scopeRules: boolean;
        revocationRejected: boolean;
        deleted: boolean;
      };
      resortReads: {
        resortId: number;
        lifecycle: boolean;
        republished: boolean;
        scopeRules: boolean;
        revocationRejected: boolean;
        deleted: boolean;
      };
      globalResortReads: {
        resortId: number;
        lifecycle: boolean;
        reassigned: boolean;
        fieldsFiltered: boolean;
        scopeRejected: boolean;
        revocationRejected: boolean;
        deleted: boolean;
      };
      communityReads: {
        dynamicId: number;
        commentId: number;
        published: boolean;
        reapproved: boolean;
        commentsModerated: boolean;
        revocationRejected: boolean;
        deleted: boolean;
      };
      assetReads: {
        scopeIsolation: boolean;
        referencesProtected: boolean;
        deleted: boolean;
        revocationRejected: boolean;
      };
      knowledgeReads: {
        rawProjection: boolean;
        emptyPage: boolean;
        sessionRevocationRejected: boolean;
        sessionRestored: boolean;
      };
      dictionaryWrites: {
        rootId: number;
        childId: number;
        lifecycle: boolean;
        cycleRejected: boolean;
        revocationRejected: boolean;
      };
      configChecks: {
        defaults: boolean;
        versionConflict: boolean;
        unknownRecovered: boolean;
        publicProjection: boolean;
        roleDenied: boolean;
        sessionRevocationRejected: boolean;
        sessionRestored: boolean;
      };
      fieldReads: {
        fieldId: number;
        lifecycle: boolean;
        staleRejected: boolean;
        groupProtected: boolean;
        revocationRejected: boolean;
      };
      catalogReads: {
        rawProjection: boolean;
        customHierarchy: boolean;
        syncDenied: boolean;
        revocationRejected: boolean;
        ids: number[];
      };
    };
    assert.equal(result.completed, true);
    assert(result.rejectedTraceIds.length >= 6);
    assert(
      result.rejectedTraceIds.every(
        (id) => typeof id === 'string' && id.length > 0,
      ),
    );
    const [a, b] = fixture.actors;
    assert.deepEqual(result.accountReads, {
      userId: a!.userId,
      rawProjection: true,
      emptyPage: true,
      selfScope: true,
      foreignDenied: true,
      revocationRejected: true,
    });
    assert.deepEqual(result.roleReads, {
      rawProjection: true,
      emptyPage: true,
      selectedScope: true,
      foreignDenied: true,
      revocationRejected: true,
    });
    assert.deepEqual(result.catalogReads, {
      rawProjection: true,
      customHierarchy: true,
      syncDenied: true,
      revocationRejected: true,
      ids: result.catalogReads.ids,
    });
    assert.equal(result.catalogReads.ids.length, 3);
    const catalog = await prisma.permission.findMany({
      where: { PermissionKey: { startsWith: 'custom:http_catalog_' } },
      orderBy: { PermissionId: 'asc' },
    });
    assert.equal(catalog.length, 3);
    assert.deepEqual(
      catalog.map((row) => row.PermissionId),
      result.catalogReads.ids,
    );
    assert.deepEqual(
      catalog.map((row) => row.Status),
      ['active', 'active', 'disabled'],
    );
    assert.deepEqual(
      catalog.map((row) => row.ParentId),
      [null, catalog[0]!.PermissionId, catalog[1]!.PermissionId],
    );
    assert.deepEqual(
      catalog.map((row) => row.PermissionType),
      ['directory', 'menu', 'button'],
    );
    assert.equal(catalog[1]!.PermissionName, 'HTTP权限菜单已修改');
    assert.deepEqual(
      catalog.map((row) => row.Visible),
      [false, true, false],
    );
    const catalogAudits = await prisma.operationLog.findMany({
      where: {
        ResourceKey: 'system:permission',
        TargetId: { in: result.catalogReads.ids.map(String) },
      },
    });
    assert.equal(catalogAudits.length, 5);
    assert(
      catalogAudits.every(
        (row) => row.ActorUserId === fixture.actors[0]!.userId,
      ),
    );
    assert.deepEqual(catalogAudits.map((row) => row.ActionKey).sort(), [
      'system:permission:create',
      'system:permission:create',
      'system:permission:create',
      'system:permission:delete',
      'system:permission:update',
    ]);
    assert.deepEqual(result.fieldReads, {
      fieldId: result.fieldReads.fieldId,
      lifecycle: true,
      staleRejected: true,
      groupProtected: true,
      revocationRejected: true,
    });
    const managedField = await prisma.customFieldDefinition.findUniqueOrThrow({
      where: { FieldDefinitionId: result.fieldReads.fieldId },
    });
    assert.equal(managedField.EntityType, 'article');
    assert.equal(managedField.FieldKey, 'http_read_choice');
    assert.equal(managedField.Status, 'disabled');
    assert.equal(managedField.SchemaVersion, 4);
    assert.equal(managedField.Label, 'HTTP字典字段已修改');
    assert.equal(managedField.DefaultValue, 'http_root');
    assert.equal(managedField.OptionsDictType, 'resort.fit_tag');
    assert.equal(managedField.IsPublic, false);
    const managedGroup = await prisma.customFieldGroup.findUniqueOrThrow({
      where: {
        EntityType_GroupKey: {
          EntityType: 'article',
          GroupKey: 'http_field_reads',
        },
      },
    });
    assert.equal(managedGroup.Status, 'disabled');
    assert.equal(managedGroup.Label, 'HTTP字段分组已修改');
    assert.equal(managedGroup.SortOrder, 5);
    const fieldAudits = await prisma.operationLog.findMany({
      where: {
        OR: [
          {
            ResourceKey: 'system:field',
            TargetId: String(managedField.FieldDefinitionId),
          },
          {
            ResourceKey: 'system:field-group',
            TargetId: 'article:http_field_reads',
          },
        ],
      },
    });
    assert.equal(fieldAudits.length, 7);
    assert(
      fieldAudits.every(
        (row) =>
          row.Result === 'success' &&
          row.ActorAccountSnapshot === fixture.adminAccount,
      ),
    );
    assert.deepEqual(fieldAudits.map((row) => row.ActionKey).sort(), [
      'system:field-group:create',
      'system:field-group:delete',
      'system:field-group:update',
      'system:field:create',
      'system:field:delete',
      'system:field:update',
      'system:field:update',
    ]);
    assert.deepEqual(result.articleReads, {
      managedId: result.articleReads.managedId,
      ownedId: result.articleReads.ownedId,
      firstPublishTime: result.articleReads.firstPublishTime,
      lifecycle: true,
      scopeRules: true,
      revocationRejected: true,
      deleted: true,
    });
    const articleRows = await prisma.article.findMany({
      orderBy: { ArticleId: 'asc' },
    });
    assert.equal(articleRows.length, 2);
    const managedArticle = articleRows.find(
      (row) => row.ArticleId === result.articleReads.managedId,
    )!;
    const ownArticle = articleRows.find(
      (row) => row.ArticleId === result.articleReads.ownedId,
    )!;
    assert(
      managedArticle &&
        ownArticle &&
        managedArticle.DeletedAt &&
        ownArticle.DeletedAt,
    );
    assert.equal(managedArticle.Title, 'HTTP文章已发布编辑');
    assert.equal(managedArticle.Status, 'published');
    assert.equal(managedArticle.Version, 6);
    assert.equal(
      managedArticle.PublishTime!.toISOString(),
      result.articleReads.firstPublishTime,
    );
    assert.equal(
      managedArticle.AuthorId,
      (
        await prisma.user.findUniqueOrThrow({
          where: { Account: fixture.adminAccount },
        })
      ).UserId,
    );
    assert.equal(ownArticle.Title, 'HTTP本人文章');
    assert.equal(ownArticle.AuthorId, fixture.actors[0]!.userId);
    assert.equal(ownArticle.Version, 2);
    assert.equal(ownArticle.Status, 'draft');
    assert.equal(ownArticle.PublishTime, null);
    for (const row of articleRows) {
      assert.equal(row.CategoryValue, 'http_beginner');
      assert.equal(row.CoverAssetId, null);
      assert.deepEqual(row.CustomFields, {});
    }
    const articleEvents = await prisma.outboxEvent.findMany({
      where: { AggregateType: 'article' },
      orderBy: [{ CreatedAt: 'asc' }, { EventId: 'asc' }],
    });
    assert.equal(articleEvents.length, 8);
    assert(
      articleEvents.every(
        (row) =>
          row.Status === 'pending' && row.EventType === 'article.changed.v1',
      ),
    );
    assert.deepEqual(
      articleEvents
        .filter((row) => row.AggregateId === String(managedArticle.ArticleId))
        .map((row) => (row.Payload as { status: string }).status)
        .sort(),
      [
        'draft',
        'published',
        'published',
        'withdrawn',
        'published',
        'deleted',
      ].sort(),
    );
    assert.deepEqual(
      articleEvents
        .filter((row) => row.AggregateId === String(ownArticle.ArticleId))
        .map((row) => (row.Payload as { status: string }).status)
        .sort(),
      ['draft', 'deleted'].sort(),
    );
    const articleAudits = await prisma.operationLog.findMany({
      where: {
        ResourceKey: 'article',
        TargetId: { in: articleRows.map((row) => String(row.ArticleId)) },
      },
    });
    assert.equal(articleAudits.length, 8);
    assert(articleAudits.every((row) => row.Result === 'success'));
    assert.deepEqual(
      articleAudits
        .filter((row) => row.TargetId === String(managedArticle.ArticleId))
        .map((row) => row.ActionKey)
        .sort(),
      [
        'content:article:create',
        'content:article:update',
        'content:article:publish',
        'content:article:publish',
        'content:article:withdraw',
        'content:article:delete',
      ].sort(),
    );
    assert(
      articleAudits
        .filter((row) => row.TargetId === String(managedArticle.ArticleId))
        .every((row) => row.ActorAccountSnapshot === fixture.adminAccount),
    );
    assert.deepEqual(
      articleAudits
        .filter((row) => row.TargetId === String(ownArticle.ArticleId))
        .map((row) => row.ActionKey)
        .sort(),
      ['content:article:create', 'content:article:delete'].sort(),
    );
    assert(
      articleAudits
        .filter((row) => row.TargetId === String(ownArticle.ArticleId))
        .every((row) => row.ActorUserId === fixture.actors[0]!.userId),
    );
    for (const actor of fixture.actors) {
      const user = await prisma.user.findUniqueOrThrow({
        where: { UserId: actor.userId },
      });
      assert.equal(user.Account, actor.account);
      assert.equal(user.Status, 'active');
      assert.equal(
        (
          await prisma.merchantProfile.findUniqueOrThrow({
            where: { MerchantId: actor.merchantId },
          })
        ).UserId,
        actor.userId,
      );
    }
    const actualA = await prisma.skiResort.findUniqueOrThrow({
      where: { ResortId: a!.resortId },
    });
    assert.equal(actualA.Description, '权限联调已保存介绍');
    assert.deepEqual(actualA.CustomFields, {
      http_note: '权限联调已保存备注',
      http_secret: '私有资料a',
    });
    const actualB = await prisma.skiResort.findUniqueOrThrow({
      where: { ResortId: b!.resortId },
    });
    assert.equal(actualB.Description, '权限联调原始介绍');
    assert.deepEqual(actualB.CustomFields, {
      http_note: '原始备注b',
      http_secret: '私有资料b',
    });
    assert.equal(await prisma.skiResort.count(), 4);
    assert.deepEqual(result.globalResortReads, {
      resortId: result.globalResortReads.resortId,
      lifecycle: true,
      reassigned: true,
      fieldsFiltered: true,
      scopeRejected: true,
      revocationRejected: true,
      deleted: true,
    });
    const globalResort = await prisma.skiResort.findUniqueOrThrow({
      where: { ResortId: result.globalResortReads.resortId },
    });
    assert(globalResort.DeletedAt);
    assert.equal(globalResort.Name, 'HTTP全局雪场流程');
    assert.equal(globalResort.Description, '全局雪场调整后介绍');
    assert.equal(globalResort.MerchantId, b!.merchantId);
    assert.equal(globalResort.Status, 'published');
    assert.equal(globalResort.Price, 288);
    assert.equal(globalResort.Rating!.toString(), '4.8');
    assert.equal(globalResort.RatingCount, 99);
    assert.deepEqual(globalResort.CustomFields, { http_note: '全局授权备注' });
    assert.equal(globalResort.CoverAssetId, null);
    assert.equal(
      await prisma.resortImage.count({
        where: { ResortId: globalResort.ResortId },
      }),
      0,
    );
    assert.equal(
      await prisma.resortFitTag.count({
        where: { ResortId: globalResort.ResortId },
      }),
      0,
    );
    const globalEvents = await prisma.outboxEvent.findMany({
      where: {
        AggregateType: 'ski_resort',
        AggregateId: String(globalResort.ResortId),
      },
    });
    assert.equal(globalEvents.length, 6);
    const payloadOrder = (value: unknown) => {
      const row = value as { merchantId: number; status: string };
      return `${row.merchantId}:${row.status}`;
    };
    assert.deepEqual(
      globalEvents
        .map((event) => event.Payload)
        .sort((a, b) => payloadOrder(a).localeCompare(payloadOrder(b))),
      [
        {
          resortId: globalResort.ResortId,
          merchantId: a!.merchantId,
          status: 'draft',
        },
        {
          resortId: globalResort.ResortId,
          merchantId: a!.merchantId,
          status: 'published',
        },
        {
          resortId: globalResort.ResortId,
          merchantId: b!.merchantId,
          status: 'published',
        },
        {
          resortId: globalResort.ResortId,
          merchantId: b!.merchantId,
          status: 'offline',
        },
        {
          resortId: globalResort.ResortId,
          merchantId: b!.merchantId,
          status: 'published',
        },
        {
          resortId: globalResort.ResortId,
          merchantId: b!.merchantId,
          status: 'deleted',
        },
      ].sort((a, b) => payloadOrder(a).localeCompare(payloadOrder(b))),
    );
    assert(
      globalEvents.every(
        (event) =>
          event.Status === 'pending' && event.EventType === 'resort.changed.v1',
      ),
    );
    const globalAudits = await prisma.operationLog.findMany({
      where: { ResourceKey: 'resort', TargetId: String(globalResort.ResortId) },
    });
    assert.equal(globalAudits.length, 6);
    assert(globalAudits.every((row) => row.Result === 'success'));
    assert.deepEqual(
      globalAudits
        .map((row) => [row.ActionKey, row.ActorAccountSnapshot])
        .sort(),
      [
        ['content:resort:create-all', a!.account],
        ['content:resort:publish', a!.account],
        ['content:resort:update-all', fixture.adminAccount],
        ['content:resort:offline', fixture.adminAccount],
        ['content:resort:publish', fixture.adminAccount],
        ['content:resort:delete-all', fixture.adminAccount],
      ].sort(),
    );
    assert.deepEqual(result.resortReads, {
      resortId: result.resortReads.resortId,
      lifecycle: true,
      republished: true,
      scopeRules: true,
      revocationRejected: true,
      deleted: true,
    });
    const managedResort = await prisma.skiResort.findUniqueOrThrow({
      where: { ResortId: result.resortReads.resortId },
    });
    assert(managedResort.DeletedAt);
    assert.equal(managedResort.MerchantId, a!.merchantId);
    assert.equal(managedResort.Name, 'HTTP雪场完整流程');
    assert.equal(managedResort.Description, 'HTTP雪场复审后介绍');
    assert.equal(managedResort.Price, 188);
    assert.equal(managedResort.Status, 'pending_review');
    assert.deepEqual(managedResort.CustomFields, {});
    assert.equal(managedResort.CoverAssetId, null);
    assert.equal(
      await prisma.resortImage.count({
        where: { ResortId: managedResort.ResortId },
      }),
      0,
    );
    assert.equal(
      await prisma.resortFitTag.count({
        where: { ResortId: managedResort.ResortId },
      }),
      0,
    );
    const resortEvents = await prisma.outboxEvent.findMany({
      where: {
        AggregateType: 'ski_resort',
        AggregateId: String(managedResort.ResortId),
      },
    });
    assert.equal(resortEvents.length, 8);
    assert.deepEqual(
      resortEvents
        .map((event) => (event.Payload as { status: string }).status)
        .sort(),
      [
        'draft',
        'pending_review',
        'published',
        'pending_review',
        'published',
        'offline',
        'pending_review',
        'deleted',
      ].sort(),
    );
    for (const event of resortEvents) {
      assert.equal(event.EventType, 'resort.changed.v1');
      assert.equal(event.Status, 'pending');
      assert.deepEqual(event.Payload, {
        resortId: managedResort.ResortId,
        merchantId: a!.merchantId,
        status: (event.Payload as { status: string }).status,
      });
    }
    const resortAudits = await prisma.operationLog.findMany({
      where: {
        ResourceKey: 'resort',
        TargetId: String(managedResort.ResortId),
      },
    });
    assert.equal(resortAudits.length, 8);
    assert.deepEqual(
      resortAudits.map((log) => log.ActionKey).sort(),
      [
        'resort:merchant:create',
        'resort:merchant:submit-review',
        'content:resort:publish',
        'resort:merchant:update',
        'content:resort:publish',
        'content:resort:offline',
        'resort:merchant:submit-review',
        'resort:merchant:delete',
      ].sort(),
    );
    for (const log of resortAudits) {
      assert.equal(log.Result, 'success');
      assert.equal(
        log.ActorAccountSnapshot,
        log.ActionKey.startsWith('resort:merchant:')
          ? a!.account
          : fixture.adminAccount,
      );
    }
    assert.equal(
      await prisma.role.count({
        where: { RoleKey: { startsWith: 'http_auth_' } },
      }),
      4,
    );
    assert.deepEqual(
      (
        await prisma.userRole.findMany({
          where: { UserId: a!.userId },
          orderBy: { RoleId: 'asc' },
        })
      ).map((row) => row.RoleId),
      [result.readRoleId],
    );
    assert.equal(
      await prisma.roleFieldPermission.count({
        where: { RoleId: result.writeRoleId },
      }),
      0,
    );
    assert.equal(
      await prisma.operationLog.count({
        where: { TraceId: { in: result.rejectedTraceIds } },
      }),
      0,
    );
    assert.equal(
      await prisma.operationLog.count({
        where: {
          ActionKey: 'resort:merchant:update',
          TargetId: String(a!.resortId),
        },
      }),
      1,
    );
    assert.equal(
      await prisma.operationLog.count({
        where: {
          ActionKey: 'system:permission:assign',
          TargetId: String(result.writeRoleId),
        },
      }),
      2,
    );
    assert.equal(
      await prisma.outboxEvent.count({
        where: { AggregateType: 'ski_resort' },
      }),
      15,
    );
    assert.equal(
      await prisma.outboxEvent.count({
        where: {
          AggregateType: 'ski_resort',
          AggregateId: String(a!.resortId),
        },
      }),
      1,
    );
    assert.equal(
      await prisma.outboxEvent.count({
        where: {
          AggregateType: 'ski_resort',
          AggregateId: String(b!.resortId),
        },
      }),
      0,
    );
    const ragEvents = await prisma.outboxEvent.findMany({
      where: {
        AggregateType: 'RagDocument',
        AggregateId: String(fixture.rag.documentId),
      },
    });
    assert.equal(ragEvents.length, 4);
    const articleCategory = await prisma.dictionaryItem.findUniqueOrThrow({
      where: {
        DictType_Value: {
          DictType: 'knowledge.article_category',
          Value: 'http_beginner',
        },
      },
    });
    const articleCategoryEvents = await prisma.outboxEvent.findMany({
      where: {
        AggregateType: 'DictionaryItem',
        AggregateId: `knowledge.article_category:${articleCategory.ItemId}`,
      },
    });
    assert.equal(articleCategoryEvents.length, 1);
    assert.equal(articleCategoryEvents[0]!.EventType, 'dictionary.changed.v1');
    assert.equal(articleCategoryEvents[0]!.Status, 'pending');
    assert.deepEqual(articleCategoryEvents[0]!.Payload, {
      dictType: 'knowledge.article_category',
      itemId: articleCategory.ItemId,
    });
    assert.deepEqual(result.communityReads, {
      dynamicId: result.communityReads.dynamicId,
      commentId: result.communityReads.commentId,
      published: true,
      reapproved: true,
      commentsModerated: true,
      revocationRejected: true,
      deleted: true,
    });
    const moderatedDynamic = await prisma.dynamic.findUniqueOrThrow({
      where: { DynamicId: result.communityReads.dynamicId },
    });
    const moderatedComment = await prisma.comment.findUniqueOrThrow({
      where: { CommentId: result.communityReads.commentId },
    });
    const communityAdmin = await prisma.user.findUniqueOrThrow({
      where: { Account: fixture.adminAccount },
    });
    assert.equal(await prisma.dynamic.count(), 1);
    assert.equal(await prisma.comment.count(), 1);
    assert(
      moderatedDynamic.DeletedAt &&
        moderatedDynamic.ModeratedAt &&
        moderatedComment.DeletedAt &&
        moderatedComment.ModeratedAt,
    );
    assert.equal(moderatedDynamic.AuthorId, a!.userId);
    assert.equal(moderatedDynamic.Content, 'HTTP社区复审后内容');
    assert.equal(moderatedDynamic.ResortId, null);
    assert.equal(moderatedDynamic.Status, 'published');
    assert.equal(moderatedDynamic.ModeratedByUserId, communityAdmin.UserId);
    assert.equal(moderatedDynamic.ModerationReason, '恢复公开');
    assert.equal(
      await prisma.dynamicImage.count({
        where: { DynamicId: moderatedDynamic.DynamicId },
      }),
      0,
    );
    assert.equal(moderatedComment.AuthorId, a!.userId);
    assert.equal(moderatedComment.DynamicId, moderatedDynamic.DynamicId);
    assert.equal(moderatedComment.Content, 'HTTP评论审核内容');
    assert.equal(moderatedComment.Status, 'visible');
    assert.equal(moderatedComment.ModeratedByUserId, a!.userId);
    assert.equal(moderatedComment.ModerationReason, '评论恢复');
    const dynamicEvents = await prisma.outboxEvent.findMany({
      where: { AggregateType: 'Dynamic' },
    });
    assert.equal(dynamicEvents.length, 7);
    assert(
      dynamicEvents.every(
        (event) =>
          event.EventType === 'dynamic.changed.v1' &&
          event.Status === 'pending' &&
          event.AggregateId === String(moderatedDynamic.DynamicId),
      ),
    );
    for (const event of dynamicEvents)
      assert.deepEqual(event.Payload, {
        dynamicId: moderatedDynamic.DynamicId,
      });
    const communityAudits = await prisma.operationLog.findMany({
      where: { ResourceKey: 'community' },
    });
    assert.equal(communityAudits.length, 8);
    assert.deepEqual(
      communityAudits
        .map((log) => [
          log.ActionKey,
          log.ActorAccountSnapshot,
          log.Reason,
          log.TargetType,
          log.TargetId,
        ])
        .sort(),
      [
        [
          'community.dynamic.approve',
          a!.account,
          '首次审核',
          'Dynamic',
          String(moderatedDynamic.DynamicId),
        ],
        [
          'community.dynamic.approve',
          fixture.adminAccount,
          '复审通过',
          'Dynamic',
          String(moderatedDynamic.DynamicId),
        ],
        [
          'community.dynamic.hide',
          fixture.adminAccount,
          '隐藏核对',
          'Dynamic',
          String(moderatedDynamic.DynamicId),
        ],
        [
          'community.dynamic.restore',
          fixture.adminAccount,
          '恢复公开',
          'Dynamic',
          String(moderatedDynamic.DynamicId),
        ],
        [
          'community.dynamic.delete',
          fixture.adminAccount,
          null,
          'Dynamic',
          String(moderatedDynamic.DynamicId),
        ],
        [
          'community.comment.hide',
          a!.account,
          '评论隐藏',
          'Comment',
          String(moderatedComment.CommentId),
        ],
        [
          'community.comment.restore',
          a!.account,
          '评论恢复',
          'Comment',
          String(moderatedComment.CommentId),
        ],
        [
          'community.comment.delete',
          a!.account,
          null,
          'Comment',
          String(moderatedComment.CommentId),
        ],
      ].sort(),
    );
    assert(
      communityAudits.every(
        (log) => log.Result === 'success' && log.Metadata && log.TraceId,
      ),
    );
    assert.equal(await prisma.outboxEvent.count(), 53);
    assert.deepEqual(result.assetReads, {
      scopeIsolation: true,
      referencesProtected: true,
      deleted: true,
      revocationRejected: true,
    });
    const finalAssets = await prisma.asset.findMany({
      orderBy: { AssetId: 'asc' },
    });
    assert.equal(finalAssets.length, 3);
    assert.deepEqual(
      finalAssets.map((row) => [
        String(row.AssetId),
        row.OwnerUserId,
        row.Status,
        row.StorageKey,
        row.SizeBytes.toString(),
      ]),
      [
        [
          fixture.assets.removableId,
          a!.userId,
          'deleted',
          `http-assets/private-${fixture.assets.removableId}.png`,
          '2048',
        ],
        [
          fixture.assets.ownId,
          a!.userId,
          'ready',
          `http-assets/private-${fixture.assets.ownId}.png`,
          '2048',
        ],
        [
          fixture.assets.foreignId,
          b!.userId,
          'ready',
          `http-assets/private-${fixture.assets.foreignId}.png`,
          '2048',
        ],
      ],
    );
    const assetAudits = await prisma.operationLog.findMany({
      where: { ResourceKey: 'asset' },
    });
    assert.equal(assetAudits.length, 1);
    assert.equal(assetAudits[0]!.ActionKey, 'content:asset:delete');
    assert.equal(assetAudits[0]!.ActorUserId, a!.userId);
    assert.equal(assetAudits[0]!.TargetId, fixture.assets.removableId);
    assert.equal(assetAudits[0]!.Result, 'success');
    const profileAudits = await prisma.operationLog.findMany({
      where: { ActionKey: 'account:profile:update' },
    });
    assert.equal(profileAudits.length, 2);
    assert(
      profileAudits.every(
        (log) => log.ActorUserId === a!.userId && log.Result === 'success',
      ),
    );
    assert.equal(
      (await prisma.user.findUniqueOrThrow({ where: { UserId: a!.userId } }))
        .AvatarAssetId,
      null,
    );
    const revenueRows = await prisma.resortRevenueRecord.findMany({
      orderBy: { ResortId: 'asc' },
    });
    const revenueCreator = (
      await prisma.user.findUniqueOrThrow({
        where: { Account: fixture.adminAccount },
      })
    ).UserId;
    assert.equal(revenueRows.length, 2);
    assert.deepEqual(
      revenueRows.map((row) => [
        row.ResortId,
        row.RevenueAmount.toFixed(2),
        row.Source,
        row.CreatedBy,
        row.Note,
      ]),
      fixture.actors.map((actor, index) => [
        actor.resortId,
        index === 0 ? '123.45' : '678.90',
        'manual',
        revenueCreator,
        '合成工作台联调数据',
      ]),
    );
    assert.equal(result.dashboard.admin.revenue.amount, '802.35');
    assert.equal(result.dashboard.admin.revenue.scope, 'all');
    assert.equal(result.dashboard.admin.users.total, 3);
    assert.equal(result.dashboard.admin.merchants.total, 2);
    assert.equal(result.dashboard.merchant.revenue.amount, '123.45');
    assert.equal(result.dashboard.merchant.revenue.scope, 'merchant');
    assert.equal(result.dashboard.merchant.users.total, 1);
    assert.equal(result.dashboard.merchant.merchants.total, 1);
    assert.equal(result.dashboard.merchant.rag, null);
    assert.deepEqual(result.merchantOverview.resortIds, [a!.resortId]);
    assert.deepEqual(result.merchantOverview.recordResortIds, [a!.resortId]);
    assert.equal(result.merchantOverview.amount, '123.45');
    assert.equal(result.merchantOverview.foreignDenied, true);
    assert.equal(result.merchantOverview.revocationRejected, true);
    assert.equal(result.merchantOverview.independentPanels, true);
    assert.equal(result.merchantRevenue.amount, '123.45');
    assert.equal(result.merchantRevenue.total, 1);
    assert.deepEqual(result.merchantRevenue.recordResortIds, [a!.resortId]);
    for (const key of [
      'emptyPage',
      'emptyRange',
      'foreignDenied',
      'revocationRejected',
      'scopeConflictDenied',
    ] as const)
      assert.equal(result.merchantRevenue[key], true);
    for (const [key, value] of Object.entries(result.dashboard.portalOnly))
      if (key !== 'generatedAt') assert.equal(value, null);
    assert.deepEqual(result.knowledgeReads, {
      rawProjection: true,
      emptyPage: true,
      sessionRevocationRejected: true,
      sessionRestored: true,
    });
    assert.deepEqual(result.dictionaryWrites, {
      rootId: result.dictionaryWrites.rootId,
      childId: result.dictionaryWrites.childId,
      lifecycle: true,
      cycleRejected: true,
      revocationRejected: true,
    });
    assert.deepEqual(result.configChecks, {
      defaults: true,
      versionConflict: true,
      unknownRecovered: true,
      publicProjection: true,
      roleDenied: true,
      sessionRevocationRejected: true,
      sessionRestored: true,
    });
    const configRows = await prisma.systemConfig.findMany({
      orderBy: { ConfigKey: 'asc' },
    });
    assert.equal(configRows.length, 2);
    const configAdmin = await prisma.user.findUniqueOrThrow({
      where: { Account: fixture.adminAccount },
    });
    const configName = configRows.find((row) => row.ConfigKey === 'site.name')!;
    const configPolicy = configRows.find(
      (row) => row.ConfigKey === 'site.privacyPolicy',
    )!;
    assert(configName && configPolicy);
    assert.equal(configName.Value, 'HTTP凛迹雪客更新');
    assert.equal(configName.Version, 2);
    assert.equal(configPolicy.Value, '<b>HTTP合成政策</b>\n用于隔离验证');
    assert.equal(configPolicy.Version, 1);
    assert(
      configRows.every(
        (row) =>
          row.Status === 'active' && row.UpdatedByUserId === configAdmin.UserId,
      ),
    );
    const configAudits = await prisma.operationLog.findMany({
      where: { ResourceKey: 'system-config' },
      orderBy: { OperationLogId: 'asc' },
    });
    assert.equal(configAudits.length, 3);
    assert(
      configAudits.every(
        (log) =>
          log.ActorUserId === configAdmin.UserId &&
          log.ActorAccountSnapshot === fixture.adminAccount &&
          log.Result === 'success' &&
          log.ActionKey === 'system:config:update' &&
          log.TargetType === 'SystemConfig',
      ),
    );
    assert.deepEqual(
      configAudits.map((log) => [log.TargetId, log.Metadata]),
      [
        [
          'site.name',
          { configKey: 'site.name', beforeVersion: 0, afterVersion: 1 },
        ],
        [
          'site.name',
          { configKey: 'site.name', beforeVersion: 1, afterVersion: 2 },
        ],
        [
          'site.privacyPolicy',
          {
            configKey: 'site.privacyPolicy',
            beforeVersion: 0,
            afterVersion: 1,
          },
        ],
      ],
    );
    const workflowType = await prisma.dictionaryType.findUniqueOrThrow({
      where: { DictType: 'http.dictionary_workflow' },
      include: { Items: { orderBy: { ItemId: 'asc' } } },
    });
    assert.equal(workflowType.DictName, 'HTTP字典流程已更新');
    assert.equal(workflowType.GroupKey, 'http_dictionary');
    assert.equal(workflowType.Status, 'disabled');
    assert.equal(workflowType.PubliclyReadable, true);
    assert.equal(workflowType.Items.length, 2);
    const [workflowRoot, workflowChild] = workflowType.Items;
    assert.equal(workflowRoot!.ItemId, result.dictionaryWrites.rootId);
    assert.equal(workflowRoot!.ParentId, null);
    assert.equal(workflowRoot!.Label, '父项已更新');
    assert.equal(workflowRoot!.Value, 'root');
    assert.equal(workflowRoot!.Status, 'active');
    assert.equal(workflowChild!.ItemId, result.dictionaryWrites.childId);
    assert.equal(workflowChild!.ParentId, workflowRoot!.ItemId);
    assert.equal(workflowChild!.Label, '子项已更新');
    assert.equal(workflowChild!.Value, 'child_edited');
    assert.equal(workflowChild!.Color, '#CCFFCC');
    assert.equal(workflowChild!.Status, 'disabled');
    const workflowEvents = await prisma.outboxEvent.findMany({
      where: {
        AggregateType: 'DictionaryItem',
        AggregateId: { startsWith: 'http.dictionary_workflow:' },
      },
    });
    assert.equal(workflowEvents.length, 10);
    for (const [itemId, count] of [
      [workflowRoot!.ItemId, 4],
      [workflowChild!.ItemId, 6],
    ]) {
      const events = workflowEvents.filter(
        (event) => event.AggregateId === `http.dictionary_workflow:${itemId}`,
      );
      assert.equal(events.length, count);
      for (const event of events) {
        assert.equal(event.Status, 'pending');
        assert.equal(event.EventType, 'dictionary.changed.v1');
        assert.equal(
          (event.Payload as Record<string, unknown>).dictType,
          'http.dictionary_workflow',
        );
        assert.equal((event.Payload as Record<string, unknown>).itemId, itemId);
      }
    }
    const workflowAudits = await prisma.operationLog.findMany({
      where: {
        ResourceKey: 'system:dict',
        OR: [
          {
            TargetType: 'DictionaryType',
            TargetId: 'http.dictionary_workflow',
          },
          {
            TargetType: 'DictionaryItem',
            TargetId: {
              in: [String(workflowRoot!.ItemId), String(workflowChild!.ItemId)],
            },
          },
        ],
      },
    });
    assert.equal(workflowAudits.length, 8);
    assert(
      workflowAudits.every(
        (log) =>
          log.Result === 'success' &&
          log.ActorUserId === fixture.actors[0]!.userId &&
          log.ActorAccountSnapshot === fixture.actors[0]!.account,
      ),
    );
    assert.deepEqual(
      workflowAudits.map((log) => log.ActionKey).sort(),
      [
        'system:dict:create',
        'system:dict:update',
        'system:dict:delete',
        'system:dict:item:create',
        'system:dict:item:create',
        'system:dict:item:update',
        'system:dict:item:update',
        'system:dict:item:delete',
      ].sort(),
    );
    const managedKnowledge = await prisma.projectKnowledge.findUniqueOrThrow({
      where: { ProjectKnowledgeId: result.knowledge.id },
    });
    assert.equal(await prisma.projectKnowledge.count(), 3);
    assert.equal(managedKnowledge.Title, 'HTTP知识联调定版');
    assert.equal(
      managedKnowledge.Content,
      'HTTP项目知识已发布修订正文，介绍滑雪服务。',
    );
    assert.equal(managedKnowledge.Category, 'platform');
    assert.equal(managedKnowledge.SourceUrl, null);
    assert.equal(managedKnowledge.Status, 'published');
    assert.equal(managedKnowledge.Version, 7);
    assert(managedKnowledge.DeletedAt instanceof Date);
    assert.equal(
      managedKnowledge.PublishTime!.toISOString(),
      result.knowledge.firstPublishTime,
    );
    const knowledgeEvents = await prisma.outboxEvent.findMany({
      where: {
        AggregateType: 'project_doc',
        AggregateId: String(result.knowledge.id),
      },
      orderBy: [{ CreatedAt: 'asc' }, { EventId: 'asc' }],
    });
    assert.equal(knowledgeEvents.length, 7);
    assert.deepEqual(
      knowledgeEvents.map(
        (event) => (event.Payload as { status: string }).status,
      ),
      [
        'draft',
        'draft',
        'published',
        'published',
        'withdrawn',
        'published',
        'deleted',
      ],
    );
    for (const event of knowledgeEvents) {
      assert.equal(event.EventType, 'project_doc.changed.v1');
      assert.equal(event.Status, 'pending');
      assert.equal(event.Attempts, 0);
      assert.deepEqual(event.Payload, {
        projectKnowledgeId: result.knowledge.id,
        status: (event.Payload as { status: string }).status,
      });
    }
    const knowledgeAudits = await prisma.operationLog.findMany({
      where: {
        TargetType: 'ProjectKnowledge',
        TargetId: String(result.knowledge.id),
      },
      orderBy: { OperationLogId: 'asc' },
    });
    assert.deepEqual(
      knowledgeAudits.map((log) => log.ActionKey),
      [
        'create',
        'update',
        'publish',
        'update',
        'withdraw',
        'publish',
        'delete',
      ].map((action) => `content:project-knowledge:${action}`),
    );
    for (const [index, entry] of knowledgeAudits.entries()) {
      assert.equal(entry.ActorAccountSnapshot, fixture.adminAccount);
      assert.equal(entry.Result, 'success');
      assert.equal(entry.ResourceKey, 'content:project-knowledge');
      const metadata = entry.Metadata as {
        before: { version: number } | null;
        after: { version?: number; deleted?: boolean };
      };
      if (index === 0) assert.equal(metadata.before, null);
      else {
        assert.equal(metadata.before!.version, index);
        assert.equal(metadata.after.version, index + 1);
      }
      assert(!JSON.stringify(metadata).includes('修订正文'));
    }
    assert.equal(
      (knowledgeAudits[6]!.Metadata as { after: { deleted: boolean } }).after
        .deleted,
      true,
    );
    const retried = await prisma.outboxEvent.findUniqueOrThrow({
      where: { EventId: fixture.retryEventId },
    });
    assert.equal(retried.Status, 'pending');
    assert.equal(retried.Attempts, 5);
    assert.equal(retried.MaxAttempts, 13);
    assert.equal(retried.LockedAt, null);
    assert.equal(retried.LockToken, null);
    assert.equal(retried.PublishedAt, null);
    assert(retried.AvailableAt.getTime() <= Date.now());
    assert.deepEqual(retried.Payload, { internal: 'HTTP联调内部事件正文' });
    assert.equal(retried.LastError, 'HTTP联调内部错误');
    const preciseTimes = await prisma.$queryRaw<
      { createdAt: string; occurredAt: string }[]
    >`
      SELECT to_char("CreatedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS "createdAt",
             to_char("OccurredAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS "occurredAt"
      FROM "OutboxEvent" WHERE "EventId" = ${fixture.retryEventId}::uuid
    `;
    assert.deepEqual(preciseTimes, [
      {
        createdAt: '2026-11-03T01:00:00.123456',
        occurredAt: '2026-11-03T01:00:00.123456',
      },
    ]);
    const retryAudits = await prisma.operationLog.findMany({
      where: { ActionKey: 'system:event:retry' },
    });
    assert.equal(retryAudits.length, 1);
    assert.equal(retryAudits[0]!.TargetId, fixture.retryEventId);
    assert.equal(retryAudits[0]!.Reason, 'HTTP内容事件人工重试');
    assert.equal(retryAudits[0]!.ActorAccountSnapshot, fixture.adminAccount);
    assert.deepEqual(retryAudits[0]!.Metadata, {
      before: { status: 'failed', attempts: 5, maxAttempts: 5 },
      after: {
        status: 'pending',
        attempts: 5,
        maxAttempts: 13,
        availableAt: retried.AvailableAt.toISOString(),
      },
    });
    assert.equal(new Set(result.rag.eventIds).size, 4);
    assert.deepEqual(
      ragEvents.map((row) => row.EventId).sort(),
      [...result.rag.eventIds].sort(),
    );
    assert.deepEqual(
      ragEvents
        .map(
          (row) => (row.Payload as { controlVersion: number }).controlVersion,
        )
        .sort((a, b) => a - b),
      [2, 4, 5, 7],
    );
    for (const event of ragEvents) {
      assert.equal(event.EventType, 'rag.source.reindex-requested.v1');
      assert.equal(event.Status, 'pending');
      assert.equal(event.Attempts, 0);
      assert.deepEqual(event.Payload, {
        ragDocumentId: fixture.rag.documentId,
        sourceKey: `project:${fixture.rag.projectKnowledgeId}`,
        sourceType: 'project_doc',
        sourceId: fixture.rag.projectKnowledgeId,
        controlVersion: (event.Payload as { controlVersion: number })
          .controlVersion,
      });
    }
    assert.equal(await prisma.ragDocument.count(), 3);
    assert.equal(await prisma.ragChunk.count(), 0);
    const source = await prisma.ragDocument.findUniqueOrThrow({
      where: { RagDocumentId: fixture.rag.documentId },
    });
    assert.equal(source.ControlVersion, 7);
    assert.equal(source.IndexGeneration, 6n);
    assert.equal(source.ManualDisabled, false);
    assert.equal(source.Status, 'pending');
    assert.equal(source.IndexedAt, null);
    const failed = await prisma.ragDocument.findUniqueOrThrow({
      where: { RagDocumentId: fixture.rag.failedDocumentId },
    });
    assert.equal(failed.ControlVersion, 1);
    assert.equal(failed.IndexGeneration, 0n);
    assert.equal(failed.Status, 'failed');
    assert.equal(failed.ManualDisabled, false);
    const excluded = await prisma.ragDocument.findUniqueOrThrow({
      where: { RagDocumentId: fixture.rag.excludedDocumentId },
    });
    assert.equal(excluded.ControlVersion, 1);
    assert.equal(excluded.IndexGeneration, 0n);
    assert.equal(excluded.Content, 'RAG联调内部收益');
    assert.equal(excluded.Status, 'pending');
    const knowledge = await prisma.projectKnowledge.findUniqueOrThrow({
      where: { ProjectKnowledgeId: fixture.rag.projectKnowledgeId },
    });
    assert.equal(knowledge.Status, 'published');
    assert.equal(knowledge.Content, '公开合成滑雪项目服务说明，用于隔离联调。');
    assert.equal(knowledge.Version, 1);
    const controls = await prisma.operationLog.findMany({
      where: {
        TargetType: 'RagDocument',
        TargetId: String(fixture.rag.documentId),
      },
      orderBy: { OperationLogId: 'asc' },
    });
    assert(
      ['HTTP RAG并发启用A', 'HTTP RAG并发启用B'].includes(
        result.rag.concurrentWinnerReason,
      ),
    );
    assert.deepEqual(
      controls.map((row) => row.Reason),
      [
        'HTTP RAG重建',
        'HTTP RAG停用',
        'HTTP RAG启用',
        'HTTP RAG丢响应',
        'HTTP RAG核对后停用',
        result.rag.concurrentWinnerReason,
      ],
    );
    assert.deepEqual(
      controls.map((row) => row.ActionKey),
      [
        'ai:knowledge:reindex',
        'ai:knowledge:disable',
        'ai:knowledge:disable',
        'ai:knowledge:reindex',
        'ai:knowledge:disable',
        'ai:knowledge:disable',
      ],
    );
    for (const [index, entry] of controls.entries()) {
      assert.equal(entry.ActorAccountSnapshot, fixture.adminAccount);
      assert.equal(entry.Result, 'success');
      const metadata = entry.Metadata as {
        beforeControlVersion: number;
        afterControlVersion: number;
        eventId: string | null;
      };
      assert.equal(metadata.beforeControlVersion, index + 1);
      assert.equal(metadata.afterControlVersion, index + 2);
      assert.equal(
        metadata.eventId,
        ragEvents.find(
          (event) =>
            (event.Payload as { controlVersion: number }).controlVersion ===
            index + 2,
        )?.EventId ?? null,
      );
    }
    assert.equal(
      await prisma.operationLog.count({
        where: { Reason: 'HTTP RAG同状态启用' },
      }),
      0,
    );
    assert.equal(await prisma.consumedEvent.count(), 0);
    assert.equal(await prisma.aiConversation.count(), 4);
    assert.equal(
      await prisma.aiConversation.count({
        where: { DeletedAt: { not: null } },
      }),
      1,
    );
    assert.equal(await prisma.aiMessage.count(), 2);
    const accessLogs = await prisma.operationLog.findMany({
      where: { ActionKey: 'ai:conversation:read-content' },
    });
    assert.equal(accessLogs.length, 1);
    assert.equal(accessLogs[0]!.ActorUserId, a!.userId);
    assert.equal(accessLogs[0]!.TargetId, fixture.audit.activeId);
    assert.equal(accessLogs[0]!.Reason, 'HTTP审计人工核对');
    assert.deepEqual(accessLogs[0]!.Metadata, { userId: a!.userId });
    assert(
      !JSON.stringify(
        accessLogs.map((row) => [
          row.Reason,
          row.Metadata,
          row.TargetId,
          row.ActorAccountSnapshot,
        ]),
      ).includes('审计联调私密'),
    );
    const messages = await prisma.aiMessage.findMany({
      where: { ConversationId: fixture.audit.activeId },
      orderBy: { MessageId: 'asc' },
    });
    assert.equal(messages[0]!.Content, '审计联调私密问题');
    assert.equal(messages[1]!.Content, '审计联调私密回复');
    assert.deepEqual(messages[1]!.Citations, [
      { sourceKey: 'article:17', title: '历史引用' },
    ]);
    const dictionaryItems = await prisma.dictionaryItem.findMany({
      where: { DictType: 'resort.fit_tag' },
      orderBy: { ItemId: 'asc' },
    });
    assert.equal(dictionaryItems.length, 2);
    assert.equal(dictionaryItems[0]!.Value, 'http_root');
    assert.equal(dictionaryItems[1]!.ParentId, dictionaryItems[0]!.ItemId);
    assert.equal(dictionaryItems[1]!.Status, 'disabled');
    assert.equal(
      await prisma.authSession.count({ where: { RevokedAt: null } }),
      0,
    );
    const admin = await prisma.user.findUniqueOrThrow({
      where: { Account: fixture.adminAccount },
    });
    assert.equal(admin.Status, 'active');
    assert.equal(
      await prisma.role.count({
        where: {
          SystemRoleCode: 'system_admin',
          UserRoles: { some: { UserId: admin.UserId } },
        },
      }),
      1,
    );
    console.info(
      'Verified exact resort write, RAG version/chunk lifecycle, four pending RAG events and six control audits, denied-operation audit absence and revoked sessions',
    );
  } else throw new Error('Expected prepare or verify');
} finally {
  await prisma.$disconnect();
}
