import { ARTICLE_CONTENT_PARSER } from './application/ports/content-parser.js';
import { parseArticleMarkdown } from '../../shared/content/markdown.js';
import { PUBLIC_ARTICLE_READER } from './application/ports/public-article-reader.js';
import { PrismaPublicArticleReader } from './infrastructure/prisma-public-article.reader.js';
import { PROJECT_KNOWLEDGE_REPOSITORY } from './application/ports/project-knowledge-repository.js';
import { PrismaProjectKnowledgeRepository } from './infrastructure/prisma-project-knowledge.repository.js';
import { ARTICLE_REPOSITORY } from './application/ports/article-repository.js';
import { PrismaArticleRepository } from './infrastructure/prisma-article.repository.js';
import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module.js';
import { PlatformAdministrationModule } from '../platform-administration/platform-administration.module.js';
import { IntegrationEventsModule } from '../integration-events/integration-events.module.js';
import { AdminArticlesController } from './presentation/http/admin-articles.controller.js';
import { AdminArticleService } from './application/admin-article-service.js';
import { ProjectKnowledgeController } from './presentation/http/project-knowledge.controller.js';
import { ProjectKnowledgeService } from './application/project-knowledge.service.js';
import { PublicArticleQueries } from './application/public-article-queries.js';
import { PublicArticlesController } from './presentation/http/public-articles.controller.js';

@Module({
  imports: [
    AssetsModule,
    PlatformAdministrationModule,
    IntegrationEventsModule,
  ],
  controllers: [
    AdminArticlesController,
    ProjectKnowledgeController,
    PublicArticlesController,
  ],
  providers: [
    {provide:ARTICLE_CONTENT_PARSER,useValue:{parse:parseArticleMarkdown}},
    AdminArticleService,
    ProjectKnowledgeService,
    PublicArticleQueries,
    { provide: ARTICLE_REPOSITORY, useClass: PrismaArticleRepository },
    {
      provide: PROJECT_KNOWLEDGE_REPOSITORY,
      useClass: PrismaProjectKnowledgeRepository,
    },
    { provide: PUBLIC_ARTICLE_READER, useClass: PrismaPublicArticleReader },
  ],
})
export class KnowledgeContentModule {}
