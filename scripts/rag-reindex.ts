import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../src/shared/persistence/prisma.service.js';
import { PrismaRagSourceReader } from '../src/modules/ai-assistant/infrastructure/prisma-rag-source.reader.js';
import { PrismaInboxExecutor } from '../src/modules/integration-events/infrastructure/prisma-inbox.executor.js';
import { RagDocumentIndexingService } from '../src/modules/ai-assistant/application/rag-document-indexing.service.js';
import { PrismaRagDocumentWriter } from '../src/modules/ai-assistant/infrastructure/prisma-rag-document-writer.js';
import { OpenAiCompatibleEmbeddingProvider } from '../src/modules/ai-assistant/infrastructure/openai-compatible-embedding.provider.js';
import { ResortRagEventHandler } from '../src/modules/ai-assistant/application/resort-rag-event-handler.js';
import { ArticleRagEventHandler } from '../src/modules/ai-assistant/application/article-rag-event-handler.js';
import { ProjectKnowledgeRagEventHandler } from '../src/modules/ai-assistant/application/project-knowledge-rag-event-handler.js';
import { DynamicRagEventHandler } from '../src/modules/ai-assistant/application/dynamic-rag-event-handler.js';
import { DictionaryRagEventHandler } from '../src/modules/ai-assistant/application/dictionary-rag-event-handler.js';
import { PrismaRagBackfillReader } from '../src/modules/ai-assistant/infrastructure/prisma-rag-backfill-reader.js';
import {
  parseBackfillOptions,
  RagBackfillFailure,
  runRagBackfill,
} from '../src/modules/ai-assistant/application/rag-backfill.js';

async function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== '--');
  if (args.length === 1 && args[0] === '--help') {
    console.log(
      'pnpm rag:reindex [--source all|resort|article|project_doc|dynamic|dictionary] [--batch-size 1..500] [--after-id N (single source only)]',
    );
    return;
  }
  const options = parseBackfillOptions(args);
  if (existsSync('.env')) process.loadEnvFile('.env');
  if (!process.env.DATABASE_URL || !process.env.EMBEDDING_API_KEY)
    throw new Error('DATABASE_URL and EMBEDDING_API_KEY are required');
  const prisma = new PrismaService();
  const config = new ConfigService(process.env);
  const writer = new PrismaRagDocumentWriter(prisma);
  const indexing = new RagDocumentIndexingService(
    config,
    new OpenAiCompatibleEmbeddingProvider(config),
    writer,
  );
  const inbox = new PrismaInboxExecutor(prisma);
  const sources = new PrismaRagSourceReader(prisma);
  const definitions = {
    resort: {
      handler: new ResortRagEventHandler(sources, inbox, indexing, writer),
      key: 'resortId',
      eventType: 'resort.changed.v1',
    },
    article: {
      handler: new ArticleRagEventHandler(sources, inbox, indexing, writer),
      key: 'articleId',
      eventType: 'article.changed.v1',
    },
    project_doc: {
      handler: new ProjectKnowledgeRagEventHandler(
        sources,
        inbox,
        indexing,
        writer,
      ),
      key: 'projectKnowledgeId',
      eventType: 'project_doc.changed.v1',
    },
    dynamic: {
      handler: new DynamicRagEventHandler(sources, inbox, indexing, writer),
      key: 'dynamicId',
      eventType: 'dynamic.changed.v1',
    },
    dictionary: {
      handler: new DictionaryRagEventHandler(sources, inbox, indexing, writer),
      key: 'itemId',
      eventType: 'dictionary.changed.v1',
    },
  };
  try {
    await prisma.$connect();
    const processed = await runRagBackfill(
      options,
      new PrismaRagBackfillReader(prisma),
      async (source, id) => {
        const definition = definitions[source];
        const dict =
          source === 'dictionary'
            ? await prisma.dictionaryItem.findUnique({
                where: { ItemId: id },
                select: { DictType: true },
              })
            : null;
        // A source physically removed after paging has nothing to reindex.
        if (source === 'dictionary' && !dict) return true;
        return definition.handler.handle({
          eventId: randomUUID(),
          eventType: definition.eventType,
          aggregateType: source,
          aggregateId: String(id),
          occurredAt: new Date(),
          payload: {
            [definition.key]: id,
            ...(dict ? { dictType: dict.DictType } : {}),
          },
        });
      },
      (source, id) =>
        console.log(JSON.stringify({ source, lastProcessedId: id })),
    );
    console.log(JSON.stringify({ processed }));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(
    error instanceof RagBackfillFailure
      ? error.message
      : 'RAG backfill failed. Check options, database and Embedding configuration.',
  );
  process.exitCode = 1;
});
