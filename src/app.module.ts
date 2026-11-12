import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { IdentityAccessModule } from './modules/identity-access/identity-access.module.js';
import { AssetsModule } from './modules/assets/assets.module.js';
import { ResortManagementModule } from './modules/resort-management/resort-management.module.js';
import { CommunityModule } from './modules/community/community.module.js';
import { KnowledgeContentModule } from './modules/knowledge-content/knowledge-content.module.js';
import { MemberEngagementModule } from './modules/member-engagement/member-engagement.module.js';
import { AiAssistantModule } from './modules/ai-assistant/ai-assistant.module.js';
import { PlatformAdministrationModule } from './modules/platform-administration/platform-administration.module.js';
import { IntegrationEventsModule } from './modules/integration-events/integration-events.module.js';
import { HealthModule } from './modules/health/health.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    HealthModule,
    IdentityAccessModule,
    AssetsModule,
    ResortManagementModule,
    CommunityModule,
    KnowledgeContentModule,
    MemberEngagementModule,
    AiAssistantModule,
    PlatformAdministrationModule,
    IntegrationEventsModule,
  ],
})
export class AppModule {}
