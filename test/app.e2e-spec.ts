import { LOGIN_ATTEMPT_STORE } from '../src/modules/identity-access/application/ports/login-attempt-store.js';
import { RevenueImportService } from '../src/modules/resort-management/application/revenue-import.service.js';
import { Test, TestingModule } from '@nestjs/testing';
import { ModulesContainer } from '@nestjs/core';
import { AUTHORIZATION_RESOURCES } from '../src/modules/identity-access/domain/authorization-resources.js';
import { Body, Controller, Get, INestApplication, Post } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';
import request from 'supertest';
import { App } from 'supertest/types.js';
import {
  AUTHORIZATION_PRINCIPAL_READER,
  type AuthorizationPrincipalRecord,
} from './../src/modules/identity-access/application/ports/authorization-principal-reader.js';
import {
  AUTHENTICATION_REPOSITORY,
  type AuthenticationIdentityRecord,
} from './../src/modules/identity-access/application/ports/authentication-repository.js';
import { AUTH_SESSION_REPOSITORY } from './../src/modules/identity-access/application/ports/auth-session-repository.js';
import {
  AUTH_TOKEN_SERVICE,
  type AuthTokenService,
} from './../src/modules/identity-access/application/ports/auth-token-service.js';
import { PERMISSION_TREE_READER } from './../src/modules/identity-access/application/ports/permission-tree-reader.js';
import { PERMISSION_CATALOG_REPOSITORY } from './../src/modules/identity-access/application/ports/permission-catalog-repository.js';
import { PASSWORD_HASHER } from './../src/modules/identity-access/application/ports/password-hasher.js';
import { USER_REGISTRATION_REPOSITORY } from './../src/modules/identity-access/application/ports/user-registration-repository.js';
import { ROLE_AUTHORIZATION_REPOSITORY } from './../src/modules/platform-administration/application/ports/role-authorization-repository.js';
import { MANAGED_ROLE_REPOSITORY } from './../src/modules/platform-administration/application/ports/managed-role-repository.js';
import { MANAGED_DICTIONARY_REPOSITORY } from './../src/modules/platform-administration/application/ports/managed-dictionary-repository.js';
import { MANAGED_USER_REPOSITORY } from './../src/modules/identity-access/application/ports/managed-user-repository.js';
import { SELF_PASSWORD_CHANGE_REPOSITORY } from './../src/modules/identity-access/application/ports/self-password-change-repository.js';
import { ASSET_REPOSITORY } from './../src/modules/assets/application/ports/asset-repository.js';
import { ADMIN_ASSET_REPOSITORY } from './../src/modules/assets/application/ports/admin-asset-repository.js';
import { ASSET_SCANNER } from './../src/modules/assets/application/ports/asset-scanner.js';
import { MerchantResortService } from './../src/modules/resort-management/application/merchant-resort-service.js';
import { AdminResortService } from './../src/modules/resort-management/application/admin-resort-service.js';
import { RevenueService } from './../src/modules/resort-management/application/revenue-service.js';
import {
  FAVORITE_REPOSITORY,
  type FavoriteRepository,
} from './../src/modules/member-engagement/application/ports/favorite-repository.js';
import { AdminArticleService } from './../src/modules/knowledge-content/application/admin-article-service.js';
import { PublicArticleQueries } from './../src/modules/knowledge-content/application/public-article-queries.js';
import { CommunityWrites } from './../src/modules/community/application/community-writes.js';
import { PublicCommunityQueries } from './../src/modules/community/application/public-community-queries.js';
import { OWN_DYNAMICS_READER } from './../src/modules/community/application/ports/own-dynamics-reader.js';
import { AdminCommunityService } from './../src/modules/community/application/admin-community-service.js';
import { ASSET_STORAGE } from './../src/modules/assets/application/ports/asset-storage.js';
import { ProtectedSystemRoleError } from './../src/modules/platform-administration/application/role-authorization-errors.js';
import type { PermissionTreeRecord } from './../src/modules/identity-access/domain/permission-tree.js';
import { HmacAuthTokenService } from './../src/modules/identity-access/infrastructure/hmac-auth-token.service.js';
import {
  Public,
  RESOURCE_SCOPE_METADATA,
  RequireManagementPermissions,
  RequirePermissions,
} from './../src/modules/identity-access/presentation/http/authorization.decorators.js';
import { AppModule } from './../src/app.module.js';
import { configureHttp } from './../src/shared/http/configure-http.js';
import { createOpenApiDocument } from './../src/shared/http/openapi-document.js';

class ValidationProbeDto {
  @ApiProperty({ maxLength: 20 })
  @IsString()
  @MaxLength(20)
  value!: string;
}

@Controller('authorization-test')
@Public()
class AuthorizationTestController {
  @Get('protected')
  @RequireManagementPermissions('system:user:list')
  protectedRoute(): { ok: true } {
    return { ok: true };
  }

  @Get('method-protected')
  @RequirePermissions('system:user:list')
  methodProtectedRoute(): { ok: true } {
    return { ok: true };
  }

  @Post('validated')
  validatedRoute(@Body() input: ValidationProbeDto): { value: string } {
    return { value: input.value };
  }
}

@Controller('authorization-unconfigured-test')
class AuthorizationUnconfiguredTestController {
  @Get()
  unconfiguredRoute(): { ok: true } {
    return { ok: true };
  }
}

