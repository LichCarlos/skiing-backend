import type { TransactionContext } from './outbox-store.js';

export interface UnitOfWork {
  execute<T>(work: (transaction: TransactionContext) => Promise<T>): Promise<T>;
}
