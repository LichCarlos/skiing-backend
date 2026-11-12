import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaService } from '../src/shared/persistence/prisma.service.js';
import { PrismaRagCandidateRetriever } from '../src/modules/ai-assistant/infrastructure/prisma-rag-candidate-retriever.js';

// Executes the actual CLI in child processes. Successful vectors always come
// from the configured real provider; only the failure case injects one HTTP 503.
describe('real RAG backfill CLI / PostgreSQL / BGE-M3', () => {
  const prisma = new PrismaService();
  const key = `backfill-${randomUUID().slice(0, 8)}`;
  const root = fileURLToPath(new URL('../', import.meta.url));
  const require = createRequire(import.meta.url);
  const results: Record<string, unknown>[] = [];
  const commands: Record<string, unknown>[] = [];
  let gate: Server | undefined, gateUrl: string, output: string;
  let calls = 0,
    forwarded = 0,
    failures = 0;
  let failAt = -1,
    beforeForward: (() => Promise<void>) | undefined;
  let gateError: unknown;
  let userId: number, resortId: number, articleId: number, dynamicId: number;
  let projectId: number, secondProjectId: number, thirdProjectId: number;
  let newProjectId: number, parentId: number;
  let queryVector: number[];
  let expectedKeys: string[];

  beforeAll(async () => {
    if (
      process.env.LINJI_RAG_BACKFILL_CONFIRM !== 'linji_rag_backfill_validation'
    )
      throw new Error('Explicit disposable backfill validation required');
    const database = new URL(process.env.DATABASE_URL ?? '');
    if (
      !['localhost', '127.0.0.1'].includes(database.hostname) ||
      database.pathname !== '/linji_rag_backfill_validation'
    )
      throw new Error('Dedicated loopback backfill database required');
    const provider = new URL(process.env.EMBEDDING_BASE_URL ?? '');
    if (
      !['localhost', '127.0.0.1'].includes(provider.hostname) ||
      !process.env.EMBEDDING_API_KEY ||
      !process.env.EMBEDDING_MODEL
    )
      throw new Error('Explicit real local embedding provider required');
    const configured = process.env.LINJI_RAG_BACKFILL_OUTPUT;
    if (!configured || !isAbsolute(configured))
      throw new Error('Absolute independent output required');
    const repository = await realpath(root);
    const outside = (path: string) => {
      const rel = relative(repository, path);
      return rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel);
    };
    output = resolve(configured);
    if (!outside(output)) throw new Error('Output must be outside repository');
    await mkdir(output, { recursive: true });
    output = await realpath(output);
    if (!outside(output)) throw new Error('Output resolves inside repository');
    await prisma.$connect();
    expect(await prisma.user.count()).toBe(1);
    for (const count of await Promise.all([
      prisma.ragDocument.count(),
      prisma.skiResort.count(),
      prisma.article.count(),
      prisma.projectKnowledge.count(),
      prisma.dynamic.count(),
      prisma.dictionaryItem.count(),
      prisma.consumedEvent.count(),
      prisma.outboxEvent.count(),
    ]))
      expect(count).toBe(0);
    gate = createServer(async (req, res) => {
      try {
        if (req.method !== 'POST' || req.url !== '/v1/embeddings') {
          res.writeHead(404).end();
          return;
        }
        if (
          req.headers.authorization !==
          `Bearer ${process.env.EMBEDDING_API_KEY}`
        ) {
          res.writeHead(401).end();
          return;
        }
        calls++;
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        if (calls === failAt) {
          failures++;
          res.writeHead(503, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({ error: 'synthetic-private-provider-detail' }),
          );
          return;
        }
        const callback = beforeForward;
        beforeForward = undefined;
        await callback?.();
        const response = await fetch(
          `${provider.href.replace(/\/$/u, '')}/embeddings`,
          {
            method: 'POST',
            redirect: 'error',
            headers: {
              'content-type': 'application/json',
              authorization: req.headers.authorization!,
            },
            body: Buffer.concat(chunks),
            signal: AbortSignal.timeout(120_000),
          },
        );
        const body = await response.text();
        expect(response.status).toBe(200);
        const payload = JSON.parse(body) as { data: { embedding: number[] }[] };
        for (const { embedding } of payload.data) {
          expect(embedding).toHaveLength(1024);
          expect(embedding.every(Number.isFinite)).toBe(true);
          expect(
            Math.sqrt(embedding.reduce((sum, n) => sum + n * n, 0)),
          ).toBeCloseTo(1, 4);
        }
        queryVector ??= payload.data[0]!.embedding;
        forwarded++;
        res.writeHead(response.status, { 'content-type': 'application/json' });
        res.end(body);
      } catch (error) {
        gateError = error;
        res.writeHead(502).end('Validation gate failed');
      }
    });
    await new Promise<void>((yes, no) => {
      gate!.once('error', no);
      gate!.listen(0, '127.0.0.1', yes);
    });
    const address = gate.address();
    if (!address || typeof address === 'string')
      throw new Error('Missing gate port');
    gateUrl = `http://127.0.0.1:${address.port}/v1`;
  });

  afterAll(async () => {
    if (output) {
      await writeFile(
        join(output, 'backfill-results.json'),
        JSON.stringify(
          {
            results,
            commands,
            calls,
            forwarded,
            failures,
            model: process.env.EMBEDDING_MODEL,
            chatCalls: 0,
            gateError: gateError
              ? 'Real forwarding failed; see test log'
              : null,
          },
          null,
          2,
        ),
      );
    }
    if (gate) {
      gate.closeAllConnections();
      await new Promise<void>((yes, no) =>
        gate!.close((error) => (error ? no(error) : yes())),
      );
    }
    await prisma.$disconnect();
  });

  it('prints help and rejects invalid options before any database or provider access', async () => {
    expect((await cli('help', ['--help'], false)).stdout).toContain(
      '--after-id',
    );
    const invalid = await cli('invalid', ['--source', 'revenue'], false, 1);
    expect(invalid.stderr).toContain('Check options');
    expect(calls).toBe(0);
    expect(await prisma.consumedEvent.count()).toBe(0);
    results.push({ id: 'B01', noProviderOrInboxAccess: true });
  });

  it('backfills five public source types, rejecting draft, pending and private controls', async () => {
    userId = (
      await prisma.user.create({
        data: {
          Account: key,
          PasswordHash: 'not-a-login-credential',
          Nickname: '合成回填作者',
        },
      })
    ).UserId;
    await prisma.dictionaryType.createMany({
      data: [
        {
          DictType: key,
          DictName: '合成安全装备',
          GroupKey: 'validation',
          PubliclyReadable: true,
        },
        {
          DictType: `${key}-private`,
          DictName: '合成内部资料',
          GroupKey: 'validation',
        },
      ],
    });
    const category = await prisma.dictionaryItem.create({
      data: {
        DictType: 'knowledge.article_category',
        Value: key,
        Label: '合成基础知识',
      },
    });
    parentId = (
      await prisma.dictionaryItem.create({
        data: {
          DictType: key,
          Value: 'safety',
          Label: '安全准备',
        },
      })
    ).ItemId;
    await prisma.dictionaryItem.createMany({
      data: [
        {
          DictType: key,
          Value: 'helmet',
          Label: '佩戴头盔',
          ParentId: parentId,
        },
        {
          DictType: `${key}-private`,
          Value: 'private',
          Label: '不可公开的合成内容',
        },
      ],
    });
    resortId = (
      await prisma.skiResort.create({
        data: {
          Name: '合成回填雪场',
          Price: 180,
          LegacyDistance: 0,
          SnowCondition: '合成压雪',
          Description: '合成回填雪场提供初学雪道。',
          Status: 'published',
        },
      })
    ).ResortId;
    await prisma.skiResort.create({
      data: {
        Name: '合成草稿雪场',
        Price: 100,
        LegacyDistance: 0,
        SnowCondition: '合成',
        Description: '未发布',
      },
    });
    articleId = (
      await prisma.article.create({
        data: {
          Title: '合成基础护具',
          Summary: '合成头盔知识',
          Body: '初学滑雪应佩戴头盔和护目镜。',
          CategoryValue: category.Value,
          Status: 'published',
          PublishTime: new Date(),
        },
      })
    ).ArticleId;
    await prisma.article.create({
      data: {
        Title: '合成未发布知识',
        Summary: '不可公开',
        Body: '不可公开的合成草稿',
        CategoryValue: category.Value,
      },
    });
    projectId = (
      await project('合成咨询服务', '合成咨询台每天17:00结束服务。', true)
    ).ProjectKnowledgeId;
    secondProjectId = (
      await project('合成草稿项目', '未发布的合成项目说明。', false)
    ).ProjectKnowledgeId;
    dynamicId = (
      await prisma.dynamic.create({
        data: {
          AuthorId: userId,
          Content: '合成夜滑活动18:00签到。',
          Status: 'published',
          ResortId: resortId,
        },
      })
    ).DynamicId;
    await prisma.dynamic.create({
      data: { AuthorId: userId, Content: '合成待审核内容。' },
    });
    expectedKeys = [
      `resort:${resortId}`,
      `article:${articleId}`,
      `project:${projectId}`,
      `dynamic:${dynamicId}`,
      `dictionary:${key}:safety`,
      `dictionary:${key}:helmet`,
      `dictionary:knowledge.article_category:${key}`,
    ].sort();
    const run = await cli('all-initial', [
      '--source',
      'all',
      '--batch-size',
      '1',
    ]);
    expect(run.frames.at(-1)).toEqual({ processed: 12 });
    expect((await indexed()).map((row) => row.SourceKey).sort()).toEqual(
      expectedKeys,
    );
    expect(calls).toBe(7);
    expect((await search()).map((row) => row.sourceKey).sort()).toEqual(
      expectedKeys,
    );
    expect(await prisma.outboxEvent.count()).toBe(0);
    results.push({
      id: 'B02',
      processed: 12,
      publicDocuments: 7,
      allFiveTypes: true,
    });
  });

  it('repeats a complete scan without recomputing embeddings or replacing chunks', async () => {
    const before = await prisma.ragChunk.findMany({
      orderBy: { RagChunkId: 'asc' },
    });
    const start = calls;
    await cli('all-repeat', ['--source', 'all', '--batch-size', '2']);
    expect(calls).toBe(start);
    expect(
      await prisma.ragChunk.findMany({ orderBy: { RagChunkId: 'asc' } }),
    ).toEqual(before);
    expect(
      await prisma.consumedEvent.count({ where: { Status: 'completed' } }),
    ).toBe(24);
    results.push({
      id: 'B03',
      noAdditionalEmbedding: true,
      chunkIdentityPreserved: true,
    });
  });

  it('rebuilds legacy source snapshots that current retrieval excludes', async () => {
    // Pre-snapshot indexes had a different hash as well as missing metadata.
    await prisma.$executeRaw`UPDATE "RagDocument" SET "Metadata" = "Metadata" - 'sourceState', "ContentHash" = repeat('0', 64)`;
    expect(await search()).toEqual([]);
    const start = calls;
    await cli('all-legacy-repair', ['--source', 'all', '--batch-size', '2']);
    expect(calls - start).toBe(7);
    expect((await search()).map((row) => row.sourceKey).sort()).toEqual(
      expectedKeys,
    );
    results.push({ id: 'B04', legacyExcludedBeforeRepair: true, repaired: 7 });
  });

  it('stops at one provider failure, reports only successful checkpoints and resumes the failed row', async () => {
    await prisma.projectKnowledge.update({
      where: { ProjectKnowledgeId: projectId },
      data: { Content: '合成咨询台每天18:00结束服务。' },
    });
    await prisma.projectKnowledge.update({
      where: { ProjectKnowledgeId: secondProjectId },
      data: { Status: 'published', PublishTime: new Date() },
    });
    thirdProjectId = (
      await project('合成回填第三项', '合成服务提供装备咨询。', true)
    ).ProjectKnowledgeId;
    const start = calls;
    failAt = start + 2;
    const failed = await cli(
      'project-failed',
      ['--source', 'project_doc', '--batch-size', '1'],
      true,
      1,
    );
    expect(calls - start).toBe(2);
    expect(failed.frames).toEqual([
      { source: 'project_doc', lastProcessedId: projectId },
    ]);
    expect(failed.stderr).toContain(
      `RAG backfill failed: project_doc:${secondProjectId}`,
    );
    expect(failed.stderr).not.toContain('synthetic-private-provider-detail');
    expect(
      await prisma.ragDocument.findUnique({
        where: { SourceKey: `project:${thirdProjectId}` },
      }),
    ).toBeNull();
    expect(
      (
        await prisma.ragDocument.findUniqueOrThrow({
          where: { SourceKey: `project:${secondProjectId}` },
        })
      ).Status,
    ).toBe('failed');
    failAt = -1;
    const resumed = await cli('project-resumed', [
      '--source',
      'project_doc',
      '--after-id',
      String(projectId),
      '--batch-size',
      '1',
    ]);
    expect(resumed.frames).toEqual([
      { source: 'project_doc', lastProcessedId: secondProjectId },
      { source: 'project_doc', lastProcessedId: thirdProjectId },
      { processed: 2 },
    ]);
    expect(calls - start).toBe(4);
    expect(
      await prisma.ragDocument.count({
        where: { SourceType: 'project_doc', Status: 'indexed' },
      }),
    ).toBe(3);
    results.push({
      id: 'B05',
      injected503: 1,
      noAutomaticRetry: true,
      resumedFailedRow: true,
    });
  });

  it('holds a per-source high-water mark while new records arrive and picks them up on the next scan', async () => {
    await prisma.projectKnowledge.update({
      where: { ProjectKnowledgeId: projectId },
      data: { Content: '合成咨询台每天19:00结束服务。' },
    });
    beforeForward = async () => {
      newProjectId = (
        await project(
          '合成并发新增项目',
          '本次高水位之后新增的合成资料。',
          true,
        )
      ).ProjectKnowledgeId;
    };
    const bounded = await cli('project-high-water', [
      '--source',
      'project_doc',
      '--batch-size',
      '1',
    ]);
    expect(newProjectId).toBeGreaterThan(thirdProjectId);
    expect(bounded.frames.at(-1)).toEqual({ processed: 3 });
    expect(
      await prisma.ragDocument.findUnique({
        where: { SourceKey: `project:${newProjectId}` },
      }),
    ).toBeNull();
    const next = await cli('project-next-scan', [
      '--source',
      'project_doc',
      '--after-id',
      String(thirdProjectId),
    ]);
    expect(next.frames.at(-1)).toEqual({ processed: 1 });
    expect(
      (
        await prisma.ragDocument.findUniqueOrThrow({
          where: { SourceKey: `project:${newProjectId}` },
        })
      ).Status,
    ).toBe('indexed');
    results.push({
      id: 'B06',
      boundedScan: true,
      nextScanIncludesNewRecord: true,
    });
  });

  it('preserves manual disable policy while replaying current public records', async () => {
    await prisma.ragDocument.update({
      where: { SourceKey: `resort:${resortId}` },
      data: { ManualDisabled: true, ControlVersion: { increment: 1 } },
    });
    await prisma.skiResort.update({
      where: { ResortId: resortId },
      data: { Description: '合成已改动雪道，保持人工停用。' },
    });
    const before = await prisma.ragDocument.findUniqueOrThrow({
      where: { SourceKey: `resort:${resortId}` },
    });
    const start = calls;
    await cli('resort-manually-disabled', ['--source', 'resort']);
    expect(calls).toBe(start);
    const after = await prisma.ragDocument.findUniqueOrThrow({
      where: { SourceKey: before.SourceKey },
    });
    expect(after.ManualDisabled).toBe(true);
    expect(after.ControlVersion).toBe(before.ControlVersion);
    expect(
      (await search()).some((row) => row.sourceKey === before.SourceKey),
    ).toBe(false);
    results.push({ id: 'B07', manualPolicyPreserved: true, noEmbedding: true });
  });

  it('disables withdrawn and private hierarchy sources and completes only CLI Inbox records', async () => {
    await prisma.article.update({
      where: { ArticleId: articleId },
      data: { Status: 'withdrawn' },
    });
    await prisma.dynamic.update({
      where: { DynamicId: dynamicId },
      data: { Status: 'pending' },
    });
    await prisma.dictionaryItem.update({
      where: { ItemId: parentId },
      data: { Status: 'disabled' },
    });
    const start = calls;
    await cli('all-withdrawn', ['--source', 'all', '--batch-size', '1']);
    expect(calls).toBe(start);
    const disabled = [
      `article:${articleId}`,
      `dynamic:${dynamicId}`,
      `dictionary:${key}:safety`,
      `dictionary:${key}:helmet`,
    ];
    expect(
      await prisma.ragDocument.count({
        where: { SourceKey: { in: disabled }, Status: 'disabled' },
      }),
    ).toBe(4);
    expect(
      await prisma.ragChunk.count({
        where: { Document: { SourceKey: { in: disabled } } },
      }),
    ).toBe(0);
    expect(
      (await search()).some((row) => disabled.includes(row.sourceKey)),
    ).toBe(false);
    expect(
      await prisma.consumedEvent.count({
        where: { Status: { not: 'completed' } },
      }),
    ).toBe(1);
    expect(await prisma.outboxEvent.count()).toBe(0);
    expect(await prisma.operationLog.count()).toBe(0);
    expect(gateError).toBeUndefined();
    results.push({
      id: 'B08',
      withdrawnDisabled: 4,
      noOutboxOrBusinessAuditFabrication: true,
    });
  });

  async function cli(
    label: string,
    args: string[],
    configured = true,
    expectedExit = 0,
  ) {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      EMBEDDING_BASE_URL: gateUrl,
    };
    if (!configured) {
      env.DATABASE_URL = 'postgresql://invalid:invalid@127.0.0.1:1/unavailable';
      env.EMBEDDING_API_KEY = '';
    }
    const result = await new Promise<{
      stdout: string;
      stderr: string;
      code: number;
    }>((yes, no) => {
      execFile(
        process.execPath,
        [
          require.resolve('tsx/cli'),
          join(root, 'scripts/rag-reindex.ts'),
          ...args,
        ],
        {
          cwd: root,
          env,
          windowsHide: true,
          timeout: 240_000,
          maxBuffer: 1024 * 1024,
        },
        (error, stdout, stderr) => {
          if (error && typeof error.code !== 'number') {
            no(error);
            return;
          }
          yes({
            stdout,
            stderr,
            code: typeof error?.code === 'number' ? error.code : 0,
          });
        },
      );
    });
    const text = result.stdout + result.stderr;
    for (const secret of [
      process.env.EMBEDDING_API_KEY,
      new URL(process.env.DATABASE_URL!).password,
    ])
      if (secret) expect(text).not.toContain(secret);
    await writeFile(join(output, `${label}.log`), text);
    const frames = result.stdout
      .split(/\r?\n/u)
      .filter((line) => line.startsWith('{'))
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    commands.push({ label, args, exitCode: result.code, frames });
    expect(result.code, label).toBe(expectedExit);
    return { ...result, frames };
  }
  function project(title: string, content: string, published: boolean) {
    return prisma.projectKnowledge.create({
      data: {
        Title: title,
        Content: content,
        Category: 'guide',
        Status: published ? 'published' : 'draft',
        PublishTime: published ? new Date() : null,
      },
    });
  }
  function indexed() {
    return prisma.ragDocument.findMany({ where: { Status: 'indexed' } });
  }
  function search() {
    return new PrismaRagCandidateRetriever(prisma).search(
      {
        embedding: queryVector,
        embeddingModel: process.env.EMBEDDING_MODEL!,
        limit: 50,
      },
      { public: true, merchant: { kind: 'none' }, admin: false },
    );
  }
});
