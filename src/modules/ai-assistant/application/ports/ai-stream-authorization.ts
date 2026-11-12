import type { RagAccessPrincipal } from '../../domain/rag-access.js';

export const AI_STREAM_AUTHORIZATION = Symbol('AI_STREAM_AUTHORIZATION');

export interface AiStreamAuthorization {
  assert(input: {
    userId: number;
    sessionId: string;
    principal: RagAccessPrincipal;
  }): Promise<void>;
}

export class AiStreamAccessRejectedError extends Error {
  constructor(readonly reason: 'session' | 'permission') {
    super('AI stream access is no longer available');
    this.name = 'AiStreamAccessRejectedError';
  }
}
