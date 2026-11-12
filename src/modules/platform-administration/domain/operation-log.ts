export interface OperationLogFilter {
  page: number;
  pageSize: number;
  actorUserId?: number;
  actionKey?: string;
  resourceKey?: string;
  result?: 'success' | 'failure';
  traceId?: string;
  fromTime?: string;
  toTime?: string;
}

// A deliberately narrow read model. Sensitive audit payloads never belong here.
export interface OperationLogRecord {
  operationLogId: string;
  actorUserId: number | null;
  actorAccountSnapshot: string;
  actionKey: string;
  resourceKey: string;
  targetType: string;
  targetId: string;
  result: 'success' | 'failure';
  traceId: string;
  createdAt: Date;
}
