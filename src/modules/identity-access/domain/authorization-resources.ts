// Only resources consumed by protected HTTP routes belong in this catalog.
export const AUTHORIZATION_RESOURCES = [
  { resourceKey: 'article', label: '知识文章' },
  { resourceKey: 'asset', label: '资产' },
  { resourceKey: 'resort', label: '滑雪场' },
  { resourceKey: 'role', label: '角色' },
  { resourceKey: 'user', label: '用户账号' },
] as const;

export type AuthorizationResourceKey =
  (typeof AUTHORIZATION_RESOURCES)[number]['resourceKey'];

const resourceKeys = new Set<string>(
  AUTHORIZATION_RESOURCES.map((item) => item.resourceKey),
);

export function isAuthorizationResourceKey(
  value: string,
): value is AuthorizationResourceKey {
  return resourceKeys.has(value);
}
