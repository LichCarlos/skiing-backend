import type { ArticleAccess } from '../../src/modules/knowledge-content/domain/article-scope.js';

export function articleActor(access: ArticleAccess = { kind: 'all' }) {
  return {
    UserId: 3,
    Status: 'active',
    Account: 'editor',
    Nickname: 'Editor',
    MerchantProfile: null,
    UserRoles: [
      {
        Role: {
          RoleKey: 'content_editor',
          Status: 'active',
          DataScope: 'self',
          RolePermissions: [
            'management:portal:enter',
            'content:article:manage',
          ].map((PermissionKey) => ({
            Permission: { PermissionKey, Status: 'active' },
          })),
          DataScopes: [
            {
              ResourceKey: 'article',
              ScopeType: access.kind,
              ScopeConfig:
                access.kind === 'selected'
                  ? { selectedIds: [...access.ids] }
                  : null,
            },
          ],
        },
      },
    ],
  };
}
