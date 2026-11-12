import assert from 'node:assert/strict';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../src/shared/persistence/prisma.service.js';
import { RagDocumentIndexingService } from '../src/modules/ai-assistant/application/rag-document-indexing.service.js';
import { PrismaRagDocumentWriter } from '../src/modules/ai-assistant/infrastructure/prisma-rag-document-writer.js';
import { resortSourceState } from '../src/modules/ai-assistant/domain/rag-source-state.js';

const database = new URL(process.env.DATABASE_URL ?? '');
if (
  !['localhost', '127.0.0.1'].includes(database.hostname) ||
  database.pathname !== '/linji_ai_mobile_validation' ||
  process.env.AI_MOBILE_FIXTURE_CONFIRM !== 'linji_ai_mobile_validation'
)
  throw new Error(
    'Explicitly confirmed disposable AI mobile database required',
  );
const prisma = new PrismaService();
const manifestPath =
  process.env.AI_MOBILE_FIXTURE_PATH ?? 'storage/ai-mobile-http-fixture.json';
const statsPath =
  process.env.AI_MOBILE_STATS_PATH ?? 'storage/ai-mobile-provider-counts.json';
const model = 'ai-mobile-fixture';
const vector = Array.from({ length: 1024 }, (_, index) =>
  index === 0 ? 1 : 0,
);
const answer = '公开雪场提供初级雪道，请参考资料 [S1]。';
interface Manifest {
  databaseName: string;
  publicResortId: number;
  resortIds: number[];
  answer: string;
}
const stats = { embeddingCalls: 0, chatCalls: 0, promptChecks: 0 };

async function serve() {
  assert.equal(await prisma.user.count(), 1, 'Fresh seeded database required');
  assert.equal(await prisma.skiResort.count(), 0);
  assert.equal(await prisma.aiConversation.count(), 0);
  assert.equal(await prisma.ragDocument.count(), 0);
  const indexing = new RagDocumentIndexingService(
    new ConfigService({ EMBEDDING_MODEL: model }),
    { embed: async (texts) => texts.map(() => vector) },
    new PrismaRagDocumentWriter(prisma),
  );
  const resortIds: number[] = [];
  for (const kind of ['public', 'draft', 'private'] as const) {
    const row = await prisma.skiResort.create({
      data: {
        Name: `mobile-${kind}-reference`,
        LegacyDistance: 0,
        Price: 100,
        SnowCondition: 'powder',
        Description: `${kind} reference: beginner trail available`,
        Status: kind === 'draft' ? 'draft' : 'published',
      },
      include: { FitTags: { include: { Item: true } } },
    });
    resortIds.push(row.ResortId);
    await indexing.index({
      sourceKey: `resort:${row.ResortId}`,
      sourceType: 'resort',
      sourceId: row.ResortId,
      title: row.Name,
      content: row.Description,
      accessScope: kind === 'private' ? 'admin' : 'public',
      merchantId: null,
      sourceUpdatedAt: row.UpdateTime,
      sourceState: resortSourceState(row),
    });
  }
  await mkdir(dirname(manifestPath), { recursive: true });
  await mkdir(dirname(statsPath), { recursive: true });
  await writeFile(
    manifestPath,
    JSON.stringify({
      databaseName: 'linji_ai_mobile_validation',
      publicResortId: resortIds[0]!,
      resortIds,
      answer,
    } satisfies Manifest),
  );
  await writeFile(statsPath, JSON.stringify(stats));
  const server = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      response
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ kind: 'linji-ai-mobile-fixture' }));
      return;
    }
    void respond(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(
      Number(process.env.AI_MOBILE_PROVIDER_PORT ?? 62912),
      '127.0.0.1',
      resolve,
    );
  });
  await prisma.$disconnect();
  console.log(
    'Synthetic AI providers ready on loopback; fixture manifest written.',
  );
}
async function respond(request: IncomingMessage, response: ServerResponse) {
  assert.equal(request.method, 'POST');
  assert.equal(
    request.headers.authorization,
    `Bearer ${process.env.AI_MOBILE_PROVIDER_KEY ?? 'ai-mobile-synthetic-provider-key'}`,
  );
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const data = Buffer.from(chunk as Uint8Array);
    bytes += data.length;
    assert.ok(bytes <= 100_000);
    chunks.push(data);
  }
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<
    string,
    unknown
  >;
  assert.equal(body.model, model);
  if (request.url === '/v1/embeddings') {
    assert.ok(
      Array.isArray(body.input) &&
        body.input.every((text: unknown) => typeof text === 'string'),
    );
    stats.embeddingCalls++;
    await writeFile(statsPath, JSON.stringify(stats));
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        data: body.input.map((_, index) => ({ index, embedding: vector })),
      }),
    );
  } else {
    assert.equal(request.url, '/v1/chat/completions');
    const prompt = JSON.stringify(body.messages);
    assert.ok(prompt.includes('mobile-public-reference'));
    assert.ok(
      !prompt.includes('mobile-private-reference') &&
        !prompt.includes('mobile-draft-reference'),
    );
    stats.chatCalls++;
    stats.promptChecks++;
    await writeFile(statsPath, JSON.stringify(stats));
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const content of [answer.slice(0, 5), answer.slice(5)])
      response.write(
        `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`,
      );
    response.end('data: [DONE]\n\n');
  }
}
async function verify() {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Manifest;
  assert.equal(manifest.databaseName, 'linji_ai_mobile_validation');
  const counts = JSON.parse(await readFile(statsPath, 'utf8')) as typeof stats;
  assert.deepEqual(counts, {
    embeddingCalls: 3,
    chatCalls: 3,
    promptChecks: 3,
  });
  const conversations = await prisma.aiConversation.findMany({
    where: { User: { Account: { startsWith: 'ai-mobile-' } } },
    include: { Messages: true },
  });
  assert.equal(conversations.length, 2);
  assert.equal(conversations.filter((row) => row.DeletedAt !== null).length, 1);
  assert.deepEqual(
    conversations.map((row) => row.Messages.length).sort((a, b) => a - b),
    [2, 4],
  );
  for (const conversation of conversations) {
    const assistant = conversation.Messages.filter(
      (message) => message.SenderRole === 'assistant',
    );
    assert.equal(
      assistant.length * 2,
      conversation.Messages.length,
      'Retry must not append another turn',
    );
    for (const reply of assistant) {
      assert.equal(reply.Content, answer);
      const citations = reply.Citations as Array<{ sourceId: string }>;
      assert.deepEqual(
        citations.map((citation) => citation.sourceId),
        [String(manifest.publicResortId)],
      );
    }
  }
  assert.equal(await prisma.ragChunk.count(), 3);
  console.log(
    'AI mobile fixture verified: three persisted turns, one soft deletion, three provider calls, public-only prompts/citations.',
  );
}
try {
  if (process.argv[2] === 'serve') await serve();
  else if (process.argv[2] === 'verify') await verify();
  else throw new Error('Expected serve or verify');
} finally {
  await prisma.$disconnect();
}
