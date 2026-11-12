export const AUTHORIZATION_PRINCIPAL_READER = Symbol(
  'AUTHORIZATION_PRINCIPAL_READER',
);

export interface AuthorizationPermissionRecord {
  key: string;
  status: string;
}

export interface AuthorizationRoleRecord {
  key: string;
  status: string;
  dataScope: string;
  permissions: readonly AuthorizationPermissionRecord[];
  dataScopes?: readonly AuthorizationResourceScopeRecord[];
}

export interface AuthorizationResourceScopeRecord {
  resourceKey: string;
  scopeType: string;
  scopeConfig: unknown;
}

export interface AuthorizationPrincipalRecord {
  userId: number;
  status: string;
  merchant: { id: number; status: string } | null;
  roles: readonly AuthorizationRoleRecord[];
}

export interface AuthorizationPrincipalReader {
  findByUserId(userId: number): Promise<AuthorizationPrincipalRecord | null>;
}
