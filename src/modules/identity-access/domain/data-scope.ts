export type DataScope = 'self' | 'merchant' | 'all';
export type ResourceDataScope = DataScope | 'selected';

export function isDataScope(value: string): value is DataScope {
  return value === 'self' || value === 'merchant' || value === 'all';
}

export function isResourceDataScope(value: string): value is ResourceDataScope {
  return isDataScope(value) || value === 'selected';
}
