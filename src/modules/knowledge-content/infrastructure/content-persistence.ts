import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../shared/persistence/prisma.service.js';
import type {
  ContentAuditContext,
  ContentAuditChange,
} from '../application/content-models.js';

export async function serializableContentWrite<T>(
  prisma: PrismaService,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  try {
    return await prisma.$transaction(work, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === 'P2034' ||
        (error.code === 'P2010' &&
          ['40001', '40P01'].includes(String(error.meta?.code))))
    )
      throw new ConflictException(
        'Content changed concurrently; reload before retrying',
      );
    throw error;
  }
}
export async function auditContent(
  tx: Prisma.TransactionClient,
  context: ContentAuditContext,
  id: number,
  resourceKey: 'article' | 'content:project-knowledge',
  targetType: 'Article' | 'ProjectKnowledge',
  change: ContentAuditChange,
) {
  const actor = await tx.user.findUnique({
    where: { UserId: context.actorUserId, Status: 'active' },
    select: { Account: true },
  });
  if (!actor) throw new NotFoundException('Audit actor not found');
  await tx.operationLog.create({
    data: {
      ActorUserId: context.actorUserId,
      ActorAccountSnapshot: actor.Account,
      ActionKey: change.actionKey,
      ResourceKey: resourceKey,
      TargetType: targetType,
      TargetId: String(id),
      Result: 'success',
      TraceId: context.traceId,
      ClientIp: context.clientIp,
      UserAgent: context.userAgent,
      Metadata: {
        before: change.before,
        after: change.after,
      } as Prisma.InputJsonObject,
    },
  });
}
