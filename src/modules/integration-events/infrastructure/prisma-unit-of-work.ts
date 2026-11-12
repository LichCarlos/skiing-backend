import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/persistence/prisma.service.js';
import type { TransactionContext } from '../application/ports/outbox-store.js';
import type { UnitOfWork } from '../application/ports/unit-of-work.js';

@Injectable()
export class PrismaUnitOfWork implements UnitOfWork {
  constructor(private readonly prisma: PrismaService) {}

  execute<T>(
    work: (transaction: TransactionContext) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction((transaction) =>
      work(transaction as unknown as TransactionContext),
    );
  }
}
