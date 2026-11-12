import { vi } from 'vitest';
import type {
  CommunityTransaction,
  CommunityUnitOfWork,
} from '../../src/modules/community/application/ports/community-unit-of-work.js';
import type { StoredDynamic } from '../../src/modules/community/application/community-models.js';

export function communityActorRow(userId: number) {
  return {
    UserId: userId,
    Account: 'moderator',
    Status: 'active',
    MerchantProfile: null,
    UserRoles: [
      {
        Role: {
          RoleKey: 'community-test-role',
          Status: 'active',
          DataScope: 'self',
          DataScopes: [],
          RolePermissions: [
            'community:dynamic:create',
            'community:dynamic:update-own',
            'community:comment:create',
            'community:like:toggle',
            'content:dynamic:moderate',
            'management:portal:enter',
          ].map((PermissionKey) => ({
            Permission: { PermissionKey, Status: 'active' },
          })),
        },
      },
    ],
  };
}

export function communityFixture() {
  const dynamic: StoredDynamic = {
    authorId: 2,
    content: 'Original',
    resortId: 12,
    imageAssetIds: ['11'],
    status: 'published',
    moderatedAt: null,
    moderatedByUserId: null,
    moderationReason: null,
  };
  const tx = {
    authorize: vi
      .fn<CommunityTransaction['authorize']>()
      .mockResolvedValue(undefined),
    findDynamic: vi
      .fn<CommunityTransaction['findDynamic']>()
      .mockResolvedValue(dynamic),
    createDynamic: vi
      .fn<CommunityTransaction['createDynamic']>()
      .mockResolvedValue({
        dynamicId: 7,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      }),
    updateDynamic: vi
      .fn<CommunityTransaction['updateDynamic']>()
      .mockResolvedValue(undefined),
    replaceDynamicImages: vi
      .fn<CommunityTransaction['replaceDynamicImages']>()
      .mockResolvedValue(undefined),
    deleteDynamic: vi
      .fn<CommunityTransaction['deleteDynamic']>()
      .mockResolvedValue(undefined),
    findComment: vi
      .fn<CommunityTransaction['findComment']>()
      .mockResolvedValue({
        authorId: 2,
        dynamicId: 7,
        status: 'visible',
        moderatedAt: null,
        moderatedByUserId: null,
        moderationReason: null,
      }),
    createComment: vi
      .fn<CommunityTransaction['createComment']>()
      .mockResolvedValue({
        commentId: 8,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      }),
    deleteComment: vi
      .fn<CommunityTransaction['deleteComment']>()
      .mockResolvedValue(undefined),
    ownedReadyAssetIds: vi
      .fn<CommunityTransaction['ownedReadyAssetIds']>()
      .mockImplementation(async (_author, ids) => [...ids]),
    isPublishedArticle: vi.fn<CommunityTransaction['isPublishedArticle']>().mockResolvedValue(true),
    isPublishedResort: vi
      .fn<CommunityTransaction['isPublishedResort']>()
      .mockResolvedValue(true),
    setLike: vi
      .fn<CommunityTransaction['setLike']>()
      .mockResolvedValue({ liked: true, likeCount: 3 }),
    moderateDynamic: vi
      .fn<CommunityTransaction['moderateDynamic']>()
      .mockResolvedValue(undefined),
    moderateComment: vi
      .fn<CommunityTransaction['moderateComment']>()
      .mockResolvedValue(undefined),
    dynamicChanged: vi
      .fn<CommunityTransaction['dynamicChanged']>()
      .mockResolvedValue(undefined),
    audit: vi.fn<CommunityTransaction['audit']>().mockResolvedValue(undefined),
  } satisfies CommunityTransaction;
  const uow: CommunityUnitOfWork = {
    run: async <T>(work: (transaction: CommunityTransaction) => Promise<T>) =>
      work(tx),
  };
  return { tx, uow, dynamic };
}
