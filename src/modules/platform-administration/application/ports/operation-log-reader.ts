import type { OperationLogRecord } from '../../domain/operation-log.js';

export const OPERATION_LOG_READER = Symbol('OPERATION_LOG_READER');
export interface OperationLogReader {
  findPage(input: {
    skip: number;
    take: number;
    actorUserId?: number;
    actionKey?: string;
    resourceKey?: string;
    result?: 'success' | 'failure';
    traceId?: string;
    fromTime?: Date;
    toTime?: Date;
  }): Promise<{ items: OperationLogRecord[]; total: number }>;
}
