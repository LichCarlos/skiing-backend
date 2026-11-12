import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';
import type { SelfPasswordChangeRepository } from '../application/ports/self-password-change-repository.js';

@Injectable()
export class PrismaSelfPasswordChangeRepository implements SelfPasswordChangeRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findPasswordHash(userId: number): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { UserId: userId },
      select: { PasswordHash: true, Status: true },
    });
    return user?.Status === 'active' ? user.PasswordHash : null;
  }

  async updatePassword(input: {
    userId: number;
    expectedPasswordHash: string;
    passwordHash: string;
    traceId: string;
    clientIp: string | null;
    userAgent: string | null;
    now: Date;
  }): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      const user = await transaction.user.findUnique({
        where: { UserId: input.userId },
        select: { Account: true, Status: true },
      });
      if (!user || user.Status !== 'active') return false;
      const changed = await transaction.user.updateMany({
        where: {
          UserId: input.userId,
          Status: 'active',
          PasswordHash: input.expectedPasswordHash,
        },
        data: { PasswordHash: input.passwordHash },
      });
      if (changed.count !== 1) return false;
      await transaction.authSession.updateMany({
        where: { UserId: input.userId, RevokedAt: null },
        data: { RevokedAt: input.now },
      });
      await transaction.operationLog.create({
        data: {
          ActorUserId: input.userId,
          ActorAccountSnapshot: user.Account,
          ActionKey: 'account:password:change',
          ResourceKey: 'account:profile',
          TargetType: 'User',
          TargetId: String(input.userId),
          Result: 'success',
          TraceId: input.traceId,
          ClientIp: input.clientIp,
          UserAgent: input.userAgent,
          Metadata: {
            refreshSessionsRevoked: true,
          } satisfies Prisma.InputJsonObject,
        },
      });
      return true;
    });
  }
}
