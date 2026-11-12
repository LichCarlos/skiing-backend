import { COMMUNITY_CONTENT_PARSER } from './application/ports/content-parser.js';
import { parseArticleMarkdown } from '../../shared/content/markdown.js';
import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module.js';
import { PublicCommunityQueries } from './application/public-community-queries.js';
import { CommunityWrites } from './application/community-writes.js';
import { AdminCommunityService } from './application/admin-community-service.js';
import { AdminCommunityController } from './presentation/http/admin-community.controller.js';
import { PublicCommunityController } from './presentation/http/public-community.controller.js';
import { OwnCommunityController } from './presentation/http/own-community.controller.js';
import { OwnCommunityQueries } from './application/own-community-queries.js';
import { OWN_DYNAMICS_READER } from './application/ports/own-dynamics-reader.js';
import { PrismaOwnDynamicsReader } from './infrastructure/prisma-own-dynamics.reader.js';
import { COMMUNITY_UNIT_OF_WORK } from './application/ports/community-unit-of-work.js';
import { PUBLIC_COMMUNITY_READER } from './application/ports/public-community-reader.js';
import { ADMIN_COMMUNITY_READER } from './application/ports/admin-community-reader.js';
import { PrismaCommunityUnitOfWork } from './infrastructure/prisma-community-unit-of-work.js';
import { PrismaPublicCommunityReader } from './infrastructure/prisma-public-community.reader.js';
import { PrismaAdminCommunityReader } from './infrastructure/prisma-admin-community.reader.js';

@Module({
  imports: [AssetsModule],
  controllers: [
    PublicCommunityController,
    AdminCommunityController,
    OwnCommunityController,
  ],
  providers: [
    {provide:COMMUNITY_CONTENT_PARSER,useValue:{parse:parseArticleMarkdown}},
    PublicCommunityQueries,
    CommunityWrites,
    AdminCommunityService,
    OwnCommunityQueries,
    { provide: OWN_DYNAMICS_READER, useClass: PrismaOwnDynamicsReader },
    { provide: COMMUNITY_UNIT_OF_WORK, useClass: PrismaCommunityUnitOfWork },
    { provide: PUBLIC_COMMUNITY_READER, useClass: PrismaPublicCommunityReader },
    { provide: ADMIN_COMMUNITY_READER, useClass: PrismaAdminCommunityReader },
  ],
})
export class CommunityModule {}
