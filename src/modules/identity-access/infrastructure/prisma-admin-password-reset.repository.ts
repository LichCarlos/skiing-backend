import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';
import type { AdminPasswordResetRepository } from '../application/ports/admin-password-reset-repository.js';
import {
  PasswordResetConflictError,
  PasswordResetTargetMissingError,
} from '../domain/password-reset.js';
import { ManagementWriteAuthorizationError } from '../domain/management-write-authorization.js';
import { authorizeUserWrite } from './user-write-authorization.js';

@Injectable()
export class PrismaAdminPasswordResetRepository implements AdminPasswordResetRepository {
  constructor(private readonly prisma: PrismaService) {}
  async reset(
    input: Parameters<AdminPasswordResetRepository['reset']>[0],
  ): Promise<void> {
    try {
      await this.prisma.$transaction(
        async (transaction) => {
          const actor = await authorizeUserWrite(
            transaction,
            input.audit.actorUserId,
            'system:user:reset-password',
          );
          if (!actor.isSystemAdmin || actor.scope.kind !== 'all')
            throw new ManagementWriteAuthorizationError(
              'Protected system administrator and global user scope required',
            );
          const targets = await transaction.$queryRaw<
            { UserId: number }[]
          >`SELECT "UserId" FROM "User" WHERE "UserId" = ${input.userId} FOR UPDATE`;
          if (targets.length !== 1) throw new PasswordResetTargetMissingError();
          await transaction.user.update({
            where: { UserId: input.userId },
            data: { PasswordHash: input.passwordHash },
          });
          const revoked = await transaction.authSession.updateMany({
            where: { UserId: input.userId, RevokedAt: null },
            data: { RevokedAt: input.now },
          });
          await transaction.operationLog.create({
            data: {
              ActorUserId: input.audit.actorUserId,
              ActorAccountSnapshot: actor.account,
              ActionKey: 'system:user:reset-password',
              ResourceKey: 'user',
              TargetType: 'User',
              TargetId: String(input.userId),
              Result: 'success',
              Reason: input.reason,
              TraceId: input.audit.traceId,
              ClientIp: input.audit.clientIp?.slice(0, 64) ?? null,
              UserAgent: input.audit.userAgent?.slice(0, 500) ?? null,
              Metadata: { revokedSessionCount: revoked.count },
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      const value = error as { code?: string; meta?: { code?: string } } | null;
      if (
        value &&
        (['P2034', '40001', '40P01'].includes(value.code ?? '') ||
          (value.code === 'P2010' &&
            ['40001', '40P01'].includes(value.meta?.code ?? '')))
      )
        throw new PasswordResetConflictError();
      throw error;
    }
  }
}
