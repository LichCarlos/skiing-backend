import type { Prisma } from '@prisma/client';
import { appendOutboxEvent } from './append-outbox-event.js';

export async function appendFieldDependencyEvent(
  tx: Prisma.TransactionClient,
  entityType: string,
) {
  if (!['ski_resort', 'article', 'dynamic'].includes(entityType)) return;
  await appendOutboxEvent(tx, {
    eventType: 'rag.dependencies.changed.v1',
    aggregateType: 'CustomFieldSchema',
    aggregateId: entityType,
    payload: { entityType, afterId: 0 },
  });
}
