import { EXACT_BUSINESS_READER } from './application/ports/exact-business-reader.js';
import { CurrentBusinessReader } from './infrastructure/current-business-reader.js';
import { PlatformAdministrationModule } from '../platform-administration/platform-administration.module.js';
import { ExactBusinessAnswer } from './application/exact-business-answer.js';
import { Module } from '@nestjs/common';
import { RAG_EVIDENCE_VALIDATOR } from './application/ports/rag-evidence-validator.js';
import { PrismaRagEvidenceValidator } from './infrastructure/prisma-rag-evidence-validator.js';
import { IdentityAccessModule } from '../identity-access/identity-access.module.js';
import { AI_STREAM_AUTHORIZATION } from './application/ports/ai-stream-authorization.js';
import { CurrentAiStreamAuthorization } from './infrastructure/current-ai-stream-authorization.js';
import { RAG_SOURCE_READER } from './application/ports/rag-source-reader.js';
import { PrismaRagSourceReader } from './infrastructure/prisma-rag-source.reader.js';
import { DatabaseModule } from '../../shared/persistence/database.module.js';
import { CHAT_MODEL_PROVIDER } from './application/ports/chat-model-provider.js';
import { EMBEDDING_PROVIDER } from './application/ports/embedding-provider.js';
import { RagRetrievalService } from './application/rag-retrieval.service.js';
import { RagAnswerService } from './application/rag-answer.service.js';
import { RagDocumentIndexingService } from './application/rag-document-indexing.service.js';
import { RAG_CANDIDATE_RETRIEVER } from './application/ports/rag-candidate-retriever.js';
import { OpenAiCompatibleChatModelProvider } from './infrastructure/openai-compatible-chat-model.provider.js';
import { OpenAiCompatibleEmbeddingProvider } from './infrastructure/openai-compatible-embedding.provider.js';
import { PrismaRagCandidateRetriever } from './infrastructure/prisma-rag-candidate-retriever.js';
import { PrismaRagDocumentWriter } from './infrastructure/prisma-rag-document-writer.js';
import { RAG_DOCUMENT_WRITER } from './application/ports/rag-document-writer.js';
import { AI_CONVERSATION_REPOSITORY } from './application/ports/ai-conversation.repository.js';
import { AiConversationService } from './application/ai-conversation.service.js';
import { PrismaAiConversationRepository } from './infrastructure/prisma-ai-conversation.repository.js';
import { AiConversationsController } from './presentation/http/ai-conversations.controller.js';
import { RagSourcesController } from './presentation/http/rag-sources.controller.js';
import { ManageRagSources } from './application/manage-rag-sources.js';
import { RAG_SOURCE_MANAGEMENT_REPOSITORY } from './application/ports/rag-source-management.repository.js';
import { PrismaRagSourceManagementRepository } from './infrastructure/prisma-rag-source-management.repository.js';
import { AiConversationAuditController } from './presentation/http/ai-conversation-audit.controller.js';
import { AuditAiConversations } from './application/audit-ai-conversations.js';
import { AI_CONVERSATION_AUDIT_REPOSITORY } from './application/ports/ai-conversation-audit.repository.js';
import { PrismaAiConversationAuditRepository } from './infrastructure/prisma-ai-conversation-audit.repository.js';

@Module({
  imports: [DatabaseModule, IdentityAccessModule, PlatformAdministrationModule],
  controllers: [
    AiConversationsController,
    RagSourcesController,
    AiConversationAuditController,
  ],
  providers: [
    ExactBusinessAnswer,
    { provide: EXACT_BUSINESS_READER, useClass: CurrentBusinessReader },
    { provide: RAG_EVIDENCE_VALIDATOR, useClass: PrismaRagEvidenceValidator },
    {
      provide: AI_STREAM_AUTHORIZATION,
      useClass: CurrentAiStreamAuthorization,
    },
    { provide: RAG_SOURCE_READER, useClass: PrismaRagSourceReader },
    PrismaAiConversationRepository,
    {
      provide: AI_CONVERSATION_REPOSITORY,
      useExisting: PrismaAiConversationRepository,
    },
    AiConversationService,
    AuditAiConversations,
    PrismaAiConversationAuditRepository,
    {
      provide: AI_CONVERSATION_AUDIT_REPOSITORY,
      useExisting: PrismaAiConversationAuditRepository,
    },
    ManageRagSources,
    PrismaRagSourceManagementRepository,
    {
      provide: RAG_SOURCE_MANAGEMENT_REPOSITORY,
      useExisting: PrismaRagSourceManagementRepository,
    },
    PrismaRagCandidateRetriever,
    PrismaRagDocumentWriter,
    {
      provide: RAG_DOCUMENT_WRITER,
      useExisting: PrismaRagDocumentWriter,
    },
    {
      provide: CHAT_MODEL_PROVIDER,
      useClass: OpenAiCompatibleChatModelProvider,
    },
    {
      provide: EMBEDDING_PROVIDER,
      useClass: OpenAiCompatibleEmbeddingProvider,
    },
    {
      provide: RAG_CANDIDATE_RETRIEVER,
      useExisting: PrismaRagCandidateRetriever,
    },
    RagRetrievalService,
    RagAnswerService,
    RagDocumentIndexingService,
  ],
  exports: [
    RAG_SOURCE_READER,
    RAG_DOCUMENT_WRITER,
    RagRetrievalService,
    RagAnswerService,
    RagDocumentIndexingService,
  ],
})
export class AiAssistantModule {}