describe('HealthController (e2e)', () => {
  let app: INestApplication<App>;
  let createSession: ReturnType<typeof vi.fn>;
  let rotateSession: ReturnType<typeof vi.fn>;
  let registerAccount: ReturnType<typeof vi.fn>;
  let findRoleAuthorization: ReturnType<typeof vi.fn>;
  let replaceRoleAuthorization: ReturnType<typeof vi.fn>;
  let managedRoleList: ReturnType<typeof vi.fn>;
  let managedRoleCreate: ReturnType<typeof vi.fn>;
  let managedRoleUpdate: ReturnType<typeof vi.fn>;
  let managedRoleDisable: ReturnType<typeof vi.fn>;
  let managedDictionaryList: ReturnType<typeof vi.fn>;
  let managedDictionaryCreateItem: ReturnType<typeof vi.fn>;
  let permissionCatalogList: ReturnType<typeof vi.fn>;
  let permissionCatalogCreate: ReturnType<typeof vi.fn>;
  let permissionCatalogUpdate: ReturnType<typeof vi.fn>;
  let permissionCatalogDisable: ReturnType<typeof vi.fn>;
  let permissionCatalogSync: ReturnType<typeof vi.fn>;
  let managedUserList: ReturnType<typeof vi.fn>;
  let managedUserCreate: ReturnType<typeof vi.fn>;
  let managedUserReplaceRoles: ReturnType<typeof vi.fn>;
  let managedUserSetStatus: ReturnType<typeof vi.fn>;
  let passwordChangeFindHash: ReturnType<typeof vi.fn>;
  let passwordChangeUpdate: ReturnType<typeof vi.fn>;
  let assetCreatePending: ReturnType<typeof vi.fn>;
  let assetSetStatus: ReturnType<typeof vi.fn>;
  let assetStoragePut: ReturnType<typeof vi.fn>;
  let assetScan: ReturnType<typeof vi.fn>;
  let adminAssetFindPage: ReturnType<typeof vi.fn>;
  let adminAssetFindById: ReturnType<typeof vi.fn>;
  let adminAssetDelete: ReturnType<typeof vi.fn>;
  let merchantResortList: ReturnType<typeof vi.fn>;
  let merchantResortCreate: ReturnType<typeof vi.fn>;
  let merchantResortGet: ReturnType<typeof vi.fn>;
  let merchantResortUpdate: ReturnType<typeof vi.fn>;
  let merchantResortRemove: ReturnType<typeof vi.fn>;
  let merchantResortSubmitReview: ReturnType<typeof vi.fn>;
  let merchantResortCustomFieldSchema: ReturnType<typeof vi.fn>;
  let adminResortList: ReturnType<typeof vi.fn>;
  let adminResortGet: ReturnType<typeof vi.fn>;
  let adminResortCreate: ReturnType<typeof vi.fn>;
  let adminResortUpdate: ReturnType<typeof vi.fn>;
  let adminResortRemove: ReturnType<typeof vi.fn>;
  let adminResortPublish: ReturnType<typeof vi.fn>;
  let adminResortOffline: ReturnType<typeof vi.fn>;
  let merchantRevenueList: ReturnType<typeof vi.fn>;
  let merchantRevenueSummary: ReturnType<typeof vi.fn>;
  let adminRevenueUpsert: ReturnType<typeof vi.fn>;
  let adminRevenueImport: ReturnType<typeof vi.fn>;
  let adminArticleList: ReturnType<typeof vi.fn>;
  let adminArticleGet: ReturnType<typeof vi.fn>;
  let adminArticleCreate: ReturnType<typeof vi.fn>;
  let adminArticleUpdate: ReturnType<typeof vi.fn>;
  let adminArticleRemove: ReturnType<typeof vi.fn>;
  let adminArticlePublish: ReturnType<typeof vi.fn>;
  let adminArticleWithdraw: ReturnType<typeof vi.fn>;
  let publicArticleCategories: ReturnType<typeof vi.fn>;
  let publicArticleList: ReturnType<typeof vi.fn>;
  let publicArticleGet: ReturnType<typeof vi.fn>;
  let communityDynamics: ReturnType<typeof vi.fn>;
  let ownDynamicsList: ReturnType<typeof vi.fn>;
  let ownDynamicsFind: ReturnType<typeof vi.fn>;
  let communityDynamic: ReturnType<typeof vi.fn>;
  let communityComments: ReturnType<typeof vi.fn>;
  let communityCreateDynamic: ReturnType<typeof vi.fn>;
  let communityUpdateDynamic: ReturnType<typeof vi.fn>;
  let communityRemoveDynamic: ReturnType<typeof vi.fn>;
  let communityCreateComment: ReturnType<typeof vi.fn>;
  let communityRemoveComment: ReturnType<typeof vi.fn>;
  let communitySetLiked: ReturnType<typeof vi.fn>;
  let adminCommunityListDynamics: ReturnType<typeof vi.fn>;
  let adminCommunityGetDynamic: ReturnType<typeof vi.fn>;
  let adminCommunityListComments: ReturnType<typeof vi.fn>;
  let adminCommunityModerateDynamic: ReturnType<typeof vi.fn>;
  let adminCommunityModerateComment: ReturnType<typeof vi.fn>;
  let adminCommunityRemoveDynamic: ReturnType<typeof vi.fn>;
  let adminCommunityRemoveComment: ReturnType<typeof vi.fn>;
  let scopedResortPrincipal: AuthorizationPrincipalRecord | null = null;

  const principalRecord: AuthorizationPrincipalRecord = {
    userId: 42,
    status: 'active',
    merchant: null,
    roles: [
      {
        key: 'system_admin',
        status: 'active',
        dataScope: 'all',
        permissions: [
          { key: 'management:portal:enter', status: 'active' },
          { key: 'system:role:list', status: 'active' },
          { key: 'system:role:create', status: 'active' },
          { key: 'system:role:update', status: 'active' },
          { key: 'system:role:delete', status: 'active' },
          { key: 'system:dict:list', status: 'active' },
          { key: 'system:dict:create', status: 'active' },
          { key: 'system:dict:update', status: 'active' },
          { key: 'system:dict:delete', status: 'active' },
          { key: 'system:permission:assign', status: 'active' },
          { key: 'system:permission:list', status: 'active' },
          { key: 'system:permission:create', status: 'active' },
          { key: 'system:permission:update', status: 'active' },
          { key: 'system:permission:delete', status: 'active' },
          { key: 'account:profile:read', status: 'active' },
          { key: 'member:favorite:toggle', status: 'active' },
          { key: 'system:user:list', status: 'active' },
          { key: 'system:user:create', status: 'active' },
          { key: 'system:user:update', status: 'active' },
          { key: 'system:user:assign-role', status: 'active' },
          { key: 'account:password:update', status: 'active' },
          { key: 'asset:upload', status: 'active' },
          { key: 'asset:read-own', status: 'active' },
          { key: 'asset:delete-own', status: 'active' },
          { key: 'content:resort:list-all', status: 'active' },
          { key: 'content:resort:create-all', status: 'active' },
          { key: 'content:resort:update-all', status: 'active' },
          { key: 'content:resort:delete-all', status: 'active' },
          { key: 'content:resort:publish', status: 'active' },
          { key: 'content:resort:offline', status: 'active' },
          { key: 'revenue:system:upsert', status: 'active' },
          { key: 'content:asset:list', status: 'active' },
          { key: 'content:asset:delete', status: 'active' },
          { key: 'content:article:manage', status: 'active' },
          { key: 'content:dynamic:moderate', status: 'active' },
          { key: 'community:dynamic:create', status: 'active' },
          { key: 'community:dynamic:read-own', status: 'active' },
          { key: 'community:dynamic:update-own', status: 'active' },
          { key: 'community:comment:create', status: 'active' },
          { key: 'community:like:toggle', status: 'active' },
        ],
      },
    ],
  };

  const principalWithoutPermission: AuthorizationPrincipalRecord = {
    userId: 43,
    status: 'active',
    merchant: { id: 7, status: 'active' },
    roles: [
      {
        key: 'merchant',
        status: 'active',
        dataScope: 'merchant',
        permissions: [],
      },
    ],
  };

  const principalWithDelegatedAuthorization: AuthorizationPrincipalRecord = {
    userId: 44,
    status: 'active',
    merchant: null,
    roles: [
      {
        key: 'delegated_operator',
        status: 'active',
        dataScope: 'all',
        permissions: [
          { key: 'management:portal:enter', status: 'active' },
          { key: 'system:role:update', status: 'active' },
          { key: 'system:role:create', status: 'active' },
          { key: 'system:permission:assign', status: 'active' },
          { key: 'system:permission:update', status: 'active' },
        ],
      },
    ],
  };

  const principalWithSelectedRoleScope: AuthorizationPrincipalRecord = {
    userId: 45,
    status: 'active',
    merchant: null,
    roles: [
      {
        key: 'role_auditor',
        status: 'active',
        dataScope: 'all',
        permissions: [
          { key: 'management:portal:enter', status: 'active' },
          { key: 'system:role:list', status: 'active' },
          { key: 'system:role:create', status: 'active' },
        ],
        dataScopes: [
          {
            resourceKey: 'role',
            scopeType: 'selected',
            scopeConfig: { selectedIds: [7] },
          },
        ],
      },
    ],
  };
  const merchantResortPrincipal: AuthorizationPrincipalRecord = {
    userId: 46,
    status: 'active',
    merchant: { id: 27, status: 'active' },
    roles: [
      {
        key: 'resort_operator',
        status: 'active',
        dataScope: 'merchant',
        permissions: [
          { key: 'management:portal:enter', status: 'active' },
          { key: 'resort:merchant:list', status: 'active' },
          { key: 'resort:merchant:create', status: 'active' },
          { key: 'revenue:merchant:list', status: 'active' },
        ],
        dataScopes: [
          { resourceKey: 'resort', scopeType: 'merchant', scopeConfig: null },
        ],
      },
    ],
  };

  const permissionRecords: readonly PermissionTreeRecord[] = [
    {
      permissionId: 1,
      parentId: null,
      permissionKey: 'menu:system',
      permissionName: '系统管理',
      permissionType: 'directory',
      route: null,
      icon: null,
      sortOrder: 10,
    },
    {
      permissionId: 2,
      parentId: 1,
      permissionKey: 'system:role:list',
      permissionName: '查询角色',
      permissionType: 'api',
      route: null,
      icon: null,
      sortOrder: 10,
    },
  ];

  const favoriteRepository = {
    hasPublicTarget: vi
      .fn<FavoriteRepository['hasPublicTarget']>()
      .mockResolvedValue(false),
    addPublicTarget: vi.fn<FavoriteRepository['addPublicTarget']>(),
    remove: vi.fn<FavoriteRepository['remove']>(),
    findPage: vi.fn<FavoriteRepository['findPage']>(),
  };

  beforeEach(async () => {
    favoriteRepository.addPublicTarget.mockReset().mockResolvedValue(true);
    favoriteRepository.remove.mockReset().mockResolvedValue(undefined);
    favoriteRepository.findPage
      .mockReset()
      .mockResolvedValue({ items: [], total: 0 });
    scopedResortPrincipal = null;
    const identity: AuthenticationIdentityRecord = {
      userId: 42,
      account: 'admin',
      nickname: 'Administrator',
      avatarUrl: null,
      status: 'active',
      passwordHash: 'hashed-demo-password',
      merchant: null,
      roles: [
        {
          key: 'system_admin',
          name: '系统管理员',
          status: 'active',
          permissionKeys: principalRecord.roles[0]!.permissions,
        },
      ],
    };
    let currentRefreshHash: string | null = null;
    let currentSessionId = '';
    let currentSessionExpiresAt = new Date();
    const realTokens = new HmacAuthTokenService(
      'test-secret-with-at-least-32-bytes',
    );
    const tokenService: AuthTokenService = {
      createSessionId: () => realTokens.createSessionId(),
      createRefreshToken: () => realTokens.createRefreshToken(),
      hashRefreshToken: (token) => realTokens.hashRefreshToken(token),
      refreshExpiresAt: (now) => realTokens.refreshExpiresAt(now),
      issueAccessToken: (userId, sessionId, now) =>
        realTokens.issueAccessToken(userId, sessionId, now),
      verifyAccessToken: (token, now) => {
        if (token === 'test-42') {
          return {
            userId: 42,
            sessionId: '11111111-1111-4111-8111-111111111111',
          };
        }
        if (token === 'test-43') {
          return {
            userId: 43,
            sessionId: '22222222-2222-4222-8222-222222222222',
          };
        }
        if (token === 'test-44') {
          return {
            userId: 44,
            sessionId: '33333333-3333-4333-8333-333333333333',
          };
        }
        if (token === 'test-45') {
          return {
            userId: 45,
            sessionId: '44444444-4444-4444-8444-444444444444',
          };
        }
        if (token === 'test-46') {
          return {
            userId: 46,
            sessionId: '55555555-5555-4555-8555-555555555555',
          };
        }
        if (token === 'test-47') {
          return {
            userId: 47,
            sessionId: '66666666-6666-4666-8666-666666666666',
          };
        }
        return realTokens.verifyAccessToken(token, now);
      },
    };
    createSession = vi.fn(
      async (input: {
        sessionId: string;
        refreshTokenHash: string;
        expiresAt: Date;
      }) => {
        currentSessionId = input.sessionId;
        currentSessionExpiresAt = input.expiresAt;
        currentRefreshHash = input.refreshTokenHash;
        return true;
      },
    );
    rotateSession = vi.fn(
      async (input: {
        currentTokenHash: string;
        replacementTokenHash: string;
      }) => {
        if (
          !currentRefreshHash ||
          input.currentTokenHash !== currentRefreshHash
        ) {
          currentRefreshHash = null;
          return { status: 'reused' as const };
        }
        currentRefreshHash = input.replacementTokenHash;
        return {
          status: 'rotated' as const,
          userId: 42,
          sessionId: currentSessionId,
          expiresAt: currentSessionExpiresAt,
        };
      },
    );
    registerAccount = vi.fn(
      async (input: { account: string; nickname: string }) => ({
        userId: 99,
        account: input.account,
        nickname: input.nickname,
      }),
    );
    const roleAuthorizationSnapshot = {
      roleId: 7,
      roleKey: 'resort_operator',
      roleName: '雪场运营',
      status: 'active',
      permissionIds: [2],
      dataScopes: [{ resourceKey: 'resort', scopeType: 'merchant' }],
      fieldPolicies: [],
    };
    findRoleAuthorization = vi.fn(async (roleId: number) =>
      roleId === 7 ? roleAuthorizationSnapshot : null,
    );
    replaceRoleAuthorization = vi.fn(
      async (input: {
        roleId: number;
        authorization: {
          permissionIds: number[];
          dataScopes: Array<{
            resourceKey: string;
            scopeType: string;
            selectedIds?: number[];
          }>;
          fieldPolicies: Array<{
            entityType: string;
            fieldKey: string;
            canRead: boolean;
            canWrite: boolean;
          }>;
        };
      }) => ({
        ...roleAuthorizationSnapshot,
        roleId: input.roleId,
        ...input.authorization,
      }),
    );
    const managedRole = {
      roleId: 7,
      roleKey: 'resort_operator',
      roleName: '雪场运营',
      description: null,
      dataScope: 'merchant',
      status: 'active',
      userCount: 2,
      permissionCount: 3,
      fieldPolicyCount: 0,
      dataScopes: [{ resourceKey: 'resort', scopeType: 'merchant' }],
    };
    managedRoleList = vi.fn(async () => ({ items: [managedRole], total: 1 }));
    managedRoleCreate = vi.fn(async () => ({ ...managedRole, roleId: 8 }));
    managedRoleUpdate = vi.fn(async () => managedRole);
    managedRoleDisable = vi.fn(async () => true);
    managedDictionaryList = vi.fn(async () => ({ items: [], total: 0 }));
    managedDictionaryCreateItem = vi.fn(async () => ({
      itemId: 4,
      parentId: null,
      label: 'Advanced',
      value: 'advanced',
      color: null,
      sortOrder: 0,
      isDefault: false,
      status: 'active',
      children: [],
    }));
    permissionCatalogList = vi.fn(async () => []);
    permissionCatalogCreate = vi.fn(
      async ({ permission }: { permission: Record<string, unknown> }) => ({
        ...permission,
        permissionId: 11,
        source: 'custom',
        status: 'active',
        children: [],
      }),
    );
    permissionCatalogUpdate = vi.fn(async () => ({}));
    permissionCatalogDisable = vi.fn(async () => 'disabled');
    permissionCatalogSync = vi.fn(async () => ({
      created: 0,
      updated: 1,
      disabled: 0,
    }));
    const managedUser = {
      userId: 99,
      account: 'new.user',
      nickname: 'New User',
      status: 'active' as const,
      roles: [],
      merchant: null,
      createdAt: new Date('2026-10-27T00:00:00.000Z'),
    };
    managedUserList = vi.fn(async () => ({ items: [managedUser], total: 1 }));
    managedUserCreate = vi.fn(async () => managedUser);
    managedUserReplaceRoles = vi.fn(async () => managedUser);
    managedUserSetStatus = vi.fn(async () => managedUser);
    passwordChangeFindHash = vi.fn(async () => 'hashed-demo-password');
    passwordChangeUpdate = vi.fn(async () => true);
    assetCreatePending = vi.fn(
      async (input: {
        ownerUserId: number;
        storageKey: string;
        originalName: string;
        mimeType: string;
        sizeBytes: number;
      }) => ({
        assetId: '52',
        ownerUserId: input.ownerUserId,
        storageKey: input.storageKey,
        originalName: input.originalName,
        mimeType: input.mimeType,
        sizeBytes: String(input.sizeBytes),
        status: 'pending_scan' as const,
        createdAt: new Date('2026-10-27T00:00:00.000Z'),
      }),
    );
    assetSetStatus = vi.fn(async () => true);
    assetStoragePut = vi.fn(async () => undefined);
    assetScan = vi.fn(async () => 'clean' as const);
    const adminAsset = {
      assetId: '52',
      ownerUserId: 9,
      ownerAccount: 'uploader',
      storageKey: 'assets/9/52.png',
      originalName: 'cover.png',
      mimeType: 'image/png',
      sizeBytes: '1024',
      status: 'ready' as const,
      createdAt: new Date('2026-10-27T00:00:00.000Z'),
      references: {
        coverResorts: 0,
        resortImages: 0,
        articleCovers: 0,
        dynamicImages: 0,
        userAvatars: 0,
      },
    };
    adminAssetFindPage = vi.fn(async () => ({ items: [adminAsset], total: 1 }));
    adminAssetFindById = vi.fn(async () => adminAsset);
    adminAssetDelete = vi.fn(async () => 'deleted');
    merchantResortList = vi.fn(async (input: unknown) => ({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      input,
    }));
    merchantResortCreate = vi.fn(async (input: unknown) => ({
      resortId: 501,
      status: 'draft',
      input,
    }));
    merchantResortGet = vi.fn(async () => ({ resortId: 501 }));
    merchantResortUpdate = vi.fn(async () => ({ resortId: 501 }));
    merchantResortRemove = vi.fn(async () => undefined);
    merchantResortSubmitReview = vi.fn(async () => ({ resortId: 501 }));
    merchantResortCustomFieldSchema = vi.fn(async () => ({
      entityType: 'ski_resort',
      groups: [],
    }));
    merchantRevenueList = vi.fn(async (merchantId: number, query: unknown) => ({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
      hasNext: false,
      merchantId,
      query,
    }));
    merchantRevenueSummary = vi.fn(
      async (merchantId: number, query: unknown) => ({
        resortId: null,
        resortName: null,
        fromDate: '2026-10-01',
        toDate: '2026-10-28',
        totalAmount: '0.00',
        daily: [],
        merchantId,
        query,
      }),
    );
    adminRevenueUpsert = vi.fn(
      async (body: unknown, source: string, audit: unknown) => ({
        revenueId: 801,
        body,
        source,
        audit,
      }),
    );
    adminRevenueImport = vi.fn(async (buffer: Buffer, audit: unknown) => ({
      totalRows: 0,
      succeededRows: 0,
      failedRows: 0,
      bufferSize: buffer.length,
      audit,
    }));
    adminResortList = vi.fn(async (input: unknown) => ({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      input,
    }));
    adminResortGet = vi.fn(async (id: number) => ({ resortId: id }));
    adminResortCreate = vi.fn(async (input: unknown) => ({
      resortId: 502,
      input,
    }));
    adminResortUpdate = vi.fn(async (id: number, input: unknown) => ({
      resortId: id,
      input,
    }));
    adminResortRemove = vi.fn(async () => undefined);
    adminResortPublish = vi.fn(async (id: number) => ({ resortId: id }));
    adminResortOffline = vi.fn(async (id: number) => ({ resortId: id }));
    adminArticleList = vi.fn(async () => ({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      hasNext: false,
    }));
    adminArticleGet = vi.fn(async (id: number) => ({ articleId: id }));
    adminArticleCreate = vi.fn(async (body: unknown) => ({
      articleId: 901,
      body,
    }));
    adminArticleUpdate = vi.fn(async (id: number, body: unknown) => ({
      articleId: id,
      body,
    }));
    adminArticleRemove = vi.fn(async () => undefined);
    adminArticlePublish = vi.fn(async (id: number) => ({
      articleId: id,
      status: 'published',
    }));
    adminArticleWithdraw = vi.fn(async (id: number) => ({
      articleId: id,
      status: 'withdrawn',
    }));
    publicArticleCategories = vi.fn(async () => [
      { value: 'basics', label: '基础' },
    ]);
    publicArticleList = vi.fn(async (query: unknown) => ({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
      hasNext: false,
      query,
    }));
    publicArticleGet = vi.fn(async (id: number) => ({ articleId: id }));
    communityDynamics = vi.fn(async () => ({
      items: [],
      nextCursor: null,
      hasNext: false,
    }));
    ownDynamicsList = vi.fn(async () => ({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
      hasNext: false,
    }));
    ownDynamicsFind = vi.fn(async () => null);
    communityDynamic = vi.fn(async (id: number) => ({
      dynamicId: id,
      status: 'published',
    }));
    communityComments = vi.fn(async () => ({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
      hasNext: false,
    }));
    communityCreateDynamic = vi.fn(async () => ({
      dynamicId: 700,
      status: 'pending',
      createdAt: '2026-10-28T00:00:00.000Z',
    }));
    communityUpdateDynamic = vi.fn(async (authorId: number, id: number) => ({
      dynamicId: id,
      status: 'pending',
      authorId,
    }));
    communityRemoveDynamic = vi.fn(async () => undefined);
    communityCreateComment = vi.fn(async () => ({
      commentId: 701,
      status: 'visible',
      createdAt: '2026-10-28T00:00:00.000Z',
    }));
    communityRemoveComment = vi.fn(async () => undefined);
    communitySetLiked = vi.fn(
      async (_userId: number, id: number, liked: boolean) => ({
        liked,
        likeCount: liked ? 1 : 0,
        dynamicId: id,
      }),
    );
    adminCommunityListDynamics = vi.fn(async (query: unknown) => ({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
      hasNext: false,
      query,
    }));
    adminCommunityGetDynamic = vi.fn(async (id: number) => ({ dynamicId: id }));
    adminCommunityListComments = vi.fn(async (id: number, query: unknown) => ({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
      hasNext: false,
      id,
      query,
    }));
    adminCommunityModerateDynamic = vi.fn(
      async (id: number, body: unknown) => ({
        dynamicId: id,
        status: 'published',
        body,
      }),
    );
    adminCommunityModerateComment = vi.fn(
      async (id: number, body: unknown) => ({
        commentId: id,
        status: 'hidden',
        body,
      }),
    );
    adminCommunityRemoveDynamic = vi.fn(async () => undefined);
    adminCommunityRemoveComment = vi.fn(async () => undefined);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [
        AuthorizationTestController,
        AuthorizationUnconfiguredTestController,
      ],
    })
      .overrideProvider(AUTHORIZATION_PRINCIPAL_READER)
      .useValue({
        findByUserId: async (userId: number) =>
          userId === principalRecord.userId
            ? principalRecord
            : userId === principalWithoutPermission.userId
              ? principalWithoutPermission
              : userId === principalWithDelegatedAuthorization.userId
                ? principalWithDelegatedAuthorization
                : userId === principalWithSelectedRoleScope.userId
                  ? principalWithSelectedRoleScope
                  : userId === merchantResortPrincipal.userId
                    ? merchantResortPrincipal
                    : userId === 47
                      ? scopedResortPrincipal
                      : null,
      })
      .overrideProvider(FAVORITE_REPOSITORY)
      .useValue(favoriteRepository)
      .overrideProvider(LOGIN_ATTEMPT_STORE)
      .useValue({ consume: async () => ({ allowed: true }) })
      .overrideProvider(AUTH_TOKEN_SERVICE)
      .useValue(tokenService)
      .overrideProvider(AUTHENTICATION_REPOSITORY)
      .useValue({
        findByAccount: async (account: string) =>
          account === identity.account ? identity : null,
        findByUserId: async (userId: number) =>
          userId === identity.userId ? identity : null,
      })
      .overrideProvider(AUTH_SESSION_REPOSITORY)
      .useValue({
        create: createSession,
        isActive: async ({
          sessionId,
          userId,
        }: {
          sessionId: string;
          userId: number;
        }) =>
          (sessionId === '11111111-1111-4111-8111-111111111111' &&
            userId === 42) ||
          (sessionId === '22222222-2222-4222-8222-222222222222' &&
            userId === 43) ||
          (sessionId === '33333333-3333-4333-8333-333333333333' &&
            userId === 44) ||
          (sessionId === '44444444-4444-4444-8444-444444444444' &&
            userId === 45) ||
          (sessionId === '55555555-5555-4555-8555-555555555555' &&
            userId === 46) ||
          (sessionId === '66666666-6666-4666-8666-666666666666' &&
            userId === 47) ||
          (sessionId === currentSessionId &&
            userId === 42 &&
            currentRefreshHash !== null),
        rotateRefreshToken: rotateSession,
        revokeByRefreshTokenHash: vi.fn(async () => undefined),
        revokeSession: vi.fn(async () => {
          currentRefreshHash = null;
        }),
      })
      .overrideProvider(PASSWORD_HASHER)
      .useValue({
        hash: vi.fn(async (password: string) =>
          password === 'new-password-2026'
            ? 'hashed-new-password'
            : 'hashed-demo-password',
        ),
        verify: vi.fn(
          async (password: string) => password === 'demo-pass-2026',
        ),
      })
      .overrideProvider(USER_REGISTRATION_REPOSITORY)
      .useValue({ register: registerAccount })
      .overrideProvider(PERMISSION_TREE_READER)
      .useValue({
        findActivePermissions: async () => permissionRecords,
      })
      .overrideProvider(ROLE_AUTHORIZATION_REPOSITORY)
      .useValue({
        findSnapshot: findRoleAuthorization,
        replaceAuthorization: replaceRoleAuthorization,
      })
      .overrideProvider(MANAGED_ROLE_REPOSITORY)
      .useValue({
        list: managedRoleList,
        findById: vi.fn(async () => managedRole),
        create: managedRoleCreate,
        update: managedRoleUpdate,
        disable: managedRoleDisable,
      })
      .overrideProvider(PERMISSION_CATALOG_REPOSITORY)
      .useValue({
        findTree: permissionCatalogList,
        create: permissionCatalogCreate,
        update: permissionCatalogUpdate,
        disable: permissionCatalogDisable,
        sync: permissionCatalogSync,
      })
      .overrideProvider(MANAGED_DICTIONARY_REPOSITORY)
      .useValue({
        listTypes: managedDictionaryList,
        findType: vi.fn(async () => ({
          dictType: 'resort.level',
          dictName: 'Level',
          groupKey: 'resort',
          status: 'active',
          publiclyReadable: false,
          items: [],
        })),
        createType: vi.fn(async () => ({})),
        updateType: vi.fn(async () => ({})),
        disableType: vi.fn(async () => true),
        createItem: managedDictionaryCreateItem,
        updateItem: vi.fn(async () => ({})),
        disableItem: vi.fn(async () => true),
      })
      .overrideProvider(MANAGED_USER_REPOSITORY)
      .useValue({
        list: managedUserList,
        findById: vi.fn(async () => managedUser),
        create: managedUserCreate,
        replaceRoles: managedUserReplaceRoles,
        setStatus: managedUserSetStatus,
      })
      .overrideProvider(SELF_PASSWORD_CHANGE_REPOSITORY)
      .useValue({
        findPasswordHash: passwordChangeFindHash,
        updatePassword: passwordChangeUpdate,
      })
      .overrideProvider(ASSET_REPOSITORY)
      .useValue({
        createPending: assetCreatePending,
        setStatus: assetSetStatus,
        findOwnedReady: vi.fn(async () => null),
        deleteIfUnreferenced: vi.fn(async () => false),
      })
      .overrideProvider(ADMIN_ASSET_REPOSITORY)
      .useValue({
        findPage: adminAssetFindPage,
        findById: adminAssetFindById,
        verifyReadAccess: vi.fn().mockResolvedValue(undefined),
        deleteIfUnreferencedAdmin: adminAssetDelete,
      })
      .overrideProvider(ASSET_STORAGE)
      .useValue({
        put: assetStoragePut,
        remove: vi.fn(async () => undefined),
        createReadUrl: vi.fn(async () => 'https://assets.example/signed'),
      })
      .overrideProvider(ASSET_SCANNER)
      .useValue({ scan: assetScan })
      .overrideProvider(MerchantResortService)
      .useValue({
        list: merchantResortList,
        create: merchantResortCreate,
        get: merchantResortGet,
        update: merchantResortUpdate,
        remove: merchantResortRemove,
        submitReview: merchantResortSubmitReview,
        customFieldSchema: merchantResortCustomFieldSchema,
      })
      .overrideProvider(AdminResortService)
      .useValue({
        list: adminResortList,
        get: adminResortGet,
        create: adminResortCreate,
        update: adminResortUpdate,
        remove: adminResortRemove,
        publish: adminResortPublish,
        offline: adminResortOffline,
      })
      .overrideProvider(RevenueService)
      .useValue({
        merchantList: merchantRevenueList,
        merchantSummary: merchantRevenueSummary,
        upsertIdempotent: adminRevenueUpsert,
      })
      .overrideProvider(RevenueImportService)
      .useValue({
        create: adminRevenueImport,
      })
      .overrideProvider(AdminArticleService)
      .useValue({
        list: adminArticleList,
        get: adminArticleGet,
        create: adminArticleCreate,
        update: adminArticleUpdate,
        remove: adminArticleRemove,
        publish: adminArticlePublish,
        withdraw: adminArticleWithdraw,
      })
      .overrideProvider(PublicArticleQueries)
      .useValue({
        categories: publicArticleCategories,
        list: publicArticleList,
        get: publicArticleGet,
      })
      .overrideProvider(OWN_DYNAMICS_READER)
      .useValue({ list: ownDynamicsList, find: ownDynamicsFind })
      .overrideProvider(PublicCommunityQueries)
      .useValue({
        dynamics: communityDynamics,
        dynamic: communityDynamic,
        comments: communityComments,
      })
      .overrideProvider(CommunityWrites)
      .useValue({
        createDynamic: communityCreateDynamic,
        updateDynamic: communityUpdateDynamic,
        removeDynamic: communityRemoveDynamic,
        createComment: communityCreateComment,
        removeComment: communityRemoveComment,
        setLiked: communitySetLiked,
      })
      .overrideProvider(AdminCommunityService)
      .useValue({
        listDynamics: adminCommunityListDynamics,
        getDynamic: adminCommunityGetDynamic,
        listComments: adminCommunityListComments,
        moderateDynamic: adminCommunityModerateDynamic,
        moderateComment: adminCommunityModerateComment,
        removeDynamic: adminCommunityRemoveDynamic,
        removeComment: adminCommunityRemoveComment,
      })
      .compile();

    app = moduleFixture.createNestApplication();
    configureHttp(app);
    await app.init();
  });

  it('protects own dynamics queries and derives the owner from authentication', async () => {
    await request(app.getHttpServer()).get('/api/v1/me/dynamics').expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/me/dynamics')
      .set('authorization', 'Bearer test-43')
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/me/dynamics/12')
      .set('authorization', 'Bearer test-43')
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/me/dynamics?page=2&pageSize=10&status=hidden')
      .set('authorization', 'Bearer test-42')
      .expect(200);
    expect(ownDynamicsList).toHaveBeenCalledExactlyOnceWith(
      42,
      expect.objectContaining({ page: 2, pageSize: 10, status: 'hidden' }),
    );
    for (const query of [
      'status=draft',
      'page=0',
      'pageSize=101',
      'authorId=43',
    ]) {
      await request(app.getHttpServer())
        .get(`/api/v1/me/dynamics?${query}`)
        .set('authorization', 'Bearer test-42')
        .expect(400);
    }
    await request(app.getHttpServer())
      .get('/api/v1/me/dynamics/12')
      .set('authorization', 'Bearer test-42')
      .expect(404);
    expect(ownDynamicsFind).toHaveBeenCalledExactlyOnceWith(42, 12);
    await request(app.getHttpServer())
      .get('/api/v1/me/dynamics/invalid')
      .set('authorization', 'Bearer test-42')
      .expect(400);
    const document = createOpenApiDocument(app);
    expect(document.paths['/api/v1/me/dynamics']?.get).toBeDefined();
    expect(document.paths['/api/v1/me/dynamics/{id}']?.get).toBeDefined();
  });

  it('/api/v1/health (GET)', () => {
    return request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200)
      .expect(({ body, headers }) => {
        expect(body.code).toBe(200);
        expect(body.msg).toBe('success');
        expect(body.data.status).toBe('ok');
        expect(body.data.timestamp).toEqual(expect.any(String));
        expect(body.traceId).toEqual(headers['x-trace-id']);
      });
  });

  it('serves the public community feed through the standard response envelope', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/dynamics?keyword=snow&limit=5')
      .expect(200)
      .expect(({ body, headers }) => {
        expect(body).toMatchObject({
          code: 200,
          msg: 'success',
          data: { items: [], nextCursor: null, hasNext: false },
          traceId: headers['x-trace-id'],
        });
      });

    expect(communityDynamics).toHaveBeenCalledWith(
      expect.objectContaining({ keyword: 'snow', limit: 5 }),
      undefined,
    );
  });

  it('serves public article categories, filtered pages, and details without authentication', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/knowledge/categories')
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toEqual([{ value: 'basics', label: '基础' }]);
      });
    expect(publicArticleCategories).toHaveBeenCalledOnce();

    await request(app.getHttpServer())
      .get(
        '/api/v1/articles?page=2&pageSize=5&keyword=snow&categoryValue=basics',
      )
      .expect(200);
    expect(publicArticleList).toHaveBeenCalledWith(
      {
        page: 2,
        pageSize: 5,
        keyword: 'snow',
        categoryValue: 'basics',
      },
      undefined,
    );

    await request(app.getHttpServer()).get('/api/v1/articles/17').expect(200);
    expect(publicArticleGet).toHaveBeenCalledWith(17, undefined);
  });

  it('requires community permission for writes and passes the authenticated owner to the use case', async () => {
    const body = { content: 'First run of the season', imageAssetIds: [] };

    await request(app.getHttpServer())
      .post('/api/v1/dynamics')
      .send(body)
      .expect(401);
    expect(communityCreateDynamic).not.toHaveBeenCalled();

    await request(app.getHttpServer())
      .post('/api/v1/dynamics')
      .set('authorization', 'Bearer test-42')
      .send(body)
      .expect(201)
      .expect(({ body: response }) => {
        expect(response.data).toMatchObject({
          dynamicId: 700,
          status: 'pending',
        });
        expect(response.traceId).toEqual(expect.any(String));
      });

    expect(communityCreateDynamic).toHaveBeenCalledWith(42, body);
  });

  it('protects owner-only community edits with the required permission', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/dynamics/700')
      .set('authorization', 'Bearer test-43')
      .send({ content: 'Edited' })
      .expect(403);
    expect(communityUpdateDynamic).not.toHaveBeenCalled();

    await request(app.getHttpServer())
      .patch('/api/v1/dynamics/700')
      .set('authorization', 'Bearer test-42')
      .send({ content: 'Edited' })
      .expect(200)
      .expect(({ body: response }) => {
        expect(response.data).toMatchObject({
          dynamicId: 700,
          status: 'pending',
        });
      });
    expect(communityUpdateDynamic).toHaveBeenCalledWith(42, 700, {
      content: 'Edited',
    });
  });

  it('accepts explicit resort unlinking and ordered image edits while rejecting invalid reference types', async () => {
    communityUpdateDynamic.mockClear();
    await request(app.getHttpServer())
      .patch('/api/v1/dynamics/700')
      .set('authorization', 'Bearer test-42')
      .send({ resortId: null, imageAssetIds: ['12', '11'] })
      .expect(200);
    expect(communityUpdateDynamic).toHaveBeenCalledExactlyOnceWith(42, 700, {
      resortId: null,
      imageAssetIds: ['12', '11'],
    });
    communityUpdateDynamic.mockClear();
    for (const invalid of [0, -1, true, '7', 1.5]) {
      await request(app.getHttpServer())
        .patch('/api/v1/dynamics/700')
        .set('authorization', 'Bearer test-42')
        .send({ resortId: invalid })
        .expect(400);
    }
    await request(app.getHttpServer())
      .patch('/api/v1/dynamics/700')
      .set('authorization', 'Bearer test-42')
      .send({ imageAssetIds: ['12', '12'] })
      .expect(400);
    expect(communityUpdateDynamic).not.toHaveBeenCalled();
    const schemas = createOpenApiDocument(app).components?.schemas;
    expect(schemas?.UpdateDynamicDto).toMatchObject({
      properties: { resortId: { nullable: true, type: 'number' } },
    });
    expect(schemas?.OwnDynamicDetailVO).toMatchObject({
      required: expect.arrayContaining(['images', 'imageUrls']),
    });
    expect(schemas?.OwnDynamicImageVO).toMatchObject({
      properties: { assetId: { type: 'string' } },
    });
  });

  it('protects API-M08 and passes validated pagination and moderation commands', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/dynamics')
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/admin/dynamics')
      .set('authorization', 'Bearer test-43')
      .expect(403);

    await request(app.getHttpServer())
      .get(
        '/api/v1/admin/dynamics?page=2&pageSize=10&status=pending&keyword=snow',
      )
      .set('authorization', 'Bearer test-42')
      .expect(200);
    expect(adminCommunityListDynamics).toHaveBeenCalledWith({
      page: 2,
      pageSize: 10,
      status: 'pending',
      keyword: 'snow',
    });

    await request(app.getHttpServer())
      .get('/api/v1/admin/dynamics/700/comments?page=3&pageSize=5')
      .set('authorization', 'Bearer test-42')
      .expect(200);
    expect(adminCommunityListComments).toHaveBeenCalledWith(700, {
      page: 3,
      pageSize: 5,
    });

    await request(app.getHttpServer())
      .patch('/api/v1/admin/dynamics/700/moderation')
      .set('authorization', 'Bearer test-42')
      .send({ action: 'approve', reason: ' reviewed ' })
      .expect(200);
    expect(adminCommunityModerateDynamic).toHaveBeenCalledWith(
      700,
      {
        action: 'approve',
        reason: ' reviewed ',
      },
      expect.objectContaining({ actorUserId: 42 }),
    );

    await request(app.getHttpServer())
      .delete('/api/v1/admin/comments/701')
      .set('authorization', 'Bearer test-42')
      .expect(204);
    expect(adminCommunityRemoveComment).toHaveBeenCalledWith(
      701,
      expect.objectContaining({ actorUserId: 42 }),
    );
  });

  it('authorizes merchant resort requests and derives merchant scope from the principal', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/merchant/resorts?page=2&pageSize=10')
      .set('authorization', 'Bearer test-46')
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.total).toBe(0);
      });
    expect(merchantResortList).toHaveBeenCalledWith({
      userId: 46,
      merchantId: 27,
      scope: { kind: 'merchant', merchantId: 27 },
      page: '2',
      pageSize: '10',
      status: undefined,
    });

    await request(app.getHttpServer())
      .get('/api/v1/merchant/resorts')
      .set('authorization', 'Bearer test-43')
      .expect(403);

    await request(app.getHttpServer())
      .post('/api/v1/merchant/resorts')
      .set('authorization', 'Bearer test-46')
      .send({
        name: '雪峰测试场',
        price: 520,
        openStatus: 'open',
        snowCondition: '粉雪',
        description: '测试用雪场',
        merchantId: 999,
      })
      .expect(400);
    expect(merchantResortCreate).not.toHaveBeenCalled();

    await request(app.getHttpServer())
      .post('/api/v1/merchant/resorts')
      .set('authorization', 'Bearer test-46')
      .send({
        name: '雪峰测试场',
        price: 520,
        openStatus: 'open',
        snowCondition: '粉雪',
        description: '测试用雪场',
      })
      .expect(201);
    expect(merchantResortCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 46,
        merchantId: 27,
        scope: { kind: 'merchant', merchantId: 27 },
        body: expect.objectContaining({ name: '雪峰测试场', price: 520 }),
      }),
      expect.objectContaining({
        traceId: expect.any(String),
        clientIp: expect.any(String),
        userAgent: null,
      }),
    );
  });

  it.each(['self', 'merchant', 'selected', 'all'] as const)(
    'forwards resolved merchant resource scope independently of role name for every route: %s',
    async (scopeType) => {
      scopedResortPrincipal = {
        userId: 47,
        status: 'active',
        merchant: { id: 27, status: 'active' },
        roles: [
          {
            key: 'custom_resort_operator',
            status: 'active',
            dataScope: 'all',
            permissions: [
              'management:portal:enter',
              'resort:merchant:list',
              'resort:merchant:create',
              'resort:merchant:update',
              'resort:merchant:delete',
              'resort:merchant:submit-review',
              'revenue:merchant:list',
            ].map((key) => ({ key, status: 'active' })),
            dataScopes: [
              {
                resourceKey: 'resort',
                scopeType,
                scopeConfig:
                  scopeType === 'selected' ? { selectedIds: [501] } : null,
              },
            ],
          },
        ],
      };
      const scope =
        scopeType === 'self'
          ? { kind: 'self', userId: 47 }
          : scopeType === 'merchant'
            ? { kind: 'merchant', merchantId: 27 }
            : scopeType === 'selected'
              ? { kind: 'selected', ids: [501] }
              : { kind: 'all' };
      const context = { userId: 47, merchantId: 27, scope };
      await request(app.getHttpServer())
        .get('/api/v1/merchant/resorts')
        .set('authorization', 'Bearer test-47')
        .expect(200);
      await request(app.getHttpServer())
        .get('/api/v1/merchant/resorts/custom-fields')
        .set('authorization', 'Bearer test-47')
        .expect(200);
      await request(app.getHttpServer())
        .get('/api/v1/merchant/resorts/501')
        .set('authorization', 'Bearer test-47')
        .expect(200);
      await request(app.getHttpServer())
        .patch('/api/v1/merchant/resorts/501')
        .set('authorization', 'Bearer test-47')
        .send({ price: 100 })
        .expect(200);
      await request(app.getHttpServer())
        .delete('/api/v1/merchant/resorts/501')
        .set('authorization', 'Bearer test-47')
        .expect(204);
      await request(app.getHttpServer())
        .patch('/api/v1/merchant/resorts/501/submit-review')
        .set('authorization', 'Bearer test-47')
        .expect(200);
      await request(app.getHttpServer())
        .post('/api/v1/merchant/resorts')
        .set('authorization', 'Bearer test-47')
        .send({
          name: 'Scoped',
          price: 100,
          openStatus: 'open',
          snowCondition: 'powder',
          description: 'Scoped',
        })
        .expect(scopeType === 'selected' ? 403 : 201);
      for (const call of [
        merchantResortList,
        merchantResortGet,
        merchantResortCustomFieldSchema,
      ])
        expect(call).toHaveBeenCalledWith(expect.objectContaining(context));
      for (const call of [
        merchantResortUpdate,
        merchantResortRemove,
        merchantResortSubmitReview,
      ])
        expect(call).toHaveBeenCalledWith(
          expect.objectContaining(context),
          expect.objectContaining({ traceId: expect.any(String) }),
        );
      if (scopeType === 'selected')
        expect(merchantResortCreate).not.toHaveBeenCalled();
      else
        expect(merchantResortCreate).toHaveBeenCalledWith(
          expect.objectContaining(context),
          expect.any(Object),
        );
      await request(app.getHttpServer())
        .get('/api/v1/merchant/revenue')
        .set('authorization', 'Bearer test-47')
        .expect(200);
      await request(app.getHttpServer())
        .get('/api/v1/merchant/revenue/summary')
        .set('authorization', 'Bearer test-47')
        .expect(200);
      expect(merchantRevenueList).toHaveBeenCalledWith(
        context,
        expect.any(Object),
      );
      expect(merchantRevenueSummary).toHaveBeenCalledWith(
        context,
        expect.any(Object),
      );
    },
  );

  it('protects revenue queries and derives the merchant from the principal', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/merchant/revenue?page=2&pageSize=10&resortId=88')
      .set('authorization', 'Bearer test-46')
      .expect(200);
    expect(merchantRevenueList).toHaveBeenCalledWith(
      {
        userId: 46,
        merchantId: 27,
        scope: { kind: 'merchant', merchantId: 27 },
      },
      {
        page: 2,
        pageSize: 10,
        resortId: 88,
      },
    );

    await request(app.getHttpServer())
      .get(
        '/api/v1/merchant/revenue/summary?fromDate=2026-10-01&toDate=2026-10-28',
      )
      .set('authorization', 'Bearer test-46')
      .expect(200);
    expect(merchantRevenueSummary).toHaveBeenCalledWith(
      {
        userId: 46,
        merchantId: 27,
        scope: { kind: 'merchant', merchantId: 27 },
      },
      {
        page: 1,
        pageSize: 20,
        fromDate: '2026-10-01',
        toDate: '2026-10-28',
      },
    );

    await request(app.getHttpServer())
      .get('/api/v1/merchant/revenue')
      .set('authorization', 'Bearer test-43')
      .expect(403);
    await request(app.getHttpServer())
      .put('/api/v1/admin/revenue')
      .set('Idempotency-Key', 'c4c42b6c-8b46-4d87-821c-423d8092681d')
      .set('authorization', 'Bearer test-46')
      .send({ resortId: 88, reportDate: '2026-10-28', revenueAmount: '100.25' })
      .expect(403);
  });

  it('validates and authorizes revenue upsert and CSV import requests', async () => {
    await request(app.getHttpServer())
      .put('/api/v1/admin/revenue')
      .set('Idempotency-Key', 'c4c42b6c-8b46-4d87-821c-423d8092681d')
      .set('authorization', 'Bearer test-42')
      .send({ resortId: 88, reportDate: '2026-10-28', revenueAmount: '100.25' })
      .expect(200);
    expect(adminRevenueUpsert).toHaveBeenCalledWith(
      { resortId: 88, reportDate: '2026-10-28', revenueAmount: '100.25' },
      'c4c42b6c-8b46-4d87-821c-423d8092681d',
      expect.objectContaining({ actorUserId: 42 }),
    );

    await request(app.getHttpServer())
      .put('/api/v1/admin/revenue')
      .set('Idempotency-Key', 'c4c42b6c-8b46-4d87-821c-423d8092681d')
      .set('authorization', 'Bearer test-42')
      .send({ resortId: 88, reportDate: '2026/02/30', revenueAmount: '100.25' })
      .expect(400);

    const csv = Buffer.from('resortId,reportDate,revenueAmount,note\n', 'utf8');
    await request(app.getHttpServer())
      .post('/api/v1/admin/revenue/import')
      .set('Idempotency-Key', 'c4c42b6c-8b46-4d87-821c-423d8092681d')
      .set('authorization', 'Bearer test-42')
      .attach('file', csv, { filename: 'revenue.csv', contentType: 'text/csv' })
      .expect(202);
    expect(adminRevenueImport).toHaveBeenCalledWith(
      csv,
      'c4c42b6c-8b46-4d87-821c-423d8092681d',
      expect.objectContaining({ actorUserId: 42 }),
    );
  });

  it('protects favorites with authentication and validates target input', async () => {
    await request(app.getHttpServer()).get('/api/v1/me/favorites').expect(401);

    await request(app.getHttpServer())
      .get('/api/v1/me/favorites')
      .set('authorization', 'Bearer test-43')
      .expect(403);

    await request(app.getHttpServer())
      .put('/api/v1/me/favorites')
      .set('authorization', 'Bearer test-42')
      .send({ targetType: 'invalid', targetId: 1 })
      .expect(400);

    await request(app.getHttpServer())
      .put('/api/v1/me/favorites')
      .set('authorization', 'Bearer test-42')
      .send({ targetType: 'resort', targetId: 10 })
      .expect(204);

    await request(app.getHttpServer())
      .delete('/api/v1/me/favorites/resort/10')
      .set('authorization', 'Bearer test-42')
      .expect(204);
  });

  it('reads private dynamic favorite state with identity and permission checks', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/me/favorites/dynamic/3')
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/me/favorites/dynamic/3')
      .set('authorization', 'Bearer test-43')
      .expect(403);
    favoriteRepository.hasPublicTarget.mockResolvedValue(true);
    await request(app.getHttpServer())
      .get('/api/v1/me/favorites/dynamic/3')
      .set('authorization', 'Bearer test-42')
      .expect(200)
      .expect('Cache-Control', 'private, no-store')
      .expect(({ body }) => expect(body.data).toEqual({ favorited: true }));
    expect(favoriteRepository.hasPublicTarget).toHaveBeenCalledWith(
      42,
      'dynamic',
      3,
    );
    await request(app.getHttpServer())
      .get('/api/v1/me/favorites/invalid/3')
      .set('authorization', 'Bearer test-42')
      .expect(400);
  });

  it('runs the real favorites use case with server identity and strips no pagination semantics', async () => {
    await request(app.getHttpServer())
      .put('/api/v1/me/favorites')
      .set('authorization', 'Bearer test-42')
      .send({ targetType: 'article', targetId: 9 })
      .expect(204);
    expect(favoriteRepository.addPublicTarget).toHaveBeenCalledWith(
      42,
      'article',
      9,
    );
    await request(app.getHttpServer())
      .get('/api/v1/me/favorites?page=2&pageSize=10&targetType=article')
      .set('authorization', 'Bearer test-42')
      .expect(200)
      .expect(({ body }) =>
        expect(body.data).toEqual({
          items: [],
          page: 2,
          pageSize: 10,
          total: 0,
        }),
      );
    expect(favoriteRepository.findPage).toHaveBeenCalledWith({
      userId: 42,
      skip: 10,
      take: 10,
      targetType: 'article',
    });
  });

  it('rejects unavailable favorite targets and invalid delete/pagination without writing', async () => {
    favoriteRepository.addPublicTarget.mockResolvedValue(false);
    await request(app.getHttpServer())
      .put('/api/v1/me/favorites')
      .set('authorization', 'Bearer test-42')
      .send({ targetType: 'article', targetId: 9 })
      .expect(404);
    for (const path of [
      '/api/v1/me/favorites/article/-1',
      '/api/v1/me/favorites/article/2147483648',
      '/api/v1/me/favorites/invalid/9',
    ])
      await request(app.getHttpServer())
        .delete(path)
        .set('authorization', 'Bearer test-42')
        .expect(400);
    await request(app.getHttpServer())
      .get('/api/v1/me/favorites?page=9007199254740991&pageSize=100')
      .set('authorization', 'Bearer test-42')
      .expect(400);
    expect(favoriteRepository.remove).not.toHaveBeenCalled();
    expect(favoriteRepository.findPage).not.toHaveBeenCalled();
  });

  it('wraps unmatched routes in the shared error envelope', () => {
    return request(app.getHttpServer())
      .get('/api/v1/not-a-route')
      .expect(404)
      .expect(({ body, headers }) => {
        expect(body.code).toBe(404);
        expect(body.data).toBeNull();
        expect(body.traceId).toEqual(headers['x-trace-id']);
      });
  });

  it('validates DTOs and applies the shared success/error envelopes over HTTP', async () => {
    const valid = await request(app.getHttpServer())
      .post('/api/v1/authorization-test/validated')
      .send({ value: 'snow' })
      .expect(201);
    expect(valid.body).toMatchObject({
      code: 201,
      msg: 'success',
      data: { value: 'snow' },
      traceId: valid.headers['x-trace-id'],
    });

    const invalid = await request(app.getHttpServer())
      .post('/api/v1/authorization-test/validated')
      .send({ value: 'snow', unexpected: true })
      .expect(400);
    expect(invalid.body).toMatchObject({
      code: 400,
      msg: 'Request validation failed',
      data: null,
      traceId: invalid.headers['x-trace-id'],
      details: expect.arrayContaining([
        expect.objectContaining({
          field: 'unexpected',
          code: 'VALIDATION_ERROR',
        }),
      ]),
    });
  });

  it('registers without a session, logs in, serves /me and rotates the refresh token', async () => {
    const registered = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        account: '  New.Rider ',
        password: 'snow-pass-2026',
        nickname: '  Snow Rider  ',
      })
      .expect(201);
    expect(registered.body.data).toEqual({
      userId: 99,
      account: 'new.rider',
      nickname: 'Snow Rider',
    });
    expect(createSession).not.toHaveBeenCalled();

    const unknownLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ account: 'unknown', password: 'demo-pass-2026' })
      .expect(401);
    const incorrectPassword = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ account: 'admin', password: 'incorrect-pass' })
      .expect(401);
    expect(unknownLogin.body.msg).toBe(incorrectPassword.body.msg);

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ account: ' ADMIN ', password: 'demo-pass-2026' })
      .expect(200);
    const { accessToken, refreshToken } = login.body.data;
    expect(accessToken).toEqual(expect.any(String));
    expect(refreshToken).toEqual(expect.any(String));

    const me = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(me.body.data).toMatchObject({
      userId: 42,
      account: 'admin',
      roles: [{ roleKey: 'system_admin', roleName: '系统管理员' }],
      permissionKeys: expect.arrayContaining(['account:profile:read']),
    });
    expect(me.body.data).not.toHaveProperty('passwordHash');

    const rotated = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken })
      .expect(200);
    expect(rotated.body.data.refreshToken).not.toBe(refreshToken);
    expect(rotated.body.data.accessToken).toEqual(expect.any(String));

    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken })
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('authorization', `Bearer ${rotated.body.data.accessToken}`)
      .expect(401);
  });

  it('requires an allowed Origin and double-submit CSRF token for browser writes', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', 'http://localhost:3000')
      .send({ account: 'admin', password: 'demo-pass-2026' })
      .expect(403);

    await request(app.getHttpServer())
      .get('/api/v1/auth/csrf')
      .set('Origin', 'https://attacker.example')
      .expect(403);

    const csrf = await request(app.getHttpServer())
      .get('/api/v1/auth/csrf')
      .set('Origin', 'http://localhost:3000')
      .expect(200);
    const csrfToken = csrf.body.data.csrfToken as string;
    const csrfSetCookie = csrf.headers['set-cookie'];
    const csrfCookie = (
      Array.isArray(csrfSetCookie) ? csrfSetCookie[0] : csrfSetCookie
    )!.split(';')[0]!;
    expect(csrfToken).toEqual(expect.any(String));

    const webLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', 'http://localhost:3000')
      .set('Cookie', csrfCookie)
      .set('X-CSRF-Token', csrfToken)
      .send({ account: 'admin', password: 'demo-pass-2026' })
      .expect(200);

    expect(webLogin.body.data).not.toHaveProperty('accessToken');
    expect(webLogin.body.data).not.toHaveProperty('refreshToken');
    expect(webLogin.headers['set-cookie']).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /^linji_access=.*HttpOnly;.*Secure;.*SameSite=Lax/i,
        ),
        expect.stringMatching(
          /^linji_refresh=.*HttpOnly;.*Secure;.*SameSite=Lax/i,
        ),
      ]),
    );
  });

  it('denies anonymous access to a protected management endpoint', () => {
    return request(app.getHttpServer())
      .get('/api/v1/authorization-test/protected')
      .expect(401)
      .expect(({ body }) => {
        expect(body.code).toBe(401);
        expect(body.data).toBeNull();
      });
  });

  it('denies anonymous access to the permission tree', () => {
    return request(app.getHttpServer())
      .get('/api/v1/admin/permissions/tree')
      .expect(401)
      .expect(({ body }) => {
        expect(body.code).toBe(401);
        expect(body.data).toBeNull();
      });
  });

  it('returns the permission tree for an authorized management principal', () => {
    return request(app.getHttpServer())
      .get('/api/v1/admin/permissions/tree')
      .set('authorization', 'Bearer test-42')
      .expect(200)
      .expect(({ body, headers }) => {
        expect(body).toMatchObject({
          code: 200,
          msg: 'success',
          data: [
            {
              permissionId: 1,
              permissionType: 'directory',
              children: [
                {
                  permissionId: 2,
                  permissionKey: 'system:role:list',
                },
              ],
            },
          ],
          traceId: headers['x-trace-id'],
        });
      });
  });

  it('serves and mutates the permission catalog behind dedicated grants', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/permissions')
      .set('authorization', 'Bearer test-42')
      .expect(200)
      .expect(({ body }) => expect(body.data).toEqual([]));

    await request(app.getHttpServer())
      .post('/api/v1/admin/permissions')
      .set('authorization', 'Bearer test-42')
      .send({
        permissionKey: 'custom:menu.reports',
        permissionName: 'Reports',
        permissionType: 'menu',
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body.data).toMatchObject({
          permissionKey: 'custom:menu.reports',
          permissionType: 'menu',
          source: 'custom',
        });
      });
    expect(permissionCatalogCreate).toHaveBeenCalledOnce();

    await request(app.getHttpServer())
      .post('/api/v1/admin/permissions')
      .set('authorization', 'Bearer test-42')
      .send({
        permissionKey: 'custom:api.fake',
        permissionName: 'Fake API',
        permissionType: 'api',
      })
      .expect(400);
  });

  it('returns a permission catalog subtree with list grants and reports missing or invalid nodes', async () => {
    const node = {
      permissionId: 2,
      permissionKey: 'custom:menu.reports',
      children: [],
    };
    permissionCatalogList.mockResolvedValueOnce([
      { permissionId: 1, children: [node] },
    ]);
    await request(app.getHttpServer())
      .get('/api/v1/admin/permissions/2')
      .set('authorization', 'Bearer test-42')
      .expect(200)
      .expect(({ body }) => expect(body.data).toEqual(node));
    await request(app.getHttpServer())
      .get('/api/v1/admin/permissions/999')
      .set('authorization', 'Bearer test-42')
      .expect(404);
    await request(app.getHttpServer())
      .get('/api/v1/admin/permissions/0')
      .set('authorization', 'Bearer test-42')
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/v1/admin/permissions/2')
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/admin/permissions/2')
      .set('authorization', 'Bearer test-43')
      .expect(403);
    const document = createOpenApiDocument(app);
    const operation =
      document.paths['/api/v1/admin/permissions/{permissionId}']?.get;
    expect(operation?.responses['404']).toBeDefined();
    expect(operation?.responses['200']).toMatchObject({
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/PermissionCatalogVO' },
        },
      },
    });
    expect(document.paths['/api/v1/admin/permissions/tree']?.get).toBeDefined();
  });

  it('serves the authorization resource catalog behind management entry and role-list grants', async () => {
    const path = '/api/v1/admin/authorization/resources';
    await request(app.getHttpServer()).get(path).expect(401);
    await request(app.getHttpServer())
      .get(path)
      .set('authorization', 'Bearer test-43')
      .expect(403);
    await request(app.getHttpServer())
      .get(path)
      .set('authorization', 'Bearer test-42')
      .expect(200)
      .expect(({ body }) => expect(body.data).toEqual(AUTHORIZATION_RESOURCES));
    const document = createOpenApiDocument(app);
    expect(document.paths[path]?.get?.responses['200']).toMatchObject({
      content: {
        'application/json': {
          schema: {
            type: 'array',
            items: { $ref: '#/components/schemas/AuthorizationResourceVO' },
          },
        },
      },
    });
  });

  it('keeps every protected route resource and the authoritative catalog in sync', () => {
    const resources = new Set<string>();
    for (const module of app.get(ModulesContainer).values()) {
      for (const wrapper of module.controllers.values()) {
        const controller = wrapper.metatype;
        if (!controller) continue;
        const classResource = Reflect.getMetadata(
          RESOURCE_SCOPE_METADATA,
          controller,
        ) as string | undefined;
        if (classResource) resources.add(classResource);
        const prototype = controller.prototype as Record<string, unknown>;
        for (const key of Object.getOwnPropertyNames(prototype)) {
          if (key === 'constructor') continue;
          const handler = prototype[key];
          if (typeof handler !== 'function') continue;
          const resource = Reflect.getMetadata(
            RESOURCE_SCOPE_METADATA,
            handler,
          ) as string | undefined;
          if (resource) resources.add(resource);
        }
      }
    }
    expect([...resources].sort()).toEqual(
      AUTHORIZATION_RESOURCES.map((item) => item.resourceKey),
    );
  });

  it('restricts API permission synchronization to system_admin', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/admin/permissions/sync')
      .set('authorization', 'Bearer test-44')
      .expect(403);
    expect(permissionCatalogSync).not.toHaveBeenCalled();

    await request(app.getHttpServer())
      .post('/api/v1/admin/permissions/sync')
      .set('authorization', 'Bearer test-42')
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toEqual({ created: 0, updated: 1, disabled: 0 });
      });
    expect(permissionCatalogSync).toHaveBeenCalledOnce();
  });

  it('denies a management principal without the required grants', () => {
    return request(app.getHttpServer())
      .get('/api/v1/admin/permissions/tree')
      .set('authorization', 'Bearer test-43')
      .expect(403)
      .expect(({ body, headers }) => {
        expect(body).toMatchObject({
          code: 403,
          data: null,
          traceId: headers['x-trace-id'],
        });
      });
  });

  it('protects custom field and group administration with separate grants', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/custom-fields')
      .set('authorization', 'Bearer test-43')
      .expect(403);

    await request(app.getHttpServer())
      .post('/api/v1/admin/custom-field-groups')
      .set('authorization', 'Bearer test-43')
      .send({
        entityType: 'ski_resort',
        groupKey: 'facilities',
        label: '设施',
      })
      .expect(403);
  });

  it('reads and atomically replaces role authorization snapshots behind RBAC', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/roles/7/permissions')
      .expect(401);

    const read = await request(app.getHttpServer())
      .get('/api/v1/admin/roles/7/permissions')
      .set('authorization', 'Bearer test-42')
      .expect(200);
    expect(read.body.data).toMatchObject({
      roleId: 7,
      permissionIds: [2],
      dataScopes: [{ resourceKey: 'resort', scopeType: 'merchant' }],
    });

    const updated = await request(app.getHttpServer())
      .put('/api/v1/admin/roles/7/permissions')
      .set('authorization', 'Bearer test-42')
      .send({
        permissionIds: [2],
        dataScopes: [
          { resourceKey: 'role', scopeType: 'selected', selectedIds: [7, 8] },
        ],
        fieldPolicies: [
          {
            entityType: 'ski_resort',
            fieldKey: 'lift_count',
            canRead: true,
            canWrite: false,
          },
        ],
      })
      .expect(200);

    expect(updated.body.data).toMatchObject({
      roleId: 7,
      permissionIds: [2],
      dataScopes: [
        { resourceKey: 'role', scopeType: 'selected', selectedIds: [7, 8] },
      ],
      fieldPolicies: [
        {
          entityType: 'ski_resort',
          fieldKey: 'lift_count',
          canRead: true,
          canWrite: false,
        },
      ],
    });
    expect(replaceRoleAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({
        roleId: 7,
        audit: expect.objectContaining({
          actorUserId: 42,
          traceId: updated.headers['x-trace-id'],
        }),
      }),
    );
  });

  it('exposes scoped role CRUD with validated DTOs and audit context', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/roles')
      .set('authorization', 'Bearer test-43')
      .expect(403);

    const list = await request(app.getHttpServer())
      .get('/api/v1/admin/roles?page=2&pageSize=10&keyword=resort')
      .set('authorization', 'Bearer test-42')
      .expect(200);
    expect(list.body.data).toMatchObject({
      items: [{ roleId: 7, roleKey: 'resort_operator' }],
      total: 1,
      page: 2,
      pageSize: 10,
      hasNext: false,
    });
    expect(managedRoleList).toHaveBeenCalledWith({
      skip: 10,
      take: 10,
      keyword: 'resort',
    });

    await request(app.getHttpServer())
      .get('/api/v1/admin/roles')
      .set('authorization', 'Bearer test-45')
      .expect(200);
    expect(managedRoleList).toHaveBeenLastCalledWith({
      skip: 0,
      take: 20,
      roleIds: [7],
    });

    await request(app.getHttpServer())
      .post('/api/v1/admin/roles')
      .set('authorization', 'Bearer test-45')
      .send({
        roleKey: 'blocked_create',
        roleName: '无范围创建',
        dataScope: 'self',
      })
      .expect(403);
    expect(managedRoleCreate).not.toHaveBeenCalled();

    const created = await request(app.getHttpServer())
      .post('/api/v1/admin/roles')
      .set('authorization', 'Bearer test-42')
      .send({
        roleKey: 'resort_reviewer',
        roleName: '雪场审核员',
        description: '审核雪场资料',
        dataScope: 'merchant',
      })
      .expect(201);
    expect(created.body.data).toMatchObject({ roleId: 8 });
    expect(managedRoleCreate).toHaveBeenCalledWith({
      role: {
        roleKey: 'resort_reviewer',
        roleName: '雪场审核员',
        description: '审核雪场资料',
        dataScope: 'merchant',
      },
      audit: expect.objectContaining({
        actorUserId: 42,
        traceId: created.headers['x-trace-id'],
      }),
    });

    await request(app.getHttpServer())
      .patch('/api/v1/admin/roles/7')
      .set('authorization', 'Bearer test-42')
      .send({ status: 'disabled' })
      .expect(200);
    expect(managedRoleUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ roleId: 7, patch: { status: 'disabled' } }),
    );

    await request(app.getHttpServer())
      .delete('/api/v1/admin/roles/7')
      .set('authorization', 'Bearer test-42')
      .expect(204);
    expect(managedRoleDisable).toHaveBeenCalledWith(
      expect.objectContaining({ roleId: 7 }),
    );
  });

  it('requires the protected system_admin role for authorization snapshot writes', async () => {
    await request(app.getHttpServer())
      .put('/api/v1/admin/roles/7/permissions')
      .set('authorization', 'Bearer test-44')
      .send({ permissionIds: [], dataScopes: [], fieldPolicies: [] })
      .expect(403);
    expect(replaceRoleAuthorization).not.toHaveBeenCalled();
  });

  it('restricts default scope configuration without blocking delegated role metadata management', async () => {
    for (const dataScope of ['self', 'merchant', 'all']) {
      await request(app.getHttpServer())
        .patch('/api/v1/admin/roles/7')
        .set('authorization', 'Bearer test-44')
        .send({ roleName: '不应保存', dataScope })
        .expect(403);
    }
    expect(managedRoleUpdate).not.toHaveBeenCalled();
    await request(app.getHttpServer())
      .patch('/api/v1/admin/roles/7')
      .set('authorization', 'Bearer test-44')
      .send({ roleName: '资料编辑', description: '允许维护' })
      .expect(200);
    expect(managedRoleUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        patch: { roleName: '资料编辑', description: '允许维护' },
      }),
    );
    for (const dataScope of ['merchant', 'all']) {
      await request(app.getHttpServer())
        .post('/api/v1/admin/roles')
        .set('authorization', 'Bearer test-44')
        .send({ roleKey: 'custom', roleName: '自定义', dataScope })
        .expect(403);
    }
    expect(managedRoleCreate).not.toHaveBeenCalled();
    await request(app.getHttpServer())
      .post('/api/v1/admin/roles')
      .set('authorization', 'Bearer test-44')
      .send({ roleKey: 'custom', roleName: '自定义', dataScope: 'self' })
      .expect(201);
    await request(app.getHttpServer())
      .patch('/api/v1/admin/roles/7')
      .set('authorization', 'Bearer test-42')
      .send({ dataScope: 'all' })
      .expect(200);
    expect(managedRoleUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        patch: { dataScope: 'all' },
      }),
    );
  });

  it('authorizes dictionary administration and validates dictionary DTOs', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/dictionaries?page=1&pageSize=5')
      .set('authorization', 'Bearer test-42')
      .expect(200);
    expect(managedDictionaryList).toHaveBeenCalledWith({
      skip: 0,
      take: 5,
    });

    await request(app.getHttpServer())
      .post('/api/v1/admin/dictionaries/resort.level/items')
      .set('authorization', 'Bearer test-42')
      .send({ label: 'Advanced', value: 'advanced', unexpected: true })
      .expect(400);
    expect(managedDictionaryCreateItem).not.toHaveBeenCalled();

    await request(app.getHttpServer())
      .get('/api/v1/admin/dictionaries')
      .set('authorization', 'Bearer test-43')
      .expect(403);

    const document = createOpenApiDocument(app);
    expect(document.info.version).toBe('1.55.0');
    expect(document.components?.schemas?.DictionaryTypeVO).toMatchObject({
      properties: {
        dictType: { type: 'string' },
        publiclyReadable: { type: 'boolean' },
        items: { type: 'array' },
      },
    });
    expect(document.components?.schemas?.DictionaryItemVO).toMatchObject({
      properties: {
        parentId: { type: 'number', nullable: true },
        children: { type: 'array' },
      },
    });
  });

  it('documents project knowledge source URLs as nullable strings in both write DTOs', () => {
    const document = createOpenApiDocument(app);
    for (const name of [
      'ProjectKnowledgeWriteDto',
      'UpdateProjectKnowledgeDto',
    ]) {
      expect(document.components?.schemas?.[name]).toMatchObject({
        properties: {
          sourceUrl: { type: 'string', nullable: true, maxLength: 2048 },
        },
      });
    }
  });

  it('publishes the confirmed own-profile DTO and response without writable identity fields', () => {
    const document = createOpenApiDocument(app);
    expect(document.info.version).toBe('1.55.0');
    expect(document.paths['/api/v1/account/profile']?.patch).toBeDefined();
    const schema = document.components?.schemas?.UpdateProfileDto;
    expect(
      schema && 'properties' in schema
        ? Object.keys(schema.properties ?? {}).sort()
        : [],
    ).toEqual(['avatarAssetId', 'nickname']);
    expect(schema).toMatchObject({
      properties: {
        nickname: { type: 'string', minLength: 1, maxLength: 50 },
        avatarAssetId: { type: 'string', nullable: true },
      },
    });
    const response = document.components?.schemas?.UserProfileVO;
    expect(
      response && 'properties' in response
        ? Object.keys(response.properties ?? {}).sort()
        : [],
    ).toEqual(['account', 'avatarAssetId', 'avatarUrl', 'nickname', 'userId']);
    expect(response).toMatchObject({
      properties: {
        avatarAssetId: { nullable: true },
        avatarUrl: { nullable: true },
      },
    });
  });

  it('documents dictionary item detail with a positive int4 ID and the existing tree VO', () => {
    const document = createOpenApiDocument(app);
    const operation =
      document.paths['/api/v1/admin/dictionaries/{dictType}/items/{itemId}']
        ?.get;
    expect(operation?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'itemId',
          in: 'path',
          required: true,
          schema: { type: 'integer', minimum: 1, maximum: 2147483647 },
        }),
      ]),
    );
    expect(operation?.responses).toMatchObject({
      '200': {
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/DictionaryItemVO' },
          },
        },
      },
    });
  });

  it('publishes typed community request and response schemas in OpenAPI', () => {
    const document = createOpenApiDocument(app);
    expect(document.info.version).toBe('1.55.0');
    for (const name of ['DynamicWriteDto', 'UpdateDynamicDto']) {
      expect(document.components?.schemas?.[name]).toMatchObject({
        properties: { imageAssetIds: { type: 'array' } },
      });
      expect(document.components?.schemas?.[name]).not.toMatchObject({
        properties: { imageAssetIds: { maxItems: expect.anything() } },
      });
    }
    expect(document.paths['/api/v1/admin/dynamics']?.get).toBeDefined();
    expect(
      document.paths['/api/v1/admin/dynamics/{id}/comments']?.get,
    ).toBeDefined();
    expect(
      document.paths['/api/v1/admin/dynamics/{id}/moderation']?.patch,
    ).toBeDefined();
    expect(
      document.paths['/api/v1/admin/comments/{id}/moderation']?.patch,
    ).toBeDefined();
    expect(document.paths['/api/v1/dynamics']?.get?.responses).toMatchObject({
      '200': {
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/DynamicFeedVO' },
          },
        },
      },
    });
    expect(
      document.paths['/api/v1/dynamics/{id}/comments']?.get?.responses,
    ).toMatchObject({
      '200': {
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/CommentPageVO' },
          },
        },
      },
    });
    expect(document.components?.schemas?.DynamicDetailVO).toMatchObject({
      properties: expect.not.objectContaining({ comments: expect.anything() }),
    });
    const limitParameter = document.paths[
      '/api/v1/dynamics'
    ]?.get?.parameters?.find(
      (parameter) => 'name' in parameter && parameter.name === 'limit',
    );
    expect(limitParameter).toMatchObject({
      name: 'limit',
      in: 'query',
      schema: { type: 'number', minimum: 1, maximum: 100 },
    });
  });

  it('documents only the approved operation log read projection and filters', () => {
    const document = createOpenApiDocument(app);
    expect(document.info.version).toBe('1.55.0');
    const endpoint = document.paths['/api/v1/admin/operation-logs'];
    expect(Object.keys(endpoint ?? {})).toEqual(['get']);
    expect(
      endpoint?.get?.parameters?.map((parameter) =>
        'name' in parameter ? parameter.name : '',
      ),
    ).toEqual(
      expect.arrayContaining([
        'page',
        'pageSize',
        'actorUserId',
        'actionKey',
        'resourceKey',
        'result',
        'traceId',
        'fromTime',
        'toTime',
      ]),
    );
    expect(document.components?.schemas?.OperationLogVO).toMatchObject({
      properties: {
        operationLogId: { type: 'string' },
        actorAccountSnapshot: { type: 'string' },
        createdAt: { format: 'date-time' },
      },
    });
    for (const hidden of ['reason', 'metadata', 'clientIp', 'userAgent'])
      expect(document.components?.schemas?.OperationLogVO).not.toHaveProperty(
        `properties.${hidden}`,
      );
    expect(document.paths['/api/v1/admin/operation-logs/{id}']).toBeUndefined();
  });

  it('publishes the confirmed public article query contract in OpenAPI', () => {
    const document = createOpenApiDocument(app);
    expect(document.info.version).toBe('1.55.0');
    expect(
      document.paths['/api/v1/knowledge/categories']?.get?.responses,
    ).toMatchObject({
      '200': {
        content: {
          'application/json': {
            schema: {
              type: 'array',
              items: { $ref: '#/components/schemas/PublicArticleCategoryVO' },
            },
          },
        },
      },
    });
    expect(document.paths['/api/v1/articles']?.get?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'page',
          schema: expect.objectContaining({ type: 'number', minimum: 1 }),
        }),
        expect.objectContaining({
          name: 'pageSize',
          schema: expect.objectContaining({
            type: 'number',
            minimum: 1,
            maximum: 100,
          }),
        }),
        expect.objectContaining({ name: 'keyword' }),
        expect.objectContaining({ name: 'categoryValue' }),
      ]),
    );
    expect(
      document.paths['/api/v1/articles/{id}']?.get?.responses,
    ).toMatchObject({
      '200': {
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/PublicArticleDetailVO' },
          },
        },
      },
    });
  });

  it('enforces RBAC and passes resolved scope to managed-user operations', async () => {
    const listed = await request(app.getHttpServer())
      .get('/api/v1/admin/users?page=2&pageSize=5')
      .set('authorization', 'Bearer test-42')
      .expect(200);
    expect(managedUserList).toHaveBeenCalledWith({
      page: 2,
      pageSize: 5,
      keyword: undefined,
      status: undefined,
      scope: { kind: 'all' },
    });
    expect(listed.body.data.items[0]).not.toHaveProperty('passwordHash');

    const created = await request(app.getHttpServer())
      .post('/api/v1/admin/users')
      .set('authorization', 'Bearer test-42')
      .send({
        account: ' New.User ',
        nickname: ' New User ',
        password: 'initial-password',
        roleIds: [],
      })
      .expect(201);
    expect(managedUserCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        account: 'new.user',
        nickname: 'New User',
        audit: expect.objectContaining({ actorUserId: 42 }),
      }),
    );
    expect(created.body.data).not.toHaveProperty('password');
    expect(created.body.data).not.toHaveProperty('passwordHash');

    await request(app.getHttpServer())
      .get('/api/v1/admin/users')
      .set('authorization', 'Bearer test-43')
      .expect(403);
  });

  it('routes managed-user role/status changes and self-service password updates', async () => {
    await request(app.getHttpServer())
      .put('/api/v1/admin/users/99/roles')
      .set('authorization', 'Bearer test-42')
      .send({ roleIds: [7] })
      .expect(200);
    expect(managedUserReplaceRoles).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 99,
        roleIds: [7],
      }),
    );

    await request(app.getHttpServer())
      .patch('/api/v1/admin/users/99/status')
      .set('authorization', 'Bearer test-42')
      .send({ status: 'disabled' })
      .expect(200);
    expect(managedUserSetStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 99,
        status: 'disabled',
      }),
    );

    await request(app.getHttpServer())
      .patch('/api/v1/account/password')
      .set('authorization', 'Bearer test-42')
      .send({
        currentPassword: 'demo-pass-2026',
        newPassword: 'new-password-2026',
      })
      .expect(204);
    expect(passwordChangeUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 42,
        expectedPasswordHash: 'hashed-demo-password',
        passwordHash: 'hashed-new-password',
      }),
    );
  });

  it('requires the upload grant and derives asset ownership from the authenticated principal', async () => {
    const pngHeader = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const uploaded = await request(app.getHttpServer())
      .post('/api/v1/assets')
      .set('authorization', 'Bearer test-42')
      .field('ownerUserId', '999')
      .attach('file', pngHeader, {
        filename: '../cover.png',
        contentType: 'text/plain',
      })
      .expect(201);

    expect(assetCreatePending).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: 42,
        originalName: 'cover.png',
        mimeType: 'image/png',
      }),
    );
    expect(assetScan).toHaveBeenCalledOnce();
    expect(assetStoragePut).toHaveBeenCalledWith(
      expect.objectContaining({ contentType: 'image/png' }),
    );
    expect(assetSetStatus).toHaveBeenCalledWith('52', 'ready');
    expect(uploaded.body.data).toMatchObject({
      assetId: '52',
      status: 'ready',
    });
    expect(uploaded.body.data.url).toBe('https://assets.example/signed');

    await request(app.getHttpServer())
      .post('/api/v1/assets')
      .set('authorization', 'Bearer test-43')
      .attach('file', pngHeader, { filename: 'cover.png' })
      .expect(403);
    expect(assetCreatePending).toHaveBeenCalledOnce();
  });

  it('authorizes admin asset listing, validates filters, and applies paging filters', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/assets')
      .set('authorization', 'Bearer test-43')
      .expect(403);
    expect(adminAssetFindPage).not.toHaveBeenCalled();

    await request(app.getHttpServer())
      .get(
        '/api/v1/admin/assets?page=2&pageSize=10&status=ready&ownerUserId=9&keyword=cover',
      )
      .set('authorization', 'Bearer test-42')
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toMatchObject({
          total: 1,
          page: 2,
          pageSize: 10,
          items: [
            {
              assetId: '52',
              ownerAccount: 'uploader',
              references: { coverResorts: 0 },
            },
          ],
        });
      });
    expect(adminAssetFindPage).toHaveBeenCalledWith({
      access: { kind: 'all' },
      skip: 10,
      take: 10,
      status: 'ready',
      ownerUserId: 9,
      keyword: 'cover',
    });

    await request(app.getHttpServer())
      .get('/api/v1/admin/assets?pageSize=101')
      .set('authorization', 'Bearer test-42')
      .expect(400);
    expect(adminAssetFindPage).toHaveBeenCalledOnce();
  });

  it.each(['self', 'selected', 'merchant'] as const)(
    'passes supported scope to the asset repository and denies merchant scope: %s',
    async (scopeType) => {
      scopedResortPrincipal = {
        userId: 47,
        status: 'active',
        merchant: { id: 27, status: 'active' },
        roles: [
          {
            key: 'custom_asset_operator',
            status: 'active',
            dataScope: 'all',
            permissions: [
              'management:portal:enter',
              'content:asset:list',
              'content:asset:delete',
            ].map((key) => ({ key, status: 'active' })),
            dataScopes: [
              {
                resourceKey: 'asset',
                scopeType,
                scopeConfig:
                  scopeType === 'selected' ? { selectedIds: [52] } : null,
              },
            ],
          },
        ],
      };
      await request(app.getHttpServer())
        .get('/api/v1/admin/assets')
        .set('authorization', 'Bearer test-47')
        .expect(scopeType === 'merchant' ? 403 : 200);
      await request(app.getHttpServer())
        .get('/api/v1/admin/assets/52')
        .set('authorization', 'Bearer test-47')
        .expect(scopeType === 'merchant' ? 403 : 200);
      await request(app.getHttpServer())
        .delete('/api/v1/admin/assets/52')
        .set('authorization', 'Bearer test-47')
        .expect(scopeType === 'merchant' ? 403 : 204);
      if (scopeType !== 'merchant') {
        const access =
          scopeType === 'self'
            ? { kind: 'self', userId: 47 }
            : { kind: 'selected', ids: [52] };
        expect(adminAssetFindPage).toHaveBeenCalledWith(
          expect.objectContaining({ access }),
        );
        expect(adminAssetFindById).toHaveBeenCalledWith('52', access);
        expect(adminAssetDelete).toHaveBeenCalledWith(
          expect.objectContaining({ access }),
        );
        return;
      }
      expect(adminAssetFindPage).not.toHaveBeenCalled();
      expect(adminAssetFindById).not.toHaveBeenCalled();
      expect(adminAssetDelete).not.toHaveBeenCalled();
    },
  );

  it('blocks referenced admin asset deletion and audits an unreferenced deletion', async () => {
    adminAssetFindById.mockResolvedValueOnce({
      assetId: '52',
      ownerUserId: 9,
      ownerAccount: 'uploader',
      storageKey: 'assets/9/52.png',
      originalName: 'cover.png',
      mimeType: 'image/png',
      sizeBytes: '1024',
      status: 'ready',
      createdAt: new Date('2026-10-27T00:00:00.000Z'),
      references: {
        coverResorts: 1,
        resortImages: 0,
        articleCovers: 0,
        dynamicImages: 0,
        userAvatars: 0,
      },
    });
    await request(app.getHttpServer())
      .delete('/api/v1/admin/assets/52')
      .set('authorization', 'Bearer test-42')
      .expect(422);
    expect(adminAssetDelete).not.toHaveBeenCalled();

    await request(app.getHttpServer())
      .delete('/api/v1/admin/assets/52')
      .set('authorization', 'Bearer test-42')
      .expect(204);
    expect(adminAssetDelete).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: '52',
        actorUserId: 42,
        traceId: expect.any(String),
        clientIp: expect.any(String),
        userAgent: null,
      }),
    );
  });

  it('authorizes global resort management and validates administrator rating fields', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/resorts')
      .set('authorization', 'Bearer test-43')
      .expect(403);
    expect(adminResortList).not.toHaveBeenCalled();

    await request(app.getHttpServer())
      .get('/api/v1/admin/resorts?page=2&pageSize=10&merchantId=7')
      .set('authorization', 'Bearer test-42')
      .expect(200);
    expect(adminResortList).toHaveBeenCalledWith(
      {
        page: 2,
        pageSize: 10,
        keyword: undefined,
        status: undefined,
        merchantId: 7,
      },
      { kind: 'all' },
      42,
    );

    const body = {
      name: '雪峰测试场',
      price: 520,
      openStatus: 'open',
      snowCondition: '粉雪',
      description: '测试用雪场',
    };
    await request(app.getHttpServer())
      .post('/api/v1/admin/resorts')
      .set('authorization', 'Bearer test-42')
      .send({ ...body, rating: 'not-a-number' })
      .expect(400);
    expect(adminResortCreate).not.toHaveBeenCalled();

    await request(app.getHttpServer())
      .post('/api/v1/admin/resorts')
      .set('authorization', 'Bearer test-42')
      .send({ ...body, merchantId: '7', rating: 4.5, ratingCount: 12 })
      .expect(201);
    expect(adminResortCreate).toHaveBeenCalledWith(
      {
        ...body,
        merchantId: 7,
        rating: 4.5,
        ratingCount: 12,
      },
      expect.objectContaining({
        actorUserId: 42,
        traceId: expect.any(String),
        clientIp: expect.any(String),
        userAgent: null,
      }),
      { kind: 'all' },
    );

    await request(app.getHttpServer())
      .patch('/api/v1/admin/resorts/502')
      .set('authorization', 'Bearer test-42')
      .send({ rating: 5.5 })
      .expect(400);
    expect(adminResortUpdate).not.toHaveBeenCalled();

    await request(app.getHttpServer())
      .get('/api/v1/admin/resorts/502')
      .set('authorization', 'Bearer test-42')
      .expect(200);
    expect(adminResortGet).toHaveBeenCalledWith(502, { kind: 'all' }, 42);

    await request(app.getHttpServer())
      .patch('/api/v1/admin/resorts/502')
      .set('authorization', 'Bearer test-42')
      .send({ name: '雪峰新名称' })
      .expect(200);
    expect(adminResortUpdate).toHaveBeenCalledWith(
      502,
      { name: '雪峰新名称' },
      expect.objectContaining({ actorUserId: 42 }),
      { kind: 'all' },
    );

    await request(app.getHttpServer())
      .delete('/api/v1/admin/resorts/502')
      .set('authorization', 'Bearer test-43')
      .expect(403);
    expect(adminResortRemove).not.toHaveBeenCalled();
    await request(app.getHttpServer())
      .delete('/api/v1/admin/resorts/502')
      .set('authorization', 'Bearer test-42')
      .expect(204);
    expect(adminResortRemove).toHaveBeenCalledWith(
      502,
      expect.objectContaining({ actorUserId: 42 }),
      { kind: 'all' },
    );

    await request(app.getHttpServer())
      .patch('/api/v1/admin/resorts/502/publish')
      .set('authorization', 'Bearer test-43')
      .expect(403);
    await request(app.getHttpServer())
      .patch('/api/v1/admin/resorts/502/publish')
      .set('authorization', 'Bearer test-42')
      .expect(200);
    expect(adminResortPublish).toHaveBeenCalledWith(
      502,
      expect.objectContaining({ actorUserId: 42 }),
      { kind: 'all' },
      undefined,
    );

    await request(app.getHttpServer())
      .patch('/api/v1/admin/resorts/502/offline')
      .set('authorization', 'Bearer test-43')
      .expect(403);
    await request(app.getHttpServer())
      .patch('/api/v1/admin/resorts/502/offline')
      .set('authorization', 'Bearer test-42')
      .expect(200);
    expect(adminResortOffline).toHaveBeenCalledWith(
      502,
      expect.objectContaining({ actorUserId: 42 }),
      { kind: 'all' },
      undefined,
    );
  });

  it.each(['self', 'merchant', 'selected', 'all'])(
    'enforces global resort scope independently of action grants and role name: %s',
    async (scopeType) => {
      scopedResortPrincipal = {
        userId: 47,
        status: 'active',
        merchant: { id: 7, status: 'active' },
        roles: [
          {
            key: 'custom_resort_manager',
            status: 'active',
            dataScope: 'all',
            permissions: principalRecord.roles[0]!.permissions.filter(
              ({ key }) =>
                key === 'management:portal:enter' ||
                key.startsWith('content:resort:'),
            ),
            dataScopes: [
              {
                resourceKey: 'resort',
                scopeType,
                scopeConfig:
                  scopeType === 'selected' ? { selectedIds: [502] } : null,
              },
            ],
          },
        ],
      };
      const body = {
        name: 'Scoped test',
        price: 100,
        openStatus: 'open',
        snowCondition: 'powder',
        description: 'Scoped test',
      };
      const routes = [
        { method: 'get', path: '/admin/resorts', success: 200 },
        { method: 'get', path: '/admin/resorts/502', success: 200 },
        { method: 'post', path: '/admin/resorts', success: 201 },
        { method: 'patch', path: '/admin/resorts/502', success: 200 },
        { method: 'delete', path: '/admin/resorts/502', success: 204 },
        { method: 'patch', path: '/admin/resorts/502/publish', success: 200 },
        { method: 'patch', path: '/admin/resorts/502/offline', success: 200 },
      ] as const;
      for (const route of routes) {
        const call = request(app.getHttpServer())
          [route.method](`/api/v1${route.path}`)
          .set('authorization', 'Bearer test-47');
        if (
          route.method === 'post' ||
          (route.method === 'patch' && route.path === '/admin/resorts/502')
        )
          call.send(body);
        await call.expect(scopeType === 'all' ? route.success : 403);
      }
      const services = [
        adminResortList,
        adminResortGet,
        adminResortCreate,
        adminResortUpdate,
        adminResortRemove,
        adminResortPublish,
        adminResortOffline,
      ];
      for (const service of services) {
        if (scopeType === 'all') expect(service).toHaveBeenCalledOnce();
        else expect(service).not.toHaveBeenCalled();
      }
    },
  );

  it('authorizes article management, rejects client-supplied status and exposes explicit lifecycle commands', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/articles')
      .set('authorization', 'Bearer test-43')
      .expect(403);
    expect(adminArticleList).not.toHaveBeenCalled();

    await request(app.getHttpServer())
      .get('/api/v1/admin/articles?page=2&pageSize=10&status=draft')
      .set('authorization', 'Bearer test-42')
      .expect(200);
    expect(adminArticleList).toHaveBeenCalledWith(
      {
        page: 2,
        pageSize: 10,
        keyword: undefined,
        status: 'draft',
      },
      { kind: 'all' },
      42,
    );

    const body = {
      title: '滑雪基础',
      summary: '安全入门',
      body: '正文',
      categoryValue: 'basics',
    };
    await request(app.getHttpServer())
      .post('/api/v1/admin/articles')
      .set('authorization', 'Bearer test-42')
      .send({ ...body, status: 'published' })
      .expect(400);
    expect(adminArticleCreate).not.toHaveBeenCalled();

    await request(app.getHttpServer())
      .post('/api/v1/admin/articles')
      .set('authorization', 'Bearer test-42')
      .send(body)
      .expect(201);
    expect(adminArticleCreate).toHaveBeenCalledWith(
      body,
      expect.objectContaining({ actorUserId: 42, traceId: expect.any(String) }),
      { kind: 'all' },
    );

    await request(app.getHttpServer())
      .patch('/api/v1/admin/articles/19/withdraw')
      .set('authorization', 'Bearer test-43')
      .expect(403);
    expect(adminArticleWithdraw).not.toHaveBeenCalled();
    await request(app.getHttpServer())
      .patch('/api/v1/admin/articles/19/withdraw')
      .set('authorization', 'Bearer test-42')
      .expect(200);
    expect(adminArticleWithdraw).toHaveBeenCalledWith(
      19,
      expect.objectContaining({ actorUserId: 42 }),
      { kind: 'all' },
    );

    await request(app.getHttpServer())
      .delete('/api/v1/admin/articles/19')
      .set('authorization', 'Bearer test-42')
      .expect(204);
    expect(adminArticleRemove).toHaveBeenCalledWith(
      19,
      expect.objectContaining({ actorUserId: 42 }),
      { kind: 'all' },
    );
  });

  it.each(['self', 'selected', 'all', 'merchant'] as const)(
    'forwards D-39 article scope and blocks unsupported creation before use case: %s',
    async (scopeType) => {
      scopedResortPrincipal = {
        userId: 47,
        status: 'active',
        merchant: { id: 7, status: 'active' },
        roles: [
          {
            key: 'custom_content_editor',
            status: 'active',
            dataScope: 'all',
            permissions: [
              { key: 'management:portal:enter', status: 'active' },
              { key: 'content:article:manage', status: 'active' },
            ],
            dataScopes: [
              {
                resourceKey: 'article',
                scopeType,
                scopeConfig:
                  scopeType === 'selected' ? { selectedIds: [19] } : null,
              },
            ],
          },
        ],
      };
      const body = {
        title: 'Ski basics',
        summary: 'Summary',
        body: 'Body',
        categoryValue: 'basics',
      };
      const access =
        scopeType === 'self'
          ? { kind: 'self', userId: 47 }
          : scopeType === 'selected'
            ? { kind: 'selected', ids: [19] }
            : { kind: 'all' };
      await request(app.getHttpServer())
        .get('/api/v1/admin/articles')
        .set('authorization', 'Bearer test-47')
        .expect(scopeType === 'merchant' ? 403 : 200);
      await request(app.getHttpServer())
        .get('/api/v1/admin/articles/19')
        .set('authorization', 'Bearer test-47')
        .expect(scopeType === 'merchant' ? 403 : 200);
      await request(app.getHttpServer())
        .post('/api/v1/admin/articles')
        .set('authorization', 'Bearer test-47')
        .send(body)
        .expect(
          scopeType === 'merchant' || scopeType === 'selected' ? 403 : 201,
        );
      await request(app.getHttpServer())
        .patch('/api/v1/admin/articles/19')
        .set('authorization', 'Bearer test-47')
        .send(body)
        .expect(scopeType === 'merchant' ? 403 : 200);
      for (const command of ['publish', 'withdraw'])
        await request(app.getHttpServer())
          .patch(`/api/v1/admin/articles/19/${command}`)
          .set('authorization', 'Bearer test-47')
          .expect(scopeType === 'merchant' ? 403 : 200);
      await request(app.getHttpServer())
        .delete('/api/v1/admin/articles/19')
        .set('authorization', 'Bearer test-47')
        .expect(scopeType === 'merchant' ? 403 : 204);
      if (scopeType === 'merchant') {
        for (const handler of [
          adminArticleList,
          adminArticleGet,
          adminArticleCreate,
          adminArticleUpdate,
          adminArticlePublish,
          adminArticleWithdraw,
          adminArticleRemove,
        ])
          expect(handler).not.toHaveBeenCalled();
      } else {
        expect(adminArticleList).toHaveBeenCalledWith(
          expect.anything(),
          access,
          47,
        );
        expect(adminArticleGet).toHaveBeenCalledWith(19, access, 47);
        expect(adminArticleUpdate).toHaveBeenCalledWith(
          19,
          body,
          expect.objectContaining({ actorUserId: 47 }),
          access,
        );
        for (const handler of [
          adminArticlePublish,
          adminArticleWithdraw,
          adminArticleRemove,
        ])
          expect(handler).toHaveBeenCalledWith(
            19,
            expect.objectContaining({ actorUserId: 47 }),
            access,
          );
        if (scopeType === 'selected')
          expect(adminArticleCreate).not.toHaveBeenCalled();
        else
          expect(adminArticleCreate).toHaveBeenCalledWith(
            body,
            expect.objectContaining({ actorUserId: 47 }),
            access,
          );
      }
    },
  );
  it('rejects conflicting article scopes before invoking any article handler', async () => {
    scopedResortPrincipal = {
      userId: 47,
      status: 'active',
      merchant: null,
      roles: ['self', 'all'].map((scopeType) => ({
        key: `editor_${scopeType}`,
        status: 'active',
        dataScope: scopeType,
        permissions: [
          { key: 'management:portal:enter', status: 'active' },
          { key: 'content:article:manage', status: 'active' },
        ],
        dataScopes: [{ resourceKey: 'article', scopeType, scopeConfig: null }],
      })),
    };
    await request(app.getHttpServer())
      .get('/api/v1/admin/articles')
      .set('authorization', 'Bearer test-47')
      .expect(403);
    expect(adminArticleList).not.toHaveBeenCalled();
  });
  it('rejects role authorization requests without all required grants or valid DTOs', async () => {
    await request(app.getHttpServer())
      .put('/api/v1/admin/roles/7/permissions')
      .set('authorization', 'Bearer test-43')
      .send({ permissionIds: [], dataScopes: [], fieldPolicies: [] })
      .expect(403);
    expect(replaceRoleAuthorization).not.toHaveBeenCalled();

    await request(app.getHttpServer())
      .put('/api/v1/admin/roles/7/permissions')
      .set('authorization', 'Bearer test-42')
      .send({
        permissionIds: [2, 2],
        dataScopes: [],
        fieldPolicies: [],
      })
      .expect(400);
    expect(replaceRoleAuthorization).not.toHaveBeenCalled();
  });

  it('maps protected system_admin authorization mutation to forbidden', async () => {
    replaceRoleAuthorization.mockRejectedValueOnce(
      new ProtectedSystemRoleError(),
    );
    await request(app.getHttpServer())
      .put('/api/v1/admin/roles/1/permissions')
      .set('authorization', 'Bearer test-42')
      .send({ permissionIds: [], dataScopes: [], fieldPolicies: [] })
      .expect(403);
  });

  it('denies routes that do not declare authorization metadata', () => {
    return request(app.getHttpServer())
      .get('/api/v1/authorization-unconfigured-test')
      .expect(403)
      .expect(({ body }) => {
        expect(body.code).toBe(403);
        expect(body.data).toBeNull();
      });
  });

  it('lets method-level permission metadata override a public controller', () => {
    return request(app.getHttpServer())
      .get('/api/v1/authorization-test/method-protected')
      .expect(401)
      .expect(({ body }) => {
        expect(body.code).toBe(401);
        expect(body.data).toBeNull();
      });
  });

  it('documents the shared health response envelope in OpenAPI', () => {
    const document = createOpenApiDocument(app);
    const response = document.paths['/api/v1/health']?.get?.responses?.['200'];
    const responseSchema =
      response && 'content' in response
        ? response.content?.['application/json']?.schema
        : undefined;

    expect(responseSchema).toEqual({
      $ref: '#/components/schemas/HealthResponseVO',
    });
    expect(document.components?.schemas?.HealthResponseVO).toMatchObject({
      properties: {
        code: { type: 'number', example: 200 },
        msg: { type: 'string', example: 'success' },
        data: { $ref: '#/components/schemas/HealthVO' },
        traceId: { type: 'string', format: 'uuid' },
      },
    });
  });

  it('documents the current user role keys used by management clients', () => {
    const document = createOpenApiDocument(app);
    const currentUser = document.components?.schemas?.CurrentUserVO;

    expect(document.info.version).toBe('1.55.0');
    expect(currentUser).toMatchObject({
      properties: {
        roles: {
          type: 'array',
          items: { $ref: '#/components/schemas/CurrentUserRoleVO' },
        },
      },
    });
    expect(document.components?.schemas?.CurrentUserRoleVO).toMatchObject({
      properties: {
        roleKey: { type: 'string' },
        roleName: { type: 'string' },
      },
      required: ['roleKey', 'roleName'],
    });
  });

  it('documents the existing global resort response projection for every operation', () => {
    const document = createOpenApiDocument(app);
    expect(document.components?.schemas?.AdminResortVO).toMatchObject({
      properties: {
        merchantId: { type: 'integer', nullable: true },
        merchantName: { type: 'string', nullable: true },
        rating: { type: 'string', nullable: true },
        longitude: { type: 'string', nullable: true },
        customFields: {
          type: 'array',
          items: { $ref: '#/components/schemas/AdminResortCustomFieldVO' },
        },
        fitTags: {
          type: 'array',
          items: { $ref: '#/components/schemas/AdminResortFitTagVO' },
        },
      },
    });
    for (const [path, method, status, type] of [
      ['/api/v1/admin/resorts', 'get', '200', 'AdminResortPageVO'],
      ['/api/v1/admin/resorts', 'post', '201', 'AdminResortVO'],
      ['/api/v1/admin/resorts/{id}', 'get', '200', 'AdminResortVO'],
      ['/api/v1/admin/resorts/{id}', 'patch', '200', 'AdminResortVO'],
      ['/api/v1/admin/resorts/{id}/publish', 'patch', '200', 'AdminResortVO'],
      ['/api/v1/admin/resorts/{id}/offline', 'patch', '200', 'AdminResortVO'],
    ] as const) {
      expect(document.paths[path]?.[method]?.responses?.[status]).toMatchObject(
        {
          content: {
            'application/json': {
              schema: { $ref: `#/components/schemas/${type}` },
            },
          },
        },
      );
    }
    expect(
      document.paths['/api/v1/admin/resorts/custom-fields']?.get?.responses?.[
        '200'
      ],
    ).toMatchObject({
      content: {
        'application/json': {
          schema: { properties: { groups: { type: 'array' } } },
        },
      },
    });
  });

  it('documents nullable admin resort ownership and rating as numeric values', () => {
    const document = createOpenApiDocument(app);
    for (const name of ['CreateAdminResortDto', 'UpdateAdminResortDto']) {
      expect(document.components?.schemas?.[name]).toMatchObject({
        properties: {
          merchantId: { type: 'integer', minimum: 1, nullable: true },
          rating: { type: 'number', minimum: 0, maximum: 5, nullable: true },
        },
      });
    }
    expect(
      document.paths['/api/v1/admin/resorts']?.post?.requestBody,
    ).toMatchObject({
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/CreateAdminResortDto' },
        },
      },
    });
    expect(
      document.paths['/api/v1/admin/resorts/{id}']?.patch?.requestBody,
    ).toMatchObject({
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/UpdateAdminResortDto' },
        },
      },
    });
  });

  it('documents the merchant resort create and patch DTOs', () => {
    const document = createOpenApiDocument(app);
    const create = document.components?.schemas?.CreateMerchantResortDto;
    const update = document.components?.schemas?.UpdateMerchantResortDto;
    expect(create).toMatchObject({
      required: ['name', 'price', 'openStatus', 'snowCondition', 'description'],
      properties: {
        name: { type: 'string', maxLength: 100 },
        province: { type: 'string', nullable: true },
        longitude: { type: 'number', nullable: true },
        galleryAssetIds: { type: 'array', maxItems: 30 },
        openStatus: { enum: ['open', 'closed', 'limited', 'unknown'] },
      },
    });
    expect(update).toMatchObject({
      type: 'object',
      properties: {
        name: { type: 'string' },
        customFields: { type: 'object' },
      },
    });
    expect(
      document.paths['/api/v1/merchant/resorts']?.post?.requestBody,
    ).toBeDefined();
    expect(
      document.paths['/api/v1/merchant/resorts/{id}']?.patch?.requestBody,
    ).toBeDefined();
    expect(
      document.paths['/api/v1/merchant/resorts/custom-fields']?.get
        ?.responses?.['200'],
    ).toMatchObject({
      description: 'Active custom field definitions with effective access.',
      content: {
        'application/json': {
          schema: {
            properties: {
              entityType: { type: 'string', example: 'ski_resort' },
              groups: {
                items: {
                  properties: {
                    fields: {
                      items: {
                        properties: {
                          canRead: { type: 'boolean' },
                          canWrite: { type: 'boolean' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
  });

  it('publishes the approved system configuration routes and fixed public projection', () => {
    const document = createOpenApiDocument(app);
    expect(document.info.version).toBe('1.55.0');
    expect(Object.keys(document.paths['/api/v1/admin/config'] ?? {})).toEqual([
      'get',
    ]);
    expect(
      Object.keys(document.paths['/api/v1/admin/config/{configKey}'] ?? {}),
    ).toEqual(['patch']);
    expect(Object.keys(document.paths['/api/v1/public/config'] ?? {})).toEqual([
      'get',
    ]);
    expect(document.components?.schemas?.UpdateSystemConfigDto).toMatchObject({
      required: ['value', 'expectedVersion'],
      properties: {
        value: { type: 'string', maxLength: 30000 },
        expectedVersion: { type: 'number', minimum: 0, maximum: 2147483647 },
      },
    });
    const projection = document.components?.schemas?.PublicSiteConfigVO;
    if (!projection || !('properties' in projection))
      throw new Error('Missing public config schema');
    expect(Object.keys(projection.properties ?? {}).sort()).toEqual(
      [
        'about',
        'contactEmail',
        'privacyPolicy',
        'revision',
        'siteName',
        'tagline',
        'termsOfService',
      ].sort(),
    );
  });

  it('documents the revenue API and CSV upload contract', () => {
    const document = createOpenApiDocument(app);
    expect(document.info.version).toBe('1.55.0');
    expect(document.paths['/api/v1/merchant/revenue']?.get).toBeDefined();
    expect(
      document.paths['/api/v1/merchant/revenue/summary']?.get,
    ).toBeDefined();
    expect(
      document.paths['/api/v1/admin/revenue']?.put?.requestBody,
    ).toBeDefined();
    expect(
      document.paths['/api/v1/admin/revenue/import']?.post?.requestBody,
    ).toMatchObject({
      content: {
        'multipart/form-data': {
          schema: {
            required: ['file'],
            properties: { file: { type: 'string', format: 'binary' } },
          },
        },
      },
    });
    expect(document.components?.schemas?.RevenueImportResultVO).toBeDefined();
  });

  it('documents public resort pagination as numbers and the complete filter query', () => {
    const document = createOpenApiDocument(app);
    const parameters = document.paths['/api/v1/resorts']?.get?.parameters;
    expect(parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'page',
          in: 'query',
          schema: expect.objectContaining({
            type: 'number',
            minimum: 1,
            default: 1,
          }),
        }),
        expect.objectContaining({
          name: 'pageSize',
          in: 'query',
          schema: expect.objectContaining({
            type: 'number',
            minimum: 1,
            maximum: 100,
            default: 20,
          }),
        }),
        expect.objectContaining({ name: 'district', in: 'query' }),
        expect.objectContaining({
          name: 'fitTags',
          in: 'query',
          schema: expect.objectContaining({ type: 'array' }),
        }),
        expect.objectContaining({ name: 'minPrice', in: 'query' }),
        expect.objectContaining({ name: 'maxPrice', in: 'query' }),
        expect.objectContaining({ name: 'minRating', in: 'query' }),
        expect.objectContaining({ name: 'latitude', in: 'query' }),
        expect.objectContaining({ name: 'longitude', in: 'query' }),
        expect.objectContaining({
          name: 'sortBy',
          in: 'query',
          schema: expect.objectContaining({
            enum: ['name', 'price', 'rating', 'distance'],
          }),
        }),
        expect.objectContaining({
          name: 'sortOrder',
          in: 'query',
          schema: expect.objectContaining({ enum: ['asc', 'desc'] }),
        }),
      ]),
    );
  });
  it('documents the existing merchant resort projection and pagination without storage keys', () => {
    const document = createOpenApiDocument(app);
    const page = {
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/MerchantResortPageVO' },
        },
      },
    };
    const detail = {
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/MerchantResortVO' },
        },
      },
    };
    expect(
      document.paths['/api/v1/merchant/resorts']?.get?.responses?.['200'],
    ).toMatchObject(page);
    expect(
      document.paths['/api/v1/merchant/resorts']?.post?.responses?.['201'],
    ).toMatchObject(detail);
    expect(
      document.paths['/api/v1/merchant/resorts/{id}']?.get?.responses?.['200'],
    ).toMatchObject(detail);
    expect(
      document.paths['/api/v1/merchant/resorts/{id}']?.patch?.responses?.[
        '200'
      ],
    ).toMatchObject(detail);
    expect(
      document.paths['/api/v1/merchant/resorts/{id}/submit-review']?.patch
        ?.responses?.['200'],
    ).toMatchObject(detail);
    expect(document.paths['/api/v1/merchant/resorts']?.get?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'page', in: 'query', required: false }),
        expect.objectContaining({
          name: 'pageSize',
          in: 'query',
          required: false,
        }),
        expect.objectContaining({
          name: 'status',
          in: 'query',
          required: false,
        }),
      ]),
    );
    const schema = document.components?.schemas?.MerchantResortVO;
    expect(schema).toMatchObject({
      required: expect.arrayContaining([
        'resortId',
        'name',
        'status',
        'customFields',
        'gallery',
        'updatedAt',
      ]),
      properties: {
        status: { enum: ['draft', 'pending_review', 'published', 'offline'] },
        coverAssetId: { type: 'string', nullable: true },
        rating: { type: 'string', nullable: true },
        customFields: { type: 'object', additionalProperties: true },
      },
    });
    expect(JSON.stringify(schema)).not.toMatch(
      /storageKey|StorageKey|merchantId|Contact/,
    );
  });

  it('documents custom-field definition and group response schemas', () => {
    const document = createOpenApiDocument(app);
    const fieldList =
      document.paths['/api/v1/admin/custom-fields']?.get?.responses?.['200'];
    const fieldCreate =
      document.paths['/api/v1/admin/custom-fields']?.post?.responses?.['201'];
    const fieldSchema =
      document.paths['/api/v1/admin/custom-fields/{entityType}/schema']?.get
        ?.responses?.['200'];
    const groupList =
      document.paths['/api/v1/admin/custom-field-groups']?.get?.responses?.[
        '200'
      ];
    const groupDetail =
      document.paths[
        '/api/v1/admin/custom-field-groups/{entityType}/{groupKey}'
      ]?.get;
    expect(document.components?.schemas?.CreateCustomFieldDto).toMatchObject({
      properties: {
        sortOrder: { type: 'number', default: 0 },
        required: { type: 'boolean', default: false },
        searchable: { type: 'boolean', default: false },
        filterable: { type: 'boolean', default: false },
        sortable: { type: 'boolean', default: false },
        isPublic: { type: 'boolean', default: false },
        optionsDictType: { type: 'string', nullable: true },
        defaultValue: {
          oneOf: expect.arrayContaining([
            { type: 'null' },
            { type: 'boolean' },
            { type: 'number' },
            { type: 'array', items: {} },
          ]),
        },
      },
    });
    expect(document.components?.schemas?.UpdateCustomFieldDto).toMatchObject({
      properties: {
        optionsDictType: { type: 'string', nullable: true },
        defaultValue: {
          oneOf: expect.arrayContaining([{ type: 'null' }, { type: 'string' }]),
        },
      },
    });
    expect(
      document.components?.schemas?.CreateCustomFieldGroupDto,
    ).toMatchObject({
      properties: { sortOrder: { type: 'number', default: 0 } },
    });
    expect(groupDetail?.responses?.['200']).toMatchObject({
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/CustomFieldGroupVO' },
        },
      },
    });
    expect(groupDetail?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'entityType',
          in: 'path',
          required: true,
          schema: expect.objectContaining({
            enum: ['ski_resort', 'article', 'dynamic', 'merchant_profile'],
          }),
        }),
        expect.objectContaining({
          name: 'groupKey',
          in: 'path',
          required: true,
          schema: expect.objectContaining({
            pattern: '^[a-z][a-z0-9_-]{0,99}$',
            maxLength: 100,
          }),
        }),
      ]),
    );

    expect(fieldList).toMatchObject({
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/CustomFieldDefinitionPageVO' },
        },
      },
    });
    expect(fieldCreate).toMatchObject({
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/CustomFieldDefinitionVO' },
        },
      },
    });
    expect(fieldSchema).toMatchObject({
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/CustomFieldSchemaVO' },
        },
      },
    });
    expect(groupList).toMatchObject({
      content: {
        'application/json': {
          schema: {
            type: 'array',
            items: { $ref: '#/components/schemas/CustomFieldGroupVO' },
          },
        },
      },
    });
    expect(
      document.components?.schemas?.CustomFieldDefinitionPageVO,
    ).toMatchObject({
      properties: {
        items: { type: 'array' },
        total: { type: 'number' },
        page: { type: 'number' },
        pageSize: { type: 'number' },
      },
    });
    expect(document.components?.schemas?.CustomFieldDefinitionVO).toMatchObject(
      {
        properties: {
          fieldDefinitionId: { type: 'number' },
          isPublic: { type: 'boolean' },
          schemaVersion: { type: 'number' },
        },
      },
    );
    expect(document.components?.schemas?.CustomFieldSchemaVO).toMatchObject({
      properties: {
        entityType: { type: 'string' },
        groups: { type: 'array' },
      },
    });
  });

  it('documents the permission tree schema and required management grants', () => {
    const document = createOpenApiDocument(app);
    const operation = document.paths['/api/v1/admin/permissions/tree']?.get;
    const response = operation?.responses?.['200'];

    expect(operation?.responses).toHaveProperty('401');
    expect(operation?.responses).toHaveProperty('403');
    expect(operation?.responses).toHaveProperty('500');
    for (const status of ['401', '403', '500']) {
      expect(operation?.responses?.[status]).toMatchObject({
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ApiErrorResponseVO' },
          },
        },
      });
    }
    expect(operation?.description).toContain('management:portal:enter');
    expect(operation?.description).toContain('system:role:list');
    expect(operation?.description).toContain('system:permission:assign');
    expect(response).toMatchObject({
      content: {
        'application/json': {
          schema: {
            $ref: '#/components/schemas/PermissionTreeResponseVO',
          },
        },
      },
    });
    expect(
      document.components?.schemas?.PermissionTreeResponseVO,
    ).toMatchObject({
      properties: {
        data: {
          type: 'array',
          items: { $ref: '#/components/schemas/PermissionNodeVO' },
        },
      },
    });
    expect(document.components?.schemas?.PermissionNodeVO).toMatchObject({
      properties: {
        permissionId: { type: 'number' },
        parentId: { type: 'number', nullable: true },
        permissionType: {
          type: 'string',
          enum: ['directory', 'menu', 'button', 'api'],
        },
        route: { type: 'string', nullable: true },
        icon: { type: 'string', nullable: true },
        children: {
          type: 'array',
          items: { $ref: '#/components/schemas/PermissionNodeVO' },
        },
      },
    });
    expect(document.components?.schemas?.ApiErrorResponseVO).toMatchObject({
      properties: {
        code: { type: 'number', minimum: 400, maximum: 599 },
        msg: { type: 'string' },
        data: {
          type: 'object',
          additionalProperties: false,
          nullable: true,
          example: null,
        },
        traceId: { type: 'string', format: 'uuid' },
        details: {
          type: 'array',
          items: { $ref: '#/components/schemas/ApiErrorDetailVO' },
        },
      },
    });
  });

  it('documents role authorization snapshot routes and replacement DTO', () => {
    const document = createOpenApiDocument(app);
    const path = document.paths['/api/v1/admin/roles/{id}/permissions'];
    const roleCollection = document.paths['/api/v1/admin/roles'];
    const roleItem = document.paths['/api/v1/admin/roles/{id}'];

    expect(path?.get?.responses).toHaveProperty('200');
    expect(path?.put?.responses).toHaveProperty('409');
    expect(path?.put?.requestBody).toBeDefined();
    expect(path?.put?.description).toContain('Only the protected system_admin');
    expect(roleCollection?.get?.responses).toHaveProperty('200');
    expect(roleCollection?.post?.responses).toHaveProperty('201');
    expect(roleItem?.get?.responses).toHaveProperty('200');
    expect(roleItem?.patch?.responses).toHaveProperty('200');
    expect(roleItem?.delete?.responses).toHaveProperty('204');
    expect(document.components?.schemas?.ManagedRoleVO).toMatchObject({
      properties: {
        description: { type: 'string', nullable: true },
        dataScope: { enum: ['self', 'merchant', 'all'] },
      },
    });
    expect(
      document.components?.schemas?.ReplaceRoleAuthorizationDto,
    ).toMatchObject({
      required: ['permissionIds', 'dataScopes', 'fieldPolicies'],
    });
  });

  afterEach(async () => {
    await app.close();
  });
});
