import { Inject, Injectable } from '@nestjs/common';
import {
  AUTH_SESSION_REPOSITORY,
  type AuthSessionRepository,
} from '../../identity-access/application/ports/auth-session-repository.js';
import { ResolveAuthorizationPrincipal } from '../../identity-access/application/resolve-authorization-principal.js';
import { hasPermission } from '../../identity-access/domain/authorization.js';
import { AI_CONVERSATION_USE_PERMISSION } from '../../identity-access/domain/permissions.js';
import { resolveRagAccess } from '../domain/rag-access.js';
import {
  AiStreamAccessRejectedError,
  type AiStreamAuthorization,
} from '../application/ports/ai-stream-authorization.js';

@Injectable()
export class CurrentAiStreamAuthorization implements AiStreamAuthorization {
  constructor(
    @Inject(AUTH_SESSION_REPOSITORY)
    private readonly sessions: AuthSessionRepository,
    private readonly principals: ResolveAuthorizationPrincipal,
  ) {}

  async assert(
    input: Parameters<AiStreamAuthorization['assert']>[0],
  ): Promise<void> {
    if (
      !Number.isSafeInteger(input.userId) ||
      input.userId < 1 ||
      !input.sessionId ||
      input.principal.userId !== input.userId ||
      !(await this.sessions.isActive({
        userId: input.userId,
        sessionId: input.sessionId,
        now: new Date(),
      }))
    )
      throw new AiStreamAccessRejectedError('session');

    const current = await this.principals.execute(input.userId);
    if (
      !current ||
      current.userId !== input.userId ||
      !hasPermission(current, AI_CONVERSATION_USE_PERMISSION) ||
      JSON.stringify(resolveRagAccess(current)) !==
        JSON.stringify(resolveRagAccess(input.principal))
    )
      throw new AiStreamAccessRejectedError('permission');
  }
}
