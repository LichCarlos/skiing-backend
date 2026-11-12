import { RagDependencyEventHandler } from './infrastructure/rag-dependency-event-handler.js';
import { Module } from '@nestjs/common';
import { RevenueImportsModule } from '../resort-management/revenue-imports.module.js';
import { RevenueImportEventHandler } from '../resort-management/application/revenue-import-event-handler.js';
import { OutboxEventsController } from './presentation/http/outbox-events.controller.js';
import { ManageOutboxEvents } from './application/manage-outbox-events.js';
import { OUTBOX_MANAGEMENT_REPOSITORY } from './application/ports/outbox-management-repository.js';
import { PrismaOutboxManagementRepository } from './infrastructure/prisma-outbox-management.repository.js';
import { INBOX_LEASE } from './application/ports/inbox-lease.js';
import { DatabaseModule } from '../../shared/persistence/database.module.js';
import { OutboxDeliveryService } from './application/outbox-delivery.service.js';
import { KafkaEventPublisher } from './infrastructure/kafka-event.publisher.js';
import { OutboxPollingWorker } from './infrastructure/outbox-polling.worker.js';
import { PrismaInboxExecutor } from './infrastructure/prisma-inbox.executor.js';
import { PrismaOutboxStore } from './infrastructure/prisma-outbox.store.js';
import { PrismaUnitOfWork } from './infrastructure/prisma-unit-of-work.js';
import { OUTBOX_STORE } from './application/ports/outbox-store.js';
import { AiAssistantModule } from '../ai-assistant/ai-assistant.module.js';
import { ResortRagEventHandler } from '../ai-assistant/application/resort-rag-event-handler.js';
import { KafkaEventConsumer } from './infrastructure/kafka-event.consumer.js';
import { ArticleRagEventHandler } from '../ai-assistant/application/article-rag-event-handler.js';
import { ProjectKnowledgeRagEventHandler } from '../ai-assistant/application/project-knowledge-rag-event-handler.js';
import { DynamicRagEventHandler } from '../ai-assistant/application/dynamic-rag-event-handler.js';
import { DictionaryRagEventHandler } from '../ai-assistant/application/dictionary-rag-event-handler.js';
import { RagSourceReindexEventHandler } from '../ai-assistant/application/rag-source-reindex-event-handler.js';

@Module({
  imports: [DatabaseModule, AiAssistantModule, RevenueImportsModule],
  controllers: [OutboxEventsController],
  providers: [
    RagDependencyEventHandler,
    ManageOutboxEvents,
    PrismaOutboxManagementRepository,
    {
      provide: OUTBOX_MANAGEMENT_REPOSITORY,
      useExisting: PrismaOutboxManagementRepository,
    },
    PrismaOutboxStore,
    { provide: OUTBOX_STORE, useExisting: PrismaOutboxStore },
    PrismaUnitOfWork,
    PrismaInboxExecutor,
    { provide: INBOX_LEASE, useExisting: PrismaInboxExecutor },
    KafkaEventPublisher,
    {
      provide: OutboxDeliveryService,
      useFactory: (store: PrismaOutboxStore, publisher: KafkaEventPublisher) =>
        new OutboxDeliveryService(store, publisher),
      inject: [PrismaOutboxStore, KafkaEventPublisher],
    },
    OutboxPollingWorker,
    ResortRagEventHandler,
    ArticleRagEventHandler,
    ProjectKnowledgeRagEventHandler,
    DynamicRagEventHandler,
    DictionaryRagEventHandler,
    RagSourceReindexEventHandler,
    KafkaEventConsumer,
    RevenueImportEventHandler,
  ],
  exports: [OUTBOX_STORE, PrismaUnitOfWork, PrismaInboxExecutor],
})
export class IntegrationEventsModule {}
