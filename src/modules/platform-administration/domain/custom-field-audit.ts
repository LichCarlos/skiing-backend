export interface CustomFieldAuditContext {
  actorUserId: number;
  traceId: string;
  clientIp: string | null;
  userAgent: string | null;
}

export class CustomFieldReferenceInvalidError extends Error {}
export class CustomFieldActorUnavailableError extends Error {}
export class CustomFieldAuthorizationError extends Error {}
